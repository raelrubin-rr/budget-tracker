# Budget Tracker

Personal budget tracker with Plaid bank integration.

## Deployment

This is deployed on Vercel with environment variables:
- PLAID_CLIENT_ID
- PLAID_SECRET
- OPENAI_API_KEY (optional, enables AI transaction categorization)
- OPENAI_MODEL (optional, defaults to gpt-4o-mini)

## Structure
- index.html - Main app
- api/ - Serverless functions for Plaid integration
