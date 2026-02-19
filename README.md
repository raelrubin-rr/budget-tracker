# Raelyboy

This app is a private, personal use only, budget tracker for reviewing account balances, spending activity, and month-to-date progress in one place.

You can connect supported financial institutions through Plaid, including institutions that use OAuth-style authentication.

## Deployment

This is deployed on Vercel with environment variables:
- PLAID_CLIENT_ID
- PLAID_SECRET
- PLAID_ENV (optional, one of sandbox/development/production; defaults to sandbox)
- OPENAI_API_KEY (optional, enables AI transaction categorization)
- OPENAI_MODEL (optional, defaults to gpt-4o-mini)
- SUPABASE_URL (required for cross-device state persistence)
- SUPABASE_SERVICE_ROLE_KEY (required for cross-device state persistence)

### Plaid authentication troubleshooting

If you see `invalid client_id or secret provided` while creating a link token:

1. Verify `PLAID_CLIENT_ID` and `PLAID_SECRET` are copied from the same Plaid account and environment.
2. Set `PLAID_ENV` explicitly in Vercel (`sandbox`, `development`, or `production`).
3. If using production keys, make sure `PLAID_ENV=production`.
4. Re-save the variables and trigger a fresh deployment so runtime picks up new values.
5. Check for hidden spaces/newlines in copied secrets.
6. Some institutions may not support every Plaid product; this app requests `transactions` as required and `liabilities`/`investments` as optional to avoid unnecessary institution filtering in Link.

## Structure
- index.html - Main app
- api/ - Serverless functions for Plaid integration


## Supabase setup (required for cross-device persistence)

Run this SQL in your Supabase SQL editor:

```sql
create table if not exists public.budget_states (
  profile_id text primary key,
  cycle_id text,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists budget_states_cycle_id_idx on public.budget_states (cycle_id);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  email text not null unique,
  name text not null,
  phone text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
```

Then add these environment variables in Vercel:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Notes:
- The app generates a local `profile_id` per browser and uses that ID to sync state across devices when you use the same profile ID.
- To share the exact same dataset across devices, open **Settings → Connection → Shared Dataset ID**, copy it from one device, and paste/save it on the other device.
- Only transaction data (transactions + transaction-level overrides) is cleared from Supabase automatically when a new billing cycle starts; all other settings remain unchanged until edited by the user.
- Persisted data includes transactions, transaction edits, account renames/visibility, income, savings goal, fixed expenses, billing history, and custom assets.

- Authentication now uses `api/auth-register` and `api/auth-login` backed by Supabase `app_users`; each account syncs to an isolated profile id (`user::<user_id>`).
- New accounts start with a blank dashboard (no demo transactions/accounts and no default custom SEIA asset).

