# Razorpay setup for Bright Future Notes

The repository already implements Razorpay Standard Checkout, server-created orders, HMAC verification, payment capture verification, an admin order list, and a protected PDF download endpoint. This update hardens the webhook handler for order-paid notifications without a payment entity.

## Setup (test mode first)

1. Create a `.env` file locally using `.env.example`. Never commit it.
2. Add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` for the **same test-mode key pair**.
3. Add a distinct `RAZORPAY_WEBHOOK_SECRET` of your choice, and configure it to match the Razorpay Dashboard webhook secret.
4. Set `ADMIN_PASSWORD` to a unique value of at least 12 characters.
5. Run `npm ci`, `npm test`, `npm run build`, and `npm start`.
6. In the admin panel, publish a note, set its price, and upload a PDF. On the storefront select **Buy now** to test Checkout.
7. For Vercel, set the three Razorpay variables in the relevant Vercel project environment and redeploy. Keep PostgreSQL, private Blob, and other existing configuration in place.
8. Add the webhook URL `https://YOUR_DOMAIN/api/payments/webhook` in the Razorpay Dashboard for `payment.captured` and `order.paid`, with matching secret. Use HTTPS.
9. Exercise successful, failed, cancelled, and interrupted *test* payments. Confirm only a captured, authenticated purchase can download a paid PDF.
10. Switch to live keys only after the test workflow, merchant verification, and security review are complete. Regenerate any key that has appeared in a screenshot.

For Razorpay `order.paid` events that omit a payment entity, the webhook responds successfully **without** granting a PDF. Such events require later checkout verification or a payment-captured webhook. This prevents granting access from an unverified payment ID.

The student login in this repository is currently a browser-scoped demo session initiated with a name and email, **not an identity-verified account**. Do not market cross-device account access or unrestricted production security until student authentication and recovery are implemented.

No API keys or live credentials belong in this repository.
