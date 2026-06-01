# Runbook

## Test Environment

Testing should use `.env.test`.

On Windows Command Prompt:

```bat
set NODE_ENV=test
node index.js
```

On PowerShell:

```powershell
$env:NODE_ENV = "test"
node index.js
```

`index.js` loads `.env.test` when `NODE_ENV=test`.

## Production Environment

Production uses `.env`.

Do not run production unintentionally. Confirm the intended environment before running commands that connect to Discord, Twitch, or Supabase.

## Current Test Feature Flags

Expected `.env.test` flags:

```text
TWITCH_CHAT_ENABLED=true
OVERLAY_ENABLED=false
OVERLAY_MODE=log
TWITCH_EVENTSUB_ENABLED=false
```

Do not enable `TWITCH_EVENTSUB_ENABLED` unless specifically testing Twitch redeems.

## Local Web Server

The Express server runs from `index.js`.

Default port:

```text
3000
```

Health route:

```text
GET /
```

Twitch OAuth callback:

```text
GET /auth/twitch/callback
```

Local callback URL:

```text
http://localhost:3000/auth/twitch/callback
```

OAuth link requests use a short-lived in-memory nonce. If the bot restarts after a user clicks the Discord link but before Twitch redirects back, the callback asks the user to return to Discord and try again.

## Safe Testing While Live

Safe:

- Discord command behavior in the test Discord server.
- OAuth account linking with test resources.
- Supabase reads and writes in the test project.
- Collection merge logic.
- Non-live UI or copy changes.

Avoid:

- Enabling EventSub.
- Testing real Channel Point redeems.
- Changing Twitch reward configuration.
- Running production bot settings.

## Suggested Preflight Checks

Before risky testing:

```powershell
git status --short --branch
```

```powershell
Select-String -LiteralPath ".env.test" -Pattern "BOT_MODE|TWITCH_EVENTSUB_ENABLED|TWITCH_CHAT_ENABLED|SUPABASE|DISCORD|TWITCH"
```

For syntax checks:

```powershell
node --check index.js
node --check lib\lorcana.js
```

## Twitch Merge Test

This writes only clearly fake rows to the test Supabase database and cleans them up before and after the run.

PowerShell:

```powershell
$env:NODE_ENV = "test"
node test-twitch-merge.js
```

Expected output:

```text
Twitch merge test passed.
```

## EventSub Token Runbook

Use this when fixing or testing Twitch Channel Point redeem listening.

Current blocker:

```text
Invalid OAuth token
```

The bot uses `TWITCH_ACCESS_TOKEN` to create this EventSub subscription:

```text
channel.channel_points_custom_reward_redemption.add
```

Per Twitch's EventSub docs, that subscription needs a broadcaster user access token with one of these scopes:

```text
channel:read:redemptions
channel:manage:redemptions
```

Use `channel:read:redemptions` unless the bot needs to manage redemption status later.

The token must match:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `TWITCH_BROADCASTER_ID`
- the Twitch broadcaster account whose Channel Point rewards are being watched

It must not be an app access token. EventSub Channel Point redeems require a user access token authorized by the broadcaster.

### Validate Current Token

PowerShell:

```powershell
$headers = @{ Authorization = "Bearer $env:TWITCH_ACCESS_TOKEN" }
Invoke-RestMethod -Uri "https://id.twitch.tv/oauth2/validate" -Headers $headers
```

Check that the response has:

- `client_id` equal to `TWITCH_CLIENT_ID`
- `user_id` equal to `TWITCH_BROADCASTER_ID`
- `scopes` containing `channel:read:redemptions` or `channel:manage:redemptions`
- `expires_in` greater than zero

If validation fails or the values do not match, regenerate the token for the current Twitch app and broadcaster.

### Generate A New Token

Use the current Twitch application from the Twitch Developer Console.

Authorization URL shape:

```text
https://id.twitch.tv/oauth2/authorize?client_id=TWITCH_CLIENT_ID&redirect_uri=TWITCH_REDIRECT_URI&response_type=code&scope=channel:read:redemptions
```

After Twitch redirects back with `code=...`, exchange the code server-side with:

```text
POST https://id.twitch.tv/oauth2/token
client_id=TWITCH_CLIENT_ID
client_secret=TWITCH_CLIENT_SECRET
code=AUTHORIZATION_CODE
grant_type=authorization_code
redirect_uri=TWITCH_REDIRECT_URI
```

Save the returned access token as `TWITCH_ACCESS_TOKEN` in `.env.test` first.

If Twitch returns a refresh token, keep it somewhere private. Do not commit it.

### Safe EventSub Test

Only do this during a safe Twitch test window.

1. Confirm the stream is not in a moment where test redeems would be disruptive.
2. Confirm `.env.test` points at test Supabase and test Discord.
3. Set:

```text
TWITCH_EVENTSUB_ENABLED=true
```

4. Start the bot in test mode:

```powershell
$env:NODE_ENV = "test"
node index.js
```

5. Expected success signs:

- Console logs `Subscribed to Twitch Channel Point redeems.`
- Test Discord receives `Twitch redeem listener is online.`

6. Expected failure signs:

- Console logs `Twitch subscription error:`
- Test Discord does not receive the online message.

7. After testing, set:

```text
TWITCH_EVENTSUB_ENABLED=false
```

### Sources

- Twitch EventSub subscription type docs: `channel.channel_points_custom_reward_redemption.add`
- Twitch token validation docs: `https://id.twitch.tv/oauth2/validate`
