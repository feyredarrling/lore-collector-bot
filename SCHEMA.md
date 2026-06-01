# Supabase Schema Notes

This file records the table assumptions used by the bot. Keep it updated when Supabase changes.

## `user_cards`

Main Discord collection storage.

Used when:

- A Discord user pulls a card.
- A linked Twitch user redeems a card pull.
- Twitch-held cards are merged after linking.

Known fields used by the code include:

- `discord_user_id`
- `username`
- `card_id`
- `quantity`

## `linked_accounts`

Stores Discord-to-Twitch account links.

Columns:

- `discord_user_id`
- `twitch_user_id`
- `twitch_username`
- `linked_at`
- `updated_at`

Known constraint:

- Unique index exists on `twitch_user_id`.
- Test database has a unique index on `discord_user_id`.

Current code upserts with:

```text
onConflict: discord_user_id
```

Production still needs the duplicate check and `discord_user_id` unique index before this flow goes live.

Duplicate check:

```sql
select discord_user_id, count(*)
from linked_accounts
group by discord_user_id
having count(*) > 1;
```

Index:

```sql
create unique index if not exists linked_accounts_discord_user_id_key
on linked_accounts (discord_user_id);
```

Review this if relinking behavior changes.

## `twitch_user_cards`

Stores Twitch pulls before a Twitch account is linked to Discord.

Columns:

- `id`
- `twitch_user_id`
- `twitch_username`
- `card_id`
- `quantity`
- `first_pulled_at`
- `last_pulled_at`
- `merged_to_discord_user_id`
- `merged_at`

Known constraint:

- Unique on `(twitch_user_id, card_id)`.

Merge behavior:

- Unmerged rows have `merged_at` set to `null`.
- During linking, quantities are added to the Discord collection.
- Rows are kept for audit/history and marked with `merged_to_discord_user_id` and `merged_at`.
