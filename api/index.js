import { createApp } from '../backend/server.js';

let appPromise;

export default async function handler(req, res) {
  console.log('VERCEL API ENV CHECK:', {
    VERCEL: Boolean(process.env.VERCEL),
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    BLOB_STORE_ID: Boolean(process.env.BLOB_STORE_ID),
    VERCEL_OIDC_TOKEN: Boolean(process.env.VERCEL_OIDC_TOKEN),
  });

  try {
    // The rewrite carries the original API path into this single function.
    const url = new URL(req.url, 'http://localhost');
    const route = url.searchParams.get('route');

    if (route !== null) {
      url.searchParams.delete('route');
      req.url =
        '/api/' +
        route +
        (url.searchParams.size ? '?' + url.searchParams : '');
    }

    appPromise ||= createApp().catch(error => {
      appPromise = undefined;
      throw error;
    });

    const app = await appPromise;
    const requestListener = app.listeners('request')[0];
    if (!requestListener) throw new Error('HTTP request listener was not initialized.');
    await requestListener(req, res);
  } catch (error) {
    console.error('API startup failed:', error?.message || error);

    if (!res.headersSent) {
      res.writeHead(503, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
    }

    res.end(
      JSON.stringify({
        error: 'The service is not configured yet. Please contact the institute.',
      }),
    );
  }
}
