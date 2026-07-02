# Hotel Fusion Suites — Vercel + GitHub setup

This version does not use Google Apps Script or Google Sheets.

## 1. Create the database

In the Vercel project, open **Storage** and create a **Neon Postgres** database. Connect it to the project so Vercel adds `DATABASE_URL`.

Open the Neon SQL editor and run the complete contents of `database/schema.sql`. This creates the hotel tables and initial room inventory.

## 2. Configure login

Add these Vercel environment variables for Production, Preview, and Development:

- `ADMIN_USER` — the login name (for example `ADMIN`)
- `ADMIN_PASSWORD` — a strong private password
- `AUTH_SECRET` — a random secret of at least 32 characters

## 3. Deploy

Push this folder to GitHub, then import that repository in Vercel. Vercel installs the dependency from `package.json` and deploys `api/hotel.js` as a serverless function. Every push to the main branch will redeploy automatically.

## 4. Verify

Open the deployed URL and sign in. Test in this order:

1. Create a check-in.
2. Record a payment.
3. Confirm Outstanding decreases.
4. Attempt checkout with a balance (it must be blocked).
5. Clear the balance and check out.
6. Mark the room cleaned and confirm it becomes available.

The old static demo entry page is preserved as `legacy-demo-index.html`.
