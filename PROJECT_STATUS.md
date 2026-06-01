# The Lore Collector Bot - Project Status

## Goal

The Lore Collector is a Discord and Twitch Lorcana collection bot.

Users can:

- Pull cards from Discord commands such as `/daily`, `/pack`, and `/collection`.
- Pull cards from Twitch Channel Point redeems.
- Maintain a card collection.
- Track duplicate cards.
- Track Ink balances.
- Eventually trade and manage collections across Discord and Twitch.

The long-term goal is that a user's Discord collection and Twitch collection become one unified collection when they link their accounts.

## Current Branch

Active development is on:

```text
twitch-redeem-testing
```

Do not assume `main` contains the latest Twitch linking work.

## Main Files

`index.js`

Primary runtime. It currently contains:

- Discord bot setup and commands.
- Twitch chat client.
- Twitch EventSub listener.
- Express web server.
- Twitch OAuth account linking.
- Collection routing logic.

`lib/lorcana.js`

Shared game engine. It currently contains:

- Card lookup and rarity helpers.
- Embed generation.
- Collection helpers.
- Duplicate handling.
- Twitch collection helpers.
- Twitch-to-Discord merge helpers.

`twitch-redeem-test.js`

Legacy testing file. Treat as retired unless a future review proves it is still needed.

## Current State

Completed:

- OAuth account linking from Discord to Twitch.
- Temporary Twitch collection storage before linking.
- Automatic merge of Twitch-held cards during linking.
- `/balance` integration for linked and unlinked Twitch state.
- Unified runtime architecture in `index.js`.
- Test Supabase `linked_accounts.discord_user_id` duplicate check returned no rows, and the test unique index was added.
- EventSub online message now only posts after the Twitch redeem subscription succeeds.
- Linked Twitch redeems no longer overwrite the Discord user's stored username.
- Twitch collection merge now reports failure if cards cannot be added or rows cannot be marked merged.
- `test-twitch-merge.js` covers Twitch-held card merge quantities and confirms a second merge does not duplicate cards.
- Twitch OAuth `state` now uses a short-lived random nonce instead of exposing the Discord user id directly.
- `RUNBOOK.md` now documents EventSub token scope, validation, regeneration, and safe test steps.
- EventSub credentials were repaired for `.env.test` on 2026-06-01.
- `.env.test` now uses local callback port `3001` to avoid the other local bot on port `3000`.
- The Twitch Developer Console app has `http://localhost:3001/auth/twitch/callback` registered.
- EventSub subscription smoke test passed in test mode: Twitch accepted the Channel Point redemption subscription.

Pending:

- Live Twitch redeem validation.
- Production Supabase `linked_accounts.discord_user_id` duplicate check and unique index.
- Transactional Supabase merge RPC for fully atomic Twitch-to-Discord collection merging.
- `/unlinktwitch`.
- `/twitchcollection`.
- `/setprogress` and missing-card views.
- Improved OAuth success page.

## Important Safety Rule

The owner streams regularly while development is happening.

Safe work while live:

- Discord commands.
- OAuth work.
- Supabase work.
- Collection logic.
- Merge logic.
- UI and UX work.
- Refactoring.

Avoid while live:

- EventSub testing.
- Twitch redeem testing.
- Twitch reward testing.
- Twitch API changes affecting production channel behavior.

## Feature Flags

Testing currently uses `.env.test`.

Known safe test settings:

```text
TWITCH_CHAT_ENABLED=true
OVERLAY_ENABLED=false
OVERLAY_MODE=log
TWITCH_EVENTSUB_ENABLED=false
```

`TWITCH_EVENTSUB_ENABLED=false` is intentional. Do not re-enable automatically. Only enable it when specifically testing Twitch redeems and when it is safe to affect the Twitch channel.

## OAuth Linking

Flow:

```text
Discord /balance
-> Link Twitch Account button
-> Twitch OAuth
-> /auth/twitch/callback
-> Twitch user verified
-> linked_accounts saved
-> Twitch-held cards merged into Discord collection
```

OAuth has been verified with a real Twitch account.

The callback route is:

```text
GET /auth/twitch/callback
```

Local callback:

```text
http://localhost:3001/auth/twitch/callback
```

The current success page is plain text.

OAuth link requests use a short-lived in-memory nonce. If the bot restarts after a user clicks the Discord link but before Twitch redirects back, the callback asks the user to return to Discord and try again.

## Twitch Redeems

Current intended redeem behavior:

- If the Twitch account is linked, save the card directly to the Discord collection in `user_cards`.
- If the Twitch account is not linked, save the card to `twitch_user_cards`.
- For unlinked users, post a Discord embed and show a Link Twitch button.
- When the user links later, merge the saved Twitch cards into the Discord collection.

## Decisions

- Use OAuth-based Twitch linking only.
- Do not bring back public Twitch chat link codes.
- Keep one active runtime in `index.js`.
- Keep shared game logic in `lib/lorcana.js`.
- Keep Twitch collection history after merge for auditability.
- Do not store Twitch-only collections directly in `user_cards`.

## Current Blocker

EventSub credential repair is complete for `.env.test`.

`TWITCH_EVENTSUB_ENABLED=false` remains intentional because live redeem validation is still pending and should only happen during a safe test window.

Previous blocker:

```text
Invalid OAuth token
```

Current verified state:

- `TWITCH_ACCESS_TOKEN` validates against the current `TWITCH_CLIENT_ID`.
- Token user matches `TWITCH_BROADCASTER_ID` for `feyredarrling`.
- Token has `channel:read:redemptions`.
- A test-mode EventSub WebSocket subscription succeeded.
- No live redeems have been tested yet because the owner was live.
