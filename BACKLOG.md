# Backlog

This file is the practical backlog index for The Lore Collector bot. Code is the source of truth; this file should stay focused on what is still useful to choose next.

## Must Do Next

- Decide whether to keep `TWITCH_EVENTSUB_ENABLED=false` as the manual safety switch or add a safer test/start script.
- Build `/unlinktwitch`.
- Build `/twitchcollection` so users can view Twitch-held cards before linking.

## Completed / Already Implemented

- Whole collection binder exists through `/collection`.
- `/collection` now supports an optional Lorcana set filter.
- `/collection` now supports an optional rarity filter.
- `/collection` keeps Super Rare and Epic as separate rarity filters.
- Collection binder pagination is reused for whole-collection, set-filtered, and rarity-filtered views.
- Duplicate viewing exists through `/dupes`.
- Basic collection summary shows total cards and unique cards.
- OAuth-based Twitch linking exists.
- Unlinked Twitch pulls can be saved in `twitch_user_cards`.
- Twitch-held cards can merge into a Discord collection during linking.
- EventSub credentials are repaired for `.env.test`.
- EventSub subscription smoke test passed without live redeems.
- Linked live test redeem routed to `user_cards`.
- Unlinked live test redeem routed to `twitch_user_cards`.
- Unlinked Twitch chat messages include the direct Discord channel URL where the pull embed appears.
- Automatic Twitch-to-Discord merge was verified with real test rows.
- Repeat merge returned zero merged cards and did not duplicate the collection.
- EventSub accepts live `Pull:` reward titles and test `TEST Pull:` reward titles.
- Twitch pull Discord embeds use `TWITCH_PULL_DISCORD_CHANNEL_ID`, with `DISCORD_TEST_CHANNEL_ID` only as the local test fallback.
- Live Twitch channel point rewards have been created and are currently disabled while streaming.

## Bugs And Risks

- EventSub remains disabled by default with `TWITCH_EVENTSUB_ENABLED=false`.
- EventSub token is time-limited and may need regeneration before a later test window.
- Previous EventSub error was `Invalid OAuth token`.
- OAuth linking works independently from EventSub.
- Merge logic exists but has not been tested with large Twitch collections.
- Repeated linking and unlinking beyond the verified repeat-merge helper path still needs full UX testing.
- Twitch pulls after linking have been verified once in test mode, but should be checked again before production enablement.

## Still Pending

### Account Linking

- `/unlinktwitch`
  - Remove Twitch link.
  - Allow relinking.
  - Preserve collection data.
- `/twitchcollection`
  - View Twitch-held cards before linking.

### Collection Features

- `/setprogress`
  - Completion percentage.
  - Missing cards.
  - Unique owned.
  - Total owned.
- Missing cards command.
- Collection summary improvements:
  - Duplicate count in the main collection summary.
  - Total ink value.

### Twitch Features

- Add Link Twitch button to Twitch pull embeds.
- Run the first production redeem check after stream with one low-cost `Pull:` reward.
- Add future set channel point rewards as new Lorcana sets are supported.
- Seasonal packs:
  - Mother's Day.
  - Father's Day.
  - Release Day packs.
  - Holiday packs.

### Overlay System

- OBS/browser source transport.
- Stream pull feed.
- Real-time recent pulls overlay.

### Future Major Features

- Trading system.
- Trade marketplace.
- Collection export.
- Multi-streamer support.
- Sellable SaaS version.

## Decisions Already Made

### Architecture

- `index.js` is the single runtime for Discord, Twitch Chat, Twitch EventSub, OAuth, and the Express server.
- `lib/lorcana.js` is the shared game logic layer.

### Environment Separation

- Production uses `.env`, production Supabase, and production Discord bot resources.
- Testing uses `.env.test`, test Supabase, test Discord bot, and test Discord channel.
- `.env.test` uses local port `3001` for the Express callback because port `3000` is used by another local bot.
- The Twitch Developer Console app includes `http://localhost:3001/auth/twitch/callback`.
- Production must set `TWITCH_PULL_DISCORD_CHANNEL_ID` to the real Discord channel for Twitch pull embeds before enabling EventSub.

### Account Linking

- Linking is OAuth-based only.
- Do not use public link codes.
- No `/linktwitch` command is required right now.

Flow:

```text
Discord
-> Link Twitch button
-> Twitch OAuth
-> Verified Twitch user
-> Save link
```

### Collection Strategy

```text
Discord pulls
-> user_cards

Twitch pulls before linking
-> twitch_user_cards

Account linking
-> merge Twitch cards into Discord collection

Future Twitch pulls
-> save directly into Discord collection
```

### Twitch Collection Retention

- Do not discard Twitch collection history.
- Use `merged_to_discord_user_id` and `merged_at` for auditability.

### Safety During Streaming

Do not test these while live:

- EventSub.
- Twitch redeems.
- Channel point rewards.

Safe while streaming:

- OAuth work.
- Discord commands.
- Database work.
- Collection logic.
- Refactoring.
- UI improvements.

## Things Tried

### Twitch Link Codes

Tried:

```text
!link ABC123
```

Decision:

- Abandoned.

Reasons:

- Public in Twitch chat.
- Easy to mistype.
- Poor UX.
- OAuth is cleaner.

### Separate Twitch Test Runtime

Originally used:

```text
twitch-redeem-test.js
```

Decision:

- Retired.

Reason:

- Single runtime is easier.
- Everything now runs through `index.js`.

### Skipping Unlinked Twitch Pulls

Original behavior:

```text
No link
-> pull ignored
```

Decision:

- Changed.

New behavior:

```text
No link
-> save to twitch_user_cards
```

Reason:

- Users may collect for months before joining Discord.

## Things Not To Do

- Do not delete Twitch-held cards after merge testing is complete.
- Do not force account linking before allowing Twitch pulls.
- Do not bring back public Twitch link codes.
- Do not split Twitch functionality back into separate runtimes.
- Do not test live redeems while actively streaming.
- Do not store Twitch-only collections directly in `user_cards`.
- Do not bypass OAuth verification.

## Open Questions

### Account Linking UX

- Should Twitch pull embeds always include a Link Twitch button?
- Should linked users see Twitch status in `/collection`?
- Should there be a dedicated `/profile` command?

### Twitch Collection UX

- Should `/twitchcollection` exist after linking?
- Should Twitch-only cards remain visible after merge?

### OAuth Success UX

Current:

```text
Twitch account linked successfully.
```

Future possibilities:

- Styled page.
- Auto-close.
- Redirect back to Discord.
- Better instructions.

### Collection Features

- How should set completion be displayed?
- How should missing cards be displayed?
- Should ink totals appear everywhere?

### Future Business Direction

- Single streamer bot only?
- Multi-streamer support?
- Commercial/SaaS offering?
