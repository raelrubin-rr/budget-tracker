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
```

Then add these environment variables in Vercel:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Notes:
- The app generates a local `profile_id` per browser and uses that ID to sync state across devices when you use the same profile ID.
- To share the exact same dataset across devices, open **Settings → Connection → Shared Dataset ID**, copy it from one device, and paste/save it on the other device.
- Only transaction data (transactions + transaction-level overrides) is cleared from Supabase automatically when a new billing cycle starts; all other settings remain unchanged until edited by the user.
- Persisted data includes transactions, transaction edits, account renames/visibility, income, savings goal, fixed expenses, billing history, and custom assets.
- A default manual custom asset is included for **SEIA 401(k)**, estimated using VT proxy performance with bi-weekly contributions, and is persisted in the same Supabase state payload.

