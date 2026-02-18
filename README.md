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

## Structure
- index.html - Main app
- api/ - Serverless functions for Plaid integration
