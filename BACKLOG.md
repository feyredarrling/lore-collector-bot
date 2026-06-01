# Backlog

This file is the practical backlog index for The Lore Collector bot. Code is the source of truth; this file should stay focused on what is still useful to choose next.

## Completed / Already Implemented

- Whole collection binder exists through `/collection`.
- `/collection` now supports an optional Lorcana set filter.
- `/collection` now supports an optional rarity filter.
- `/collection` keeps Super Rare and Epic as separate rarity filters.
- Collection binder pagination is reused for whole-collection and set-filtered views.
- Collection binder pagination is reused for rarity-filtered views.
- Duplicate viewing exists through `/dupes`.
- Basic collection summary shows total cards and unique cards.

## Still Pending

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

### Future Major Features

- Trading system.
- Trade marketplace.
- Collection export.
- Multi-streamer support.
- Sellable SaaS version.

## Safety Notes

- This branch was created from `main`.
- This work does not touch Twitch EventSub, Twitch redeems, Twitch credentials, or production settings.
- Test with `NODE_ENV=test` and `.env.test` only.
