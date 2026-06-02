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

Before merging Twitch work into `main` and enabling production redeems, confirm production `.env` points at:

```text
SUPABASE_URL=<production Supabase project>
SUPABASE_SERVICE_ROLE_KEY=<production Supabase service role>
DISCORD_TOKEN=<production Discord bot token>
DISCORD_CLIENT_ID=<production Discord app client ID>
ALLOWED_CHANNEL_IDS=<production Discord command channel IDs>
TWITCH_CLIENT_ID=<production Twitch app client ID>
TWITCH_CLIENT_SECRET=<production Twitch app client secret>
TWITCH_ACCESS_TOKEN=<production broadcaster token with channel:read:redemptions>
TWITCH_REFRESH_TOKEN=<production broadcaster refresh token>
TWITCH_REDIRECT_URI=<production OAuth callback URL>
TWITCH_PULL_DISCORD_CHANNEL_ID=<production Discord channel for Twitch pull embeds>
TWITCH_CHAT_USERNAME=<Twitch bot account username>
TWITCH_CHAT_OAUTH=<Twitch bot chat OAuth token>
TWITCH_CHAT_CHANNEL=<production Twitch channel>
TWITCH_BROADCASTER_ID=<production Twitch broadcaster ID>
TWITCH_EVENTSUB_ENABLED=true
```

Do not copy `.env.test` values into production.

## Twitch Launch Checklist

Use this only when you are not live or when you are ready for an intentional production launch window.

Before merging to `main`:

- Confirm `twitch-redeem-testing` is clean and up to date with `main`.
- Confirm `.env.test` still points at test Supabase, test Discord, and port `3001`.
- Confirm the Twitch reward names use `Pull:` exactly.
- Confirm OBS has a browser source pointed at `/overlay` with a transparent background.

Before enabling production EventSub:

- Confirm production Supabase env vars are set in the production host.
- Confirm production Discord bot token and client ID are set.
- Confirm `ALLOWED_CHANNEL_IDS` contains the real command channels.
- Confirm `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_ACCESS_TOKEN`, `TWITCH_REFRESH_TOKEN`, and `TWITCH_REDIRECT_URI` are production values.
- Confirm `TWITCH_PULL_DISCORD_CHANNEL_ID` is the real Discord channel for Twitch pull embeds.
- Confirm `TWITCH_CHAT_USERNAME` and `TWITCH_CHAT_OAUTH` are set if `TWITCH_CHAT_ENABLED=true`.
- Confirm `TWITCH_CHAT_CHANNEL` and `TWITCH_BROADCASTER_ID` are the real Twitch channel.
- Confirm the production Twitch token has `channel:read:redemptions`.
- Set `TWITCH_EVENTSUB_ENABLED=true` only for the intended production launch.

First production check:

- Redeem one low-cost `Pull:` reward while not in an active stream moment.
- Confirm Twitch chat response appears.
- Confirm Discord receives the card embed in the real pull channel.
- Confirm OBS shows the card overlay.
- If anything looks wrong, set `TWITCH_EVENTSUB_ENABLED=false` before debugging.

## Current Test Feature Flags

Expected `.env.test` flags:

```text
TWITCH_CHAT_ENABLED=true
OVERLAY_ENABLED=false
OVERLAY_MODE=log
TWITCH_EVENTSUB_ENABLED=false
TWITCH_PULL_DISCORD_CHANNEL_ID=<test Discord channel ID>
```

Do not enable `TWITCH_EVENTSUB_ENABLED` unless specifically testing Twitch redeems.

## Local Web Server

The Express server runs from `index.js`.

Default port:

```text
3001 (.env.test)
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
http://localhost:3001/auth/twitch/callback
```

OAuth link requests use a short-lived in-memory nonce. If the bot restarts after a user clicks the Discord link but before Twitch redirects back, the callback asks the user to return to Discord and try again.

The Twitch Developer Console app must include this exact test callback URL:

```text
http://localhost:3001/auth/twitch/callback
```

## OBS Overlay

The browser-source overlay is served by the same Express server:

```text
http://localhost:3001/overlay
```

For local testing, start the bot with:

```powershell
$env:NODE_ENV = "test"
$env:OVERLAY_ENABLED = "true"
$env:OVERLAY_MODE = "browser"
node index.js
```

Trigger a preview event without using Twitch redeems:

```text
http://localhost:3001/overlay/test
```

OBS should use a transparent browser source. The overlay listens for Twitch pull events and displays the viewer name, card image, card name, rarity, set, and new/quantity status.

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

## Twitch Channel Point Reward Names

Live Lorcana pull rewards should use this title shape:

```text
Pull: The First Chapter
Pull: Rise of the Floodborn
Pull: Into the Inklands
Pull: Ursula's Return
Pull: Shimmering Skies
Pull: Azurite Sea
```

Test rewards with this shape are still accepted for controlled testing:

```text
TEST Pull: The First Chapter
```

The bot ignores channel point rewards that do not start with `Pull:` or `TEST Pull:`.

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

Previous blocker:

```text
Invalid OAuth token
```

Status as of 2026-06-01:

- `.env.test` has a repaired broadcaster user access token.
- Validation passed for the current `TWITCH_CLIENT_ID`.
- Validation passed for the configured `TWITCH_BROADCASTER_ID`.
- Validation confirmed `channel:read:redemptions`.
- A test-mode EventSub subscription smoke test succeeded.
- Linked live test redeem validation succeeded.
- Unlinked live test redeem validation succeeded.
- Unlinked Twitch chat messages include a direct Discord channel URL.
- Automatic Twitch-to-Discord merge moved real test Twitch rows into the linked Discord collection.
- Repeat merge returned zero merged cards and did not duplicate the collection.
- `TWITCH_EVENTSUB_ENABLED=false` should remain the default outside a safe redeem test window.

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

For the current test environment, `TWITCH_REDIRECT_URI` is:

```text
http://localhost:3001/auth/twitch/callback
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
- Discord does not receive a startup message; startup success is logged only in the console.

6. Expected failure signs:

- Console logs `Twitch subscription error:`
- Console does not log `Subscribed to Twitch Channel Point redeems.`

7. After testing, set:

```text
TWITCH_EVENTSUB_ENABLED=false
```

### Verified Redeem Results

As of 2026-06-01:

- Linked `TEST Pull:` redeem saved to `user_cards`.
- Unlinked `TEST Pull:` redeem saved to `twitch_user_cards`.
- Unlinked chat response included the direct Discord channel URL for the pull embed.
- Re-link/merge behavior was verified by calling the same merge helper used by the OAuth callback.
- A second merge call returned `mergedCount: 0`.

### Sources

- Twitch EventSub subscription type docs: `channel.channel_points_custom_reward_redemption.add`
- Twitch token validation docs: `https://id.twitch.tv/oauth2/validate`
