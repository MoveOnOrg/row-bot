/*jshint esversion: 8 */
const config = require('./config.json');
const { MetaSheet } = require('./metasheet.js');
const { SheetBot } = require('./sheetbot.js');
const { WebClient } = require('@slack/web-api');
const AWS = require('aws-sdk');

const slack = new WebClient(config.slackBotUserOAuthToken || process.env.SLACK_TOKEN);
const awsLambda = new AWS.Lambda();

// Some code terms:
// Metasheet: the spreadsheet that has two sheets, one that lists all the 'sub'sheets which
//   each describe a channel-message pair -- called a sheetbot
// Sheetbot: the spreadsheet for a particular message which is sent to a channel
//   -- has the message and the rows used to base it on

// lambda response w/ JSON data helper function
const jres = (jsondata) => ({
  "body": JSON.stringify(jsondata)
});

async function awsHandler(event, context) {
  // This function has THREE sections
  // 1. Lambda event triggers: (event.schedule) -- it's a cron with a schedule name that will decide where to message
  // 2. Slack Event Hook (event.body) -- a slack event has hit your API
  // 3. Debugging Web GET request with query parameters from API Gateway: (event.queryStringParameters)
  const ms = new MetaSheet({
    spreadsheetId: config.spreadsheetId,
    clientEmail: config.clientEmail,
    clientPrivateKey: config.gPrivateKey,
    shareEmail: config.shareEmail
  });
  if (event.schedule) {
    // 1. LAMBDA EVENT TRIGGER: (event.schedule) -- it's a cron with a schedule name that will decide where to message
    return await handleCronTrigger(ms, event);
  } else if (event.body) {
    // 2. SLACK EVENT HOOK (event.body) -- a slack event has hit your API
    const bodyJSON = JSON.parse(Buffer.from(event.body, 'base64').toString());
    // Slack only gives 3 SECONDS for a response
    // So instead of processing which often takes more than 3 seconds, we invoke
    // Lambda with the data to be processed and then return a new lambda event immediately.
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
      await invokeAsyncSlackProcessor(bodyJSON);
    } else {
      handleSlackEvent(ms, bodyJSON)
        .then(d => {
          console.log('finished handleSlackEvent');
        });
    }

    return jres({
      // needed to install the Slack events API
      challenge: bodyJSON.challenge || "no challenge in the request"
    });
  } else if (event.type === "JOB") {
    return await handleSlackEvent(ms, event.data);
  } else if (event.queryStringParameters) {
    // 3. DEBUGGING Web GET request with query parameters from API Gateway: (event.queryStringParameters)
    const qs = event.queryStringParameters;
    console.log('event.queryStringParameters', event)
    return await handleDebugWeb(ms, qs)
  } else {
    // non-API Gateway result
    console.log('awsHandler', event);
    return jres({ result: "no matched event types"});
  }
}

async function handleCronTrigger(ms, event) {
  // 1.a: get the sheets connected to the schedule that is triggered now
  const sheetbots = await ms.getSheets({ schedule: event.schedule });
  let messages = [];
  if (sheetbots.length) {
    // 1.b: get the user-SlackUserId mapping from the metasheet (used for @ references)
    await ms.loadUserMapping();
    // 1.c: for each sheet that represents a sheetbot, see if a message should be sent
    messages = await Promise.all(
      sheetbots.map(sheetData => {
        const sb = new SheetBot({
          sheetData,
          clientAuth: ms.sheetbotAuth,
          userMap: ms.users
        });
        return sb.maybeMessage({
          algorithm: sheetData.algorithm,
          fakedate: event.fakedate
        });
      })
    );

    // 1.d: for each message response, if there's something, then send it to the right channel
    for (let i=0; i<messages.length; i++) {
      const text = messages[i];
      if (text) {
        await slack.chat.postMessage({
          text,
          channel: sheetbots[i].channelId
        })
      }
    }
  }
  return jres({ sheetbots, messages });
}

async function invokeAsyncSlackProcessor(bodyJSON) {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  await awsLambda
    .invoke({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: JSON.stringify({
        type: "JOB",
        data: bodyJSON
      })
    })
    .promise();
}

