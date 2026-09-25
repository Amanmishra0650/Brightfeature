import test from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { createCloudFiles, MAX_PDF_BYTES } from './cloud-files.js';
import { runWithOidcToken } from './oidc-context.js';

test('cached Blob clients isolate concurrent request tokens and retain local fallbacks', async () => {
  const previousDispatcher = getGlobalDispatcher();
  const previousToken = process.env.VERCEL_OIDC_TOKEN;
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const pool = agent.get('https://vercel.com');
  const cloud = createCloudFiles({ storeId: 'teststore', oidcToken: 'startup-fixture' });
  const pathname = 'notes/1234-abcd.pdf';
  const expectToken = token => pool.intercept({
    path: '/api/blob/delete', method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  }).reply(200, {});
  try {
    process.env.VERCEL_OIDC_TOKEN = 'environment-fixture';
    expectToken('request-one-fixture');
    expectToken('request-two-fixture');
    let releaseFirst;
    const secondStarted = new Promise(resolve => { releaseFirst = resolve; });
    await Promise.all([
      runWithOidcToken('request-one-fixture', async () => {
        await secondStarted;
        await cloud.remove(pathname);
      }),
      runWithOidcToken('request-two-fixture', async () => {
        releaseFirst();
        await cloud.remove(pathname);
      }),
    ]);
    expectToken('rotated-request-fixture');
    await runWithOidcToken('rotated-request-fixture', () => cloud.remove(pathname));
    expectToken('environment-fixture');
    await cloud.remove(pathname);
    delete process.env.VERCEL_OIDC_TOKEN;
    expectToken('startup-fixture');
    await runWithOidcToken(undefined, () => cloud.remove(pathname));
    agent.assertNoPendingInterceptors();
  } finally {
    if (previousToken === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = previousToken;
    setGlobalDispatcher(previousDispatcher);
    await agent.close();
  }
});

test('OIDC uploads expose a scoped signed URL and refresh credentials between requests', async () => {
  const previousDispatcher = getGlobalDispatcher();
  const previousToken = process.env.VERCEL_OIDC_TOKEN;
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const pathname = 'notes/1234-abcd.pdf';
  const validUntil = Date.now() + 3600000;
  const delegationToken = Buffer.from(JSON.stringify({ storeId: 'teststore', pathname, operations: ['put'], validUntil, maximumSizeInBytes: MAX_PDF_BYTES, allowedContentTypes: ['application/pdf'] })).toString('base64url') + '.signature';
  const pool = agent.get('https://vercel.com');
  try {
    process.env.VERCEL_OIDC_TOKEN = 'first-oidc-fixture';
    pool.intercept({ path: '/api/blob/signed-token', method: 'POST', headers: { authorization: 'Bearer first-oidc-fixture', 'x-vercel-blob-store-id': 'teststore' } }).reply(200, options => {
      const body = JSON.parse(options.body);
      assert.equal(body.pathname, pathname);
      assert.deepEqual(body.operations, ['put']);
      assert.equal(body.maximumSizeInBytes, MAX_PDF_BYTES);
      assert.deepEqual(body.allowedContentTypes, ['application/pdf']);
      assert.ok(body.validUntil > Date.now() && body.validUntil <= Date.now() + 3600000);
      return { delegationToken, clientSigningToken: 'signing-fixture', validUntil };
    });
    const cloud = createCloudFiles({ storeId: 'teststore', oidcToken: process.env.VERCEL_OIDC_TOKEN });
    const uploadUrl = await cloud.uploadUrl(pathname);
    const url = new URL(uploadUrl);
    assert.equal(url.searchParams.get('pathname'), pathname);
    assert.equal(url.searchParams.get('vercel-blob-delegation'), delegationToken);
    assert.ok(url.searchParams.get('vercel-blob-signature'));
    assert.ok(!uploadUrl.includes('signing-fixture'));
    assert.ok(!uploadUrl.includes('first-oidc-fixture'));
    process.env.VERCEL_OIDC_TOKEN = 'rotated-oidc-fixture';
    pool.intercept({ path: '/api/blob/delete', method: 'POST', headers: { authorization: 'Bearer rotated-oidc-fixture' } }).reply(200, {});
    await cloud.remove(pathname);
    agent.assertNoPendingInterceptors();
  } finally {
    if (previousToken === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = previousToken;
    setGlobalDispatcher(previousDispatcher);
    await agent.close();
  }
});
