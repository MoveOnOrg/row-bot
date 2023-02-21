const {JWT} = require('google-auth-library');
const {google} = require('googleapis');

const gapi = async (googleObj, call, args) => {
  /**
   * Google API availability is not very reliable. This function retries
   * connecting to the API up to 5 times following a similar strategy posted
   * here:
   * https://stackoverflow.com/questions/42552925/the-service-is-currently-unavailable-google-api
   */
  let apiCallNumOfAttempts = 5;
  let apiCallAttempts = 0;
  let apiCallSleep = 1;

  return new Promise(
    (resolve, reject) => {
      getGoogleObj();

      function getGoogleObj() {
        googleObj[call](args, (err, res) => {
          if (err) {
            if(apiCallAttempts < apiCallNumOfAttempts) {
              console.log('The API returned an error: ' + err + '. Retrying...');
              setTimeout(getGoogleObj, apiCallSleep * 1000);
              apiCallAttempts++;
              apiCallSleep *= 2;
            } else {
              console.log('The API returned an error: ' + err);
              reject('The API returned an error: ' + err);
            }
            return;
          }
          resolve(res);
        });        
      }
    }
  );
}

const algorithms = {
  'first_row': (rows, filter, date) => {
    // first non-blank
    for (i=0; i < rows.length; i++) {
      if (rows[i].length && filter(rows[i])) {
        return rows[i];
      }
    }
  },
  'date_match': (rows, filter, date) => {
    // epoch time in days: same as "SERIAL_NUMBER" from google date format
    const today = (date ? new Date(date) : new Date()).toDateString();
    for (i=0; i < rows.length; i++) {
      if (filter(rows[i])) {
        const date = (new Date(rows[i][0])).toDateString();
        if (date == today) {
          return rows[i];
        }
      }
    }
    return null;
  },
  'date_match_with_row_contents': (rows, filter, date) => {
    // epoch time in days: same as "SERIAL_NUMBER" from google date format
    const today = (date ? new Date(date) : new Date()).toDateString();
    for (i=0; i < rows.length; i++) {
      if (filter(rows[i])) {
        const date = (new Date(rows[i][0])).toDateString();
        if (date == today && rows[i].length > 1 && rows[i][1]) {
          return rows[i];
        }
      }
    }
    return null;
  },
  'date_most_recent': (rows, filter, date) => {
    // assuming the first column is full of dates in ascending order,
    // get the most recent row
    const today = (date ? new Date(date) : new Date()).toDateString();
    for (i=0; i < rows.length; i++) {
      if (rows[i][0]) {
        const date = (new Date(rows[i][0])).toDateString();
        if (date == today && filter(rows[i])) {
          return rows[i];
        } else if (new Date(date) > new Date(today)) {
          if (i && filter(rows[i-1])) {
            return rows[i-1];
          } else {
            return null;
          }
        }
      }
    }
    return null;
  },
  'tomorrow_reminder': (rows, filter, date) => {
    const tomorrow = (date ? new Date(date) : new Date());
    tomorrow.setDate(tomorrow.getDate() + 1);
    for (i=0; i < rows.length; i++) {
      if (filter(rows[i])) {
        const date = (new Date(rows[i][0])).toDateString();
        if (date == tomorrow.toDateString()) {
          return rows[i];
        }
      }
    }
    return null;
  },
  'weekdays_after_topdate': (rows, filter, date) => {
    // get the date from the first row, then just count each weekday
    const firstDate = (new Date(rows[0][0]));
    const today = (date ? new Date(date) : new Date());
    const daysSince = Math.ceil((today - firstDate) / (1000 * 60 * 60 * 24));
    const weeksSince = parseInt(daysSince / 7);
    const rowIndex = (weeksSince * 5) + (daysSince % 7);
    if (rowIndex < rows.length) {
      return rows[rowIndex];
    }
    return null;
  }
};

class SheetBot {
  constructor({ 
    clientAuth,
    spreadsheetUrl,
    clientEmail,
    clientPrivateKey,
    userMap,
    sheetData,
    shareEmail
  }) {
    const auth = clientAuth || new JWT(
      clientEmail,
      null,
      clientPrivateKey,
      ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive'],
      shareEmail
    );
    this.c = google.sheets({version: 'v4', auth});

    this.userMap = userMap || {};
    this.sheetData = sheetData;
    this.bColumnFilter = sheetData && sheetData.bColumnFilter;
    this.spreadsheetUrl = spreadsheetUrl || (sheetData && sheetData.spreadsheetUrl);
    this.spreadsheetId = this.spreadsheetUrl.match(/\/d\/([^/]+)/)[1];
    const subsheet = this.spreadsheetUrl.match(/gid=(\d+)/);
    if (subsheet) {
      this.gid = subsheet[1];
    }
  }

  async maybeMessage({ algorithm, fakedate }) {
    const data = await this.getData();
    const message = this.customCellMessage || data[0][1];
    const HEADERROWS = 2;
    const rows = data.slice(HEADERROWS);
    const bColumnFilter = this.bColumnFilter;
    const filter = bColumnFilter
          ? (row => row[0] && row[1] == bColumnFilter)
          : (row => row[0]);
    if (data.length > HEADERROWS) {
      const row = (algorithms[algorithm] ||
                   algorithms["date_most_recent"])(
        rows,
        filter || (row => row[0]),
        fakedate ? new Date(fakedate) : new Date()
      );
      if (row && row.length) {
        console.log('maybeMessage', row, this.spreadsheetId, this.gid);
        return this.formatMessage(message, row);
      }
    }
    return null
  }

  getDisplayName(name) {
    if(name) {
      var slackId = this.userMap[String(name).replace(/^\@/,'').trim().toLowerCase()];
      if(slackId) {
        return "<@" + slackId + ">";
      }
      return name;
    }
    return "_";
  }

  formatMessage(text, row) {
    return text
      .replace(/\$\w+/g, (item) => {
        const index = item.toUpperCase().charCodeAt(1) - 65;
        if (index < row.length) {
          return this.getDisplayName(row[index]);
        }
        return "__";
      });
  }

  async getData() {
    // we use batchGetByDataFilter instead of get so we can use the gid= spreadsheet id
    // that people share in the urls (rather than the sheet name)
    const resp = await gapi(this.c.spreadsheets.values, 'batchGetByDataFilter', {
      spreadsheetId: this.spreadsheetId,
      majorDimension: 'ROWS',
      resource: {
        dataFilters: [
          {
            gridRange: {
              sheetId: this.gid || 0,
              startRowIndex: 0,
              endRowIndex: 1000,
              startColumnIndex: 0,
              endColumnIndex: 10,
            },
          },
        ],
      }
    });
    if (this.sheetData && this.sheetData.customMessageCell) {
      const messageCellData = await gapi(this.c.spreadsheets.values, 'get', {
        spreadsheetId: this.spreadsheetId,
        majorDimension: 'ROWS',
        range: this.sheetData.customMessageCell
      });
      if (messageCellData.data.values) {
        this.customCellMessage = messageCellData.data.values[0][0];
      }
    }
    // console.log('getData', JSON.stringify(resp, null, 2));
    // talk about burying the data!
    return (resp.data &&
            resp.data.valueRanges.length &&
            resp.data.valueRanges[0].valueRange.values);
  }

}

exports.SheetBot = SheetBot
