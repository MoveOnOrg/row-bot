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

class MetaSheet {
  constructor({ 
    spreadsheetId,
    clientEmail,
    clientPrivateKey,
    shareEmail
  }) {
    const auth = new JWT(
      clientEmail,
      null,
      clientPrivateKey,
      ['https://www.googleapis.com/auth/spreadsheets'],
      shareEmail
    );

    this.c = google.sheets({version: 'v4', auth});
    this.sheetbotAuth = new JWT(
      clientEmail,
      null,
      clientPrivateKey,
      ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive'],
      shareEmail
    );

    this.spreadsheetId = spreadsheetId;
  }

  async loadUserMapping() {
    const resp = await gapi(this.c.spreadsheets.values, 'get', {
      spreadsheetId: this.spreadsheetId,
      range: 'UserID Map!A3:B', //sheet!range
      majorDimension: 'ROWS'
    });
    const HEADERROWS = 0; // A3 above starts us on the third row
    const users = {};
    if (resp.data.values) {
      resp.data.values.slice(HEADERROWS).forEach(row => {
        users[row[0]] = row[1];
      });
    }
    this.users = Object.assign(this.users || {}, users);
    return users;
  }

  async addUserMapping(nameValuePairArray) {
    if (nameValuePairArray.length) {
      const resp = await gapi(this.c.spreadsheets.values, 'append', {
        spreadsheetId: this.spreadsheetId,
        range: 'UserID Map!A3:B', //sheet!range
        valueInputOption: 'RAW',
        resource: {values: nameValuePairArray}
      });
      return resp;
    }
  }

  collectUserIdsFromSlackMessage(event) {
    const userIds = {};
    if (event.blocks) {
      event.blocks.forEach(b => {
        if (b.elements) {
          b.elements.forEach(e1 => {
            if (e1.user_id) {
              userIds[e1.user_id] = 1;
            }
            if (e1.elements) {
              e1.elements.forEach(e2 => {
                if (e2.user_id) {
                  userIds[e2.user_id] = 1;
                }
              });
            }
          });
        }
      });
    }
    return Object.keys(userIds);
  }

  async deduplicateUserMapping() {
    await this.loadUserMapping();
    const nameValuePairArray = Object.entries(this.users);
    nameValuePairArray.sort();
    if (nameValuePairArray.length) {
      // CLEAR (to remove lower rows)
      await gapi(this.c.spreadsheets.values, 'clear', {
        spreadsheetId: this.spreadsheetId,
        range: 'UserID Map!A3:B2000', //sheet!range
      });
      const resp = await gapi(this.c.spreadsheets.values, 'update', {
        spreadsheetId: this.spreadsheetId,
        range: 'UserID Map!A3:B', //sheet!range
        valueInputOption: 'RAW',
        resource: {values: nameValuePairArray}
      });
      return resp;
    }
  }

  async addSheet({ sheetUrl, channelId, channelName, schedule, algorithm, bColumnFilter, customMessageCell, userAdded }) {
    // TODO: avoid duplication
    // TODO: validate sheet (message, 
    const resp = await gapi(this.c.spreadsheets.values, 'append', {
      spreadsheetId: this.spreadsheetId,
      range: 'Metasheet!A8:I', //sheet!range
      valueInputOption: 'RAW',
      resource: {values: [
        [
          channelName,
          "", // title (placeholder for metasheet managers)
          "ON", // status
          sheetUrl,
          schedule || "morning_9amET",
          algorithm || "date_match",
          bColumnFilter || "",
          customMessageCell || "",
          channelId,
          userAdded
        ]
      ]}
    });
    return resp;
  }

  async getSheets({ schedule }) {
    const resp = await gapi(this.c.spreadsheets.values, 'get', {
      spreadsheetId: this.spreadsheetId,
      range: 'Metasheet!A8:I', //sheet!range
      majorDimension: 'ROWS'
    });
    const sheetBots = [];
    const HEADERROWS = 0; // A8 above starts us on the eighth row
    if (resp.data.values) {
      resp.data.values.slice(HEADERROWS).forEach((row, i) => {
        const sheetData = {
          channelName: row[0],
          title: row[1],
          status: row[2],
          spreadsheetUrl: row[3],
          schedule: row[4],
          algorithm: row[5],
          bColumnFilter: row[6],
          customMessageCell: row[7],
          channelId: row[8],
          userCreated: row[9],
          row: i
        };
        if ((!schedule || schedule == sheetData.schedule) && sheetData.status != "OFF") {
          sheetBots.push(sheetData);
        }
      });
    }
    console.log('sheetBots', JSON.stringify(sheetBots, null, 2));
    return sheetBots;
  }
  
}

exports.MetaSheet = MetaSheet
