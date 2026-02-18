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
