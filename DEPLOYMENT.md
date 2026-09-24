# Vercel deployment

The app supports local files/JSON during development and PostgreSQL plus private Vercel Blob in the cloud. `vercel.json` deploys both Vite pages and `api/index.js`. Original PDF downloads are authorised, then streamed; admin uploads go directly to private Blob storage using a signed PUT URL scoped to one path for one hour, capped at 50 MB. Upload progress is displayed; interrupted uploads can be retried by selecting the file again.

## Required services

Connect a PostgreSQL database and a **private** Blob store to the Vercel project. Set these environment variables in Preview and Production before deployment:

- `DATABASE_URL`: a pooled PostgreSQL connection string (with TLS as supplied by the database provider).
- `BLOB_STORE_ID`: supplied when the private Blob store is connected to the project with OIDC authentication.
- `VERCEL_OIDC_TOKEN`: the short-lived credential supplied and rotated by Vercel. Do not replace it with a permanent secret.
- `ADMIN_PASSWORD`: a unique password at least 12 characters long, required in all environments.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`: test keys first; live keys only after testing the merchant account.
- `RAZORPAY_WEBHOOK_SECRET`: matches the Razorpay webhook configuration.

Never expose secrets through `VITE_` variables or commit `.env`. Deployment excludes local PDFs, local records and environment files via `.vercelignore`.

For an existing Blob connection, select **Upgrade to OIDC** from the project's menu on the Blob store's Projects tab. Redeploy after connecting the store. For local cloud development, use `vercel env pull .env` to refresh the short-lived credentials before starting the app or migration script.

## Commands

```sh
npm ci
npm test
npm run build
npm run test:browser
npx vercel login
npx vercel link
npx vercel deploy
```

The cloud database initialises automatically with catalogue data and no fake order records. For this existing project, migrate the local files and catalogue before opening the public site. Set the cloud connection variables in local `.env`, then run:

```sh
node scripts/migrate-cloud.js
```

Migration preserves local data and refuses to replace a populated cloud database. It copies order records, but browser cookies cannot transfer between localhost and the public domain. Admin and student sessions are persisted in the database so multiple function instances share authentication.

After checking the preview deployment, publish with:

```sh
npx vercel deploy --prod
```

## Verification on the deployed URL

Check `/`, `/admin/`, `/api/health`, and the admin login. Upload and replace a PDF over 4.5 MB; this must use Blob directly. Confirm the actual first two pages preview, page 3 cannot be fetched, unpaid downloads fail, and the uploaded original downloads after a verified test payment.

Configure Razorpay webhooks at `https://YOUR_DOMAIN/api/payments/webhook` for `payment.captured` and `order.paid`. Enable automatic capture. Automated local tests simulate the external gateway; they do not verify a real merchant transaction.

Storage and database charges depend on the selected service plans. Cloud provisioning and actual deployment require the account owner's Vercel sign-in.

Large uploads interrupted before finalisation can leave unattached private blobs; review and remove these periodically in the Blob dashboard. Do not delete blobs referenced by the catalogue. Maintain database and Blob backups together.