async function handleSlackEvent(ms, bodyJSON) {
  const evt = bodyJSON.event;
  if (evt && evt.user) {
    const userData = await slack.users.info({
      user: evt.user
    });
    const botSelf = await slack.auth.test();
    console.log("user", JSON.stringify(userData, null, 2), botSelf);
    if (evt.type == "app_mention") {
      // When someone posted @row-bot (after inviting them to the channel)
      const userIds = ms.collectUserIdsFromSlackMessage(evt).filter(uId => uId != botSelf.user_id);
      if (userIds.length) {
        const userMap = await Promise.all(userIds.map(user => slack.users.info({ user })));
        await ms.addUserMapping(userMap.filter(x => x && x.user).map(u => [u.user.name.toLowerCase(), u.user.id]));
        await ms.addUserMapping(userMap.filter(x => x && x.user).map(u => [u.user.profile.display_name.toLowerCase(), u.user.id]));
      }
      
      const hasSheetUrl = evt.text.match(/\<(https:\/\/.*google.com\/.*?\/d\/.*?)\>/);
      if (hasSheetUrl && /add/.test(evt.text)) {
        const channelInfo = await slack.conversations.info({
          channel: evt.channel
        });
        try {
          const sheetUrl = hasSheetUrl[1];
          const sb = new SheetBot({
            spreadsheetUrl: sheetUrl,
            clientAuth: ms.sheetbotAuth
          });
          const tryMessage = await sb.maybeMessage({ algorithm: "first_row" });
          const res = await ms.addSheet({
            sheetUrl,
            channelId: evt.channel,
            channelName: channelInfo.channel.name,
            userAdded: userData.user.name
          });
          console.log('addSheet', sheetUrl, evt.channel, res);
          await slack.chat.postMessage({
            channel: evt.channel,
            text: `We've added your sheet -- you or an admin can verify that it's setup here: <https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit>\nYou can change the algorithm (date_match or date_most_recent) and the schedule there. Please '@' this bot with the people that can appear in the spreadsheet and they will be @'d in the message.`
          });
        } catch(err) {
          console.log('addSheet ERROR', err);
          await slack.chat.postMessage({
            channel: evt.channel,
            text: `There was an error either accessing or adding your sheet: ${err.name}: ${err.message}\nMake sure your google sheet is shared with ${config.shareEmail || config.clientEmail}.\nMake sure the first column is a date, and make sure cell B1 is the template for your message.`
          });
        }
      }
    }
  }
  return jres({
    challenge: bodyJSON.challenge || "from handleSlackEvent"
  });
}

async function handleDebugWeb(ms, qs) {
  if (qs.channel) {
    await slack.chat.postMessage({
      text: 'Hello world!',
      channel: qs.channel
    });
  } else if (qs.loadUsers) {
    if (qs.addUser) {
      const x = await ms.addUserMapping([qs.addUser.split(':')]);
    }
    const userRes = await ms.loadUserMapping();
    console.log("USERS", userRes);
  } else if (qs.dedupe) {
    const res = await ms.deduplicateUserMapping();
    console.log("dedupe users", res);
  } else if (qs.sheetUrl) {
    console.log('sheetUrl', qs.sheetUrl);
    await ms.loadUserMapping();
    const sb = new SheetBot({
      spreadsheetUrl: qs.sheetUrl,
      clientEmail: config.clientEmail,
      clientPrivateKey: config.gPrivateKey,
      userMap: ms.users,
      shareEmail: config.shareEmail
    });
    const sbMessage = await sb.maybeMessage({
      algorithm: qs.algorithm || "first_row",
      fakedate: qs.date
    });
    if (sbMessage && qs.c) {
      await slack.chat.postMessage({
        text: sbMessage,
        channel: qs.c
      });
    }
    return jres({ message: sbMessage }); // INSECURE
  } else if (qs.schedule) {
    await handleCronTrigger(ms, { schedule: qs.schedule, fakedate: qs.date });
  }
  return jres({
    "message": "Hello from Lambda!"
  });
}

function testRun() {
  if (process.env.TEST) {
    const ms = new MetaSheet({
      spreadsheetId: config.spreadsheetId,
      clientEmail: config.clientEmail,
      clientPrivateKey: config.gPrivateKey,
      shareEmail: config.shareEmail
    });
    if (process.env.TEST == 'cron') {
      handleCronTrigger(ms, { schedule: "morning_9amET" });
    }
  }
}

exports.handler = awsHandler;

testRun();
