const {JWT} = require('google-auth-library');
const {google} = require('googleapis');

const gapi = async (googleObj, call, args) => {
  return new Promise(
    (resolve, reject) => {
      googleObj[call](args, (err, res) => {
        if (err) {
          console.log('The API returned an error: ' + err);
          reject('The API returned an error: ' + err);
          return;
        }
        resolve(res);
      });
    }
  );
}

function sheetsToJSDate(sheetsDate) {
  // Google has a weird date model that is off from JS's getTime() by 25569 days
  return Number(new Date((Number(sheetsDate) - 25569) * 86400 * 1000));
}

function todayMidnight(date) {
  return Number(new Date(1000 * 86400 * parseInt(Number(date || new Date())/ (86400 * 1000))));
}

const algorithms = {
  'first_row': (rows, filter) => {
    // first non-blank
    for (i=0; i < rows.length; i++) {
      if (rows[i].length && filter(rows[i])) {
        return rows[i];
      }
    }
  },
  'date_match': (rows, filter) => {
    // epoch time in days: same as "SERIAL_NUMBER" from google date format
    const today = todayMidnight();
    for (i=0; i < rows.length; i++) {
      if (filter(rows[i])) {
        const date = sheetsToJSDate(rows[i][0]);
        if (date == today) {
          return rows[i];
        }
      }
    }
    return null;
  },
  'date_most_recent': (rows, filter) => {
    // assuming the first column is full of dates in ascending order,
    // get the most recent row
    const today = todayMidnight();
    for (i=0; i < rows.length; i++) {
      if (rows[i][0]) {
        const date = sheetsToJSDate(rows[i][0]);
        if (date == today && filter(rows[i])) {
          return rows[i];
        } else if (date > today) {
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
  'tomorrow_reminder': (rows, filter) => {
    const tomorrow = todayMidnight(Number(new Date()) + (86400 * 1000));
    for (i=0; i < rows.length; i++) {
      if (filter(rows[i])) {
        const date = sheetsToJSDate(rows[i][0]);
        if (date == tomorrow) {
          return rows[i];
        }
      }
    }
    return null;
  },
  'weekdays_after_topdate': (rows, filter) => {
    // get the date from the first row, then just count each weekday
    const firstDate = sheetsToJSDate(rows[0][0]);
    const today = todayMidnight();
    const daysSince = (today - firstDate) / (86400 * 1000);
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

  async maybeMessage({ algorithm }) {
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
                   algorithms["date_most_recent"])(rows, filter || (row => row[0]));
      if (row && row.length) {
        console.log('maybeMessage', row, this.spreadsheetId, this.gid);
        return this.formatMessage(message, row);
      }
    }
    return null
  }

  getDisplayName(name) {
    if(name) {
      var slackId = this.userMap[name.replace(/^\@/,'').trim().toLowerCase()];
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
      dateTimeRenderOption: 'SERIAL_NUMBER', // epoch time in days
      valueRenderOption: 'UNFORMATTED_VALUE', // needed for dates annoyingly -- not very orthogonal
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
