# TODO

## Highest Priority

- Review the current Twitch OAuth and EventSub diff for bugs.
- Re-enable `TWITCH_EVENTSUB_ENABLED=true` only during a safe off-stream redeem test window.
- Test Twitch redeem behavior for a linked account.
- Test Twitch redeem behavior for an unlinked account.
- Test merge behavior when an unlinked Twitch user links later.
- Verify repeated linking and unlinking does not cause duplicate merges.
- Create a transactional Supabase RPC for Twitch-to-Discord collection merging.

## Medium Priority

- Add `/unlinktwitch`.
- Add `/twitchcollection` so users can view Twitch-held cards before linking.
- Improve the OAuth success page.
- Clean up stale comments around unlinked Twitch pulls.
- Add `/setprogress`.
- Add a missing cards command.
- Improve collection summaries with total cards, unique cards, duplicate count, and total ink value.

## Lower Priority

- Decide whether `twitch-redeem-test.js` should be deleted, renamed, or kept as legacy reference.
- Move more shared collection logic from `index.js` into `lib/lorcana.js`.
- Document deployment assumptions for the Express callback route.
- Add more Twitch redeem types for set-specific packs.
- Plan seasonal packs for Father's Day, release days, and holidays.
- Build OBS/browser-source overlay transport.
- Explore trading, marketplace, collection export, multi-streamer, and SaaS directions.

## Open Questions

- Should Twitch pull embeds always include a Link Twitch button?
- Should linked users see Twitch status in `/collection`?
- Should there be a dedicated `/profile` command?
- Should `/twitchcollection` exist after linking?
- Should Twitch-only cards remain visible after merge?
- How should set completion and missing cards be displayed?
- Should this stay single-streamer only, or eventually support multi-streamer/commercial use?

## Done

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
