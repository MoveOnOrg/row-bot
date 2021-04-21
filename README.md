# row-bot
Slackbot that reads off weekly or daily roles from Google Sheets and posts them to a Slack channel given in the configuration.
row-bot can manage several role-bots all from a meta-Google Sheet.

# Use
After the bot is installed as an AWS Lambda function and Slack app. Setup the appropriate CloudWatch events for each schedule.
Interaction thereafter can be managed by `@`ing the row-bot, inviting it to your channels and editing the meta-Google Sheet

# Installation
This bot is built with Node.js and NPM.  Install by running `npm install` in the repository folder.  AWS CLI is required if deploying using Claudia.js.

# Permissions & Config
- This bot uses a Google service account to authenticate.  The parameters `clientEmail` and `gPrivateKey` all come from the service account.  The service account needs read access to all spreadsheets used in the bot  but does not need write access (except for the meta-spreadsheet). Be sure to share the spreadsheet with `clientEmail`).
- `spreadsheetId` is the meta-Google Sheet

# Deployment
1. Copy `config.json.example` to `config.json` and fill with the appropriate API keys and filepaths.
2. On the command line, call `npm run deploy`
3. Add a CloudWatch scheduled event to run the bot on the desired schedule.  The actual contents of the event message will be ignored. (Better to create using AWS web console, there is an issue with duplicate events being created when scheduling using Claudia.js)
4. Go to Slack admin interface
   * Create an App. 
   * Name should be 'row-bot'
   * Add `users:read`, `channels:read`, `chat:write` and `app_mentions:read` to OAuth Scopes
   * Enable Event Subscriptions and copy the API Gateway link provided when running `npm run deploy` to the event request URL.
     * Subscribe to these 'bot user events'
       * `app_mention`, `reaction_added`
   * Click 'Bots' and click 'Always show your bot as online'
     * click the Add Bot User button and then Save Changes
   * Click "Install App" and then "Install to Workspace"

# Local testing
On the command line, run `TEST=cron node index.js`.  You may want to use a temporary Slack channel.

# AWS Lambda testing
To run from AWS lambda, call `npm run test` on the command line

# Updating AWS Lambda
To update AWS Lambda, call `npm run update` on the command line.

# Remove from AWS Lambda
To remove from AWS Lambda, call `npm run destroy` on the command line
