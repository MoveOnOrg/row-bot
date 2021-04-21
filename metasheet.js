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

class MetaSheet {
  constructor({ 
    spreadsheetId,
    clientEmail,
    clientPrivateKey
  }) {
    const auth = new JWT(
      clientEmail,
      null,
      clientPrivateKey,
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    this.c = google.sheets({version: 'v4', auth});
    this.sheetbotAuth = new JWT(
      clientEmail,
      null,
      clientPrivateKey,
      ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive']
    );

    this.spreadsheetId = spreadsheetId;
  }

  async loadUserMapping() {
    const resp = await gapi(this.c.spreadsheets.values, 'get', {
      spreadsheetId: this.spreadsheetId,
      range: 'UserID Map!A3:B', //sheet!range
      majorDimension: 'ROWS'
    });
    console.log('loadUserMapping', resp);
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
        range: 'UserID Map XX!A3:B2000', //sheet!range
      });
      const resp = await gapi(this.c.spreadsheets.values, 'update', {
        spreadsheetId: this.spreadsheetId,
        range: 'UserID Map XX!A3:B', //sheet!range
        valueInputOption: 'RAW',
        resource: {values: nameValuePairArray}
      });
      return resp;
    }
  }

  async addSheet({ sheetUrl, channelId, channelName, schedule, algorithm, bColumnFilter, userAdded }) {
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
          channelId: row[7],
          userCreated: row[8],
          row: i
        };
        if (!schedule || schedule == sheetData.schedule) {
          sheetBots.push(sheetData);
        }
      });
    }
    console.log('sheetBots', JSON.stringify(sheetBots, null, 2));
    return sheetBots;
  }
  
}

exports.MetaSheet = MetaSheet
