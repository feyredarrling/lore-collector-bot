# TODO

This is the short working list. Pick one item and keep the chat focused on it.

## Highest Priority

- Re-enable `TWITCH_EVENTSUB_ENABLED=true` only during a safe off-stream redeem test window.
- Test Twitch redeem behavior for a linked account.
- Test Twitch redeem behavior for an unlinked account.
- Test merge behavior when an unlinked Twitch user links later.
- Verify repeated linking and unlinking does not cause duplicate merges.
- Create a transactional Supabase RPC for Twitch-to-Discord collection merging.

## Next Feature Choices

- Add `/unlinktwitch`.
- Add `/twitchcollection` so users can view Twitch-held cards before linking.
- Add `/setprogress` with completion percentage, missing cards, unique owned, and total owned.
- Add a missing cards command.
- Improve collection summaries with duplicate count and total ink value.
- Improve the OAuth success page.

## Later

- Decide whether `twitch-redeem-test.js` should be deleted, renamed, or kept as legacy reference.
- Move more shared collection logic from `index.js` into `lib/lorcana.js`.
- Document deployment assumptions for the Express callback route.
- Add more Twitch redeem types for set-specific packs.
- Plan seasonal packs for Father's Day, release days, and holidays.
- Build OBS/browser-source overlay transport.
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
