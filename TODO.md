# TODO

This is the short working list. Pick one item and keep the chat focused on it.

## Highest Priority

- Improve the OBS overlay on branch `codex/overlay`.
- Create a transactional Supabase RPC for Twitch-to-Discord collection merging.
- Add `/unlinktwitch`.
- Add `/twitchcollection` so users can view Twitch-held cards before linking.

## Next Feature Choices

- Add `/setprogress` with completion percentage, missing cards, unique owned, and total owned.
- Add a missing cards command.
- Improve collection summaries with duplicate count and total ink value.

## Later

- Decide whether `twitch-redeem-test.js` should be deleted, renamed, or kept as legacy reference.
- Move more shared collection logic from `index.js` into `lib/lorcana.js`.
- Document deployment assumptions for the Express callback route.
- Improve duplicate pull wording and quantity display in Discord embeds and the OBS overlay.
- Add more Twitch redeem types for set-specific packs.
- Plan seasonal packs for Father's Day, release days, and holidays.
- Explore trading, marketplace, collection export, multi-streamer, and SaaS directions.

## Done

- Implement whole collection viewing through `/collection`.
- Implement duplicate viewing through `/dupes`.
- Implement basic collection totals for total cards and unique cards.
- Add a `/collection` set option so users can view all sets or one Lorcana set while preserving binder pagination.
- Add a `/collection` rarity option so users can view all rarities or one rarity while preserving binder pagination.
- Split Super Rare and Epic into separate `/collection` rarity filter choices.
- Add Express dependency.
- Add Twitch OAuth callback route.
- Replace temporary link-code flow with Twitch OAuth.
- Add `linked_accounts` lookup for Twitch redeems.
- Add `twitch_user_cards` support for unlinked Twitch pulls.
- Add Twitch-to-Discord merge helper.
- Show linked Twitch account in `/balance`.
- Add `test-twitch-merge.js` for Twitch collection merge quantities and double-merge protection.
- Harden Twitch OAuth `state` with short-lived random nonces.
- Document required Twitch OAuth scopes and EventSub token generation steps.
- Fix EventSub credentials for the current Twitch application in `.env.test`.
- Move the `.env.test` local callback to port `3001`.
- Add the port `3001` callback URL to the Twitch Developer Console app.
- Verify EventSub subscription creation in test mode without live redeems.
- Test Twitch redeem behavior for a linked account.
- Test Twitch redeem behavior for an unlinked account.
- Add direct Discord channel URL to the unlinked Twitch chat message.
- Test merge behavior when an unlinked Twitch user links later.
- Verify repeat merge does not duplicate cards.
- Treat missing test Supabase `announcements` table as a non-blocking warning.
- Accept live `Pull:` reward titles while keeping `TEST Pull:` for tests.
- Route Twitch pull Discord embeds through `TWITCH_PULL_DISCORD_CHANNEL_ID` instead of hardcoding the test channel.
- Build OBS/browser-source overlay transport.
- Add Twitch launch checklist for production env and first redeem verification.
- Create live Twitch channel point rewards named with `Pull:`.
- Merge Twitch work to `main` and deploy to Railway production.
- Add Railway `npm start` script.
- Remove Discord startup message for EventSub listener.
- Add Twitch access token refresh support with `TWITCH_REFRESH_TOKEN`.
- Configure Railway Twitch chat credentials so replies come from `TheLoreCollectorBot`.
- Add production Supabase `linked_accounts` and `twitch_user_cards`.
- Fix production OAuth redirect to Railway callback URL.
- Verify production redeem end to end: EventSub, Twitch chat response, Discord embed, database save, OAuth linking, and OBS overlay.
- Improve the OAuth callback page with styled Twitch link success and error states.
- Fix pack reveal crash caused by bare `rarityEmoji` references in `index.js`.
- Refund `itzelw` (`412795824280436757`) 250 Ink after the failed Premium Pack reveal.
- Add `Pull: Fabled` support for Twitch redeems.
- Confirm `jennoras`'s failed `Pull: Fabled` redeem was ignored before saving a card, requiring a Twitch channel point refund/retry.
- Add a `NEW` badge to the OBS overlay when a Twitch pull is new to the user's collection.
