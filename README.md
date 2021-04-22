# row-bot
Slackbot that reads off weekly or daily roles from Google Sheets and posts them to a Slack channel given in the configuration.
row-bot can manage several role-bots all from a meta-Google Sheet.

# Use
After the bot is installed as an AWS Lambda function and Slack app with scheduled run events, you can use it!

Most users should interact with the `@row-bot` in Slack.
* Invite it to your channel
* Create a custom Google Sheet by copying the "Template for Service Sheet" tab in the Metasheet and share it with the email
  written in to the metasheet's first tab (or shared/setup by admins)
* `@` the row-bot with the sheet link along with any Slack users/names that may appear in the columns. This will help
  `@row-bot` @ them in the scheduled messages.


## Some terms:
* Metasheet: the spreadsheet that is the 'database' for row-bot listing all the 'sub'sheets ("sheetbots") which
  each describe a channel-message pair -- called a sheetbot
* Sheetbot: the spreadsheet for a particular message which is sent to a channel -- has
  the message and the rows used to base it on
* `schedule`: codename that corresponds to a setup time to run the bots which may result in a message to a slack channel
* `algorithm`: There are a few different algorithms that are available in the code which, if any, rows in a sheetbot match
  for a given run -- if a row is found, then a message will be sent.

## Behavior

Each row in the Metasheet's main sheet is a channel-sheet pair with some extra metadata/configuration. With Cloudwatch/cron events
that run the program at certain times with a "schedule", the rows that have that schedule value will send a message if there is one.

## Sheetbot config

In the Metasheet, there are three rows can be modified manually:

* schedule: should match a Cloudwatch/cron event (admins should update the list of options in the Metasheet's `A5` cell)
* algorithm: see below for current options -- non-admins might want to stick to `date_match` and `date_most_recent` and only
  do others in consultation with admins.
* B-column filter: If there is a value in this column, then only rows with the B-column value will be considered when
  run. If you are running multiple bots -- some daily and some weekly off the same base spreadsheet, this may be useful.
* Custom message cell (`"sheet!cell"`): The message cell defaults to B1 of the same sheet where the row data is, but you can customize this.
  Also, useful for making multiple messages off the same row data.

## Algorithms

* `date_match`: if the current date matches exactly the date in the first ("A") column of the sheetbot, then it will print a message
  using the data from that row.
* `date_most_recent`: Let's say you have a weekly rotation of roles. Then the date in the A column will be the Monday of each week.
  This algorithm, assuming it runs weekdaily, will then send a message based on the same week-value (since the next row will have a
  date in the future)
* `tomorrow_reminder`: looks for a date that matches *tomorrow*'s exact date. This helps setup reminders for tomorrow.
* `weekdays_after_topdate`: It's a little annoying to rotate week-daily schedules in a spreadsheet, because dragging dates down the left
  will include weekends. This algorithm looks at the date in the very first row. Then, regardless of any dates being present, it
  simply counts by-weekdays how many rows down it should go.
* `first_row` -- this always runs the first row -- mostly used for debugging/testing


# Installation
This bot is built with Node.js and NPM.  Install by running `npm install` in the repository folder.  AWS CLI is required if deploying using Claudia.js.

## Permissions & Config
- This bot uses a Google service account to authenticate.  The parameters `clientEmail` and `gPrivateKey` all come from the service account.  The service account needs read access to all spreadsheets used in the bot  but does not need write access (except for the meta-spreadsheet). Be sure to share the spreadsheet with `clientEmail`).
- `spreadsheetId` is the meta-Google Sheet
  - Make a copy of this spreadsheet: https://docs.google.com/spreadsheets/d/12i3hIWm51guQhjFtrHpN22nvIUmJRndj1xZqrp3o7xc/edit#gid=0 and add the service account's email address as an editor.

## Deployment
1. Copy `config.json.example` to `config.json` and fill with the appropriate API keys and filepaths.
2. On the command line, call `npm run deploy`
3. Tweak the Lambda configuration in the AWS console in a few places:
   - Under Asynchronous Invocation, change "Retry attempts" to 0 (default is often 2).
   - Under Permissions, click the role name (probably "row-bot-executor") and click Attach Policies. Then search for `AWSLambdaRole`. Check the box next to it and click the Attach Policy button
   - Make sure under General Configuration, Timeout is set to "15 min"
4. Add a CloudWatch scheduled event to run the bot on the desired schedule.  The actual contents of the event message will be ignored. (Better to create using AWS web console, there is an issue with duplicate events being created when scheduling using Claudia.js) The JSON input should include a 'schedule' value that will match the schedule column in the metasheet.  E.g. `{ "schedule": "morning_9amET" }`
5. Go to Slack admin interface
   * Create an App. 
   * Name should be 'row-bot'
   * Add `users:read`, `channels:read`, `chat:write` and `app_mentions:read` to OAuth Scopes
   * Enable Event Subscriptions and copy the API Gateway link provided when running `npm run deploy` to the event request URL.
     * Subscribe to these 'bot user events'
       * `app_mention`, `reaction_added`
   * Click 'Bots' and click 'Always show your bot as online'
     * click the Add Bot User button and then Save Changes
   * Click "Install App" and then "Install to Workspace"

## Updating AWS Lambda
To update AWS Lambda, call `npm run update` on the command line.

## Remove from AWS Lambda
To remove from AWS Lambda, call `npm run destroy` on the command line


# Development and Testing

## Code organization

Code is in three files

* `index.js`: this 'ties it all together' and is the sole place where Slack APIs and web access is. Start here.
  To get a sense of what this app is all about, read the `handleCronTrigger()` code -- the rest of the app
  is basically to help this trigger run.
* `metasheet.js`: the file defining the class MetaSheet which handles reading and writing from the metasheet
  which is basically the app's 'database'.
* `sheetbot.js`: defines `SheetBot` class and handles reading and parsing individual service sheets ("sheetbots").
  This file also is where the `algorithms` list is implemented -- to create a new one, simply add it to the
  dictionary here.

## Local testing
On the command line, run `TEST=cron node index.js`.  You may want to use a temporary Slack channel.

## AWS Lambda testing
To run from AWS lambda, call `npm run test` on the command line
