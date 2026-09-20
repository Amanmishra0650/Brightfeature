# Bright Future Notes

Responsive React storefront and admin dashboard with a Node.js API and persistent local demo data.

## Run locally

Use Node.js 20.19+ and npm. From the project folder:

```sh
npm install
npm run build
npm start
```

- Storefront: http://localhost:4000/
- Admin: http://localhost:4000/admin/
- Set a unique `ADMIN_PASSWORD` of at least 12 characters in your local environment before starting the app.

For development, run `npm run dev`, then visit http://127.0.0.1:5173/frontend/ or http://127.0.0.1:5173/admin/. This starts the API on port 4000 and Vite on port 5173. Stop an existing production server before starting development.

## Included

- Five exam categories, search, price sorting and responsive navigation.
- Previews of the first two pages of each uploaded PDF, with locked blurred placeholders for later pages. Public preview routes serve images, never the original PDF or later pages.
- Razorpay checkout and a private library. Downloads return the original uploaded PDF only after the server verifies a captured payment, order ID, signature, amount and currency.
- Admin login, overview, catalogue creation/editing/deletion, publication controls, order status updates and offer settings.
- Admin PDF uploads and replacements (up to 50 MB each). Invalid or encrypted PDFs are rejected.
- Server validation, server-calculated prices, HttpOnly session cookies, login throttling and atomic JSON persistence.

Locally, data is created in `backend/data/store.json` and PDFs in `backend/data/uploads/`. With `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN`, data uses PostgreSQL and private Blob storage. Back up records and files together. Student sessions persist for 30 days and admin sessions for eight hours, including through restarts; only token hashes are stored. Seeded local orders are fictional and do not grant downloads. Permanent accounts, email delivery and cross-device purchase recovery are not implemented: keep your order ID for support if you clear cookies, end the session or switch devices.

For Vercel configuration, cloud migration and deployment commands, see [DEPLOYMENT.md](DEPLOYMENT.md).

## Upload notes

1. Open the admin panel and select **Catalogue**.
2. Use **Add notes** to save the title, category, price and description, or choose an existing note.
3. Select **Upload PDF**, choose a PDF up to 50 MB, and confirm the upload.
4. Use **Replace PDF** to upload a newer version. Editing catalogue details preserves the attachment. Deleting a note removes its attached PDF.
5. Students select **Preview** to read up to two real pages. After verified Razorpay payment they select **Download notes** in **My Library**. Pending, cancelled and legacy demo orders cannot download the full file. Notes without an attachment cannot be purchased.

Uploads persist through server restarts. PDFs with only one or two pages show their available pages in the preview; downloading the original still requires payment. Replacing an attachment updates the preview and the PDF available to existing paid orders.

## Enable Razorpay

1. Copy `.env.example` to `.env` in the project folder.
2. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from your Razorpay merchant dashboard. Start with test keys. Never put the secret in frontend code or send it in chat.
3. Restart `npm start`. The application reads `.env` at startup. Without keys, checkout clearly shows that payments are unavailable and full downloads remain locked.
4. Enable automatic capture in Razorpay. For a public deployment configure the webhook URL `https://your-domain/api/payments/webhook` for `payment.captured` and `order.paid`, and set the same `RAZORPAY_WEBHOOK_SECRET` on the server. Signed webhooks reconcile payments if the browser closes before verification finishes.
5. After testing your merchant integration, replace test keys with live keys. Live charging has not been exercised by the automated tests.

Integration follows [Razorpay Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/), [payment verification](https://razorpay.com/docs/api/payments/fetch-with-id/) and [webhook signature validation](https://razorpay.com/docs/webhooks/validate-test/).

## Verification

```sh
npm test
npm run build
npm run test:browser
```

Browser checks use an isolated temporary data store and installed Google Chrome on Windows, otherwise Playwright Chromium (`npx playwright install chromium` if unavailable). Set `BROWSER_CHANNEL` to choose another browser channel. Tests substitute the external Razorpay network/checkout only; the application's signature, amount, capture and access checks run normally. No actual payment is made and the running site's catalogue is untouched.

The sample asset can be regenerated with `node scripts/generate-sample.js`.

## Configuration

`PORT` changes the API/static server port (default 4000). `ADMIN_PASSWORD` is required and must be at least 12 characters; session cookies require HTTPS in production. Use a TLS reverse proxy for that mode. This project is a local demo, not a live commerce service.
