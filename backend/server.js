import http from 'node:http';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { createStore } from './store.js';
import { createPostgresStore } from './postgres-store.js';
import { createCloudFiles } from './cloud-files.js';
import { categories } from './seed.js';
import { renderPreview } from './pdf-preview.js';
import { razorpayGateway, capturedPaymentMatches } from './payments.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const fail = (status, message) => Object.assign(new Error(message), { status });
function text(value, label, min = 1, max = 200) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw fail(400, `${label} must be ${min}–${max} characters.`);
  return value.trim();
}
function validateNote(body) {
  if (!categories.includes(body.category)) throw fail(400, 'Choose a valid exam category.');
  for (const key of ['price', 'originalPrice', 'pages', 'chapters']) if (!Number.isInteger(body[key]) || body[key] < 1 || body[key] > 100000) throw fail(400, `${key} must be a positive whole number below 100001.`);
  if (body.originalPrice < body.price) throw fail(400, 'Original price cannot be less than sale price.');
  if (typeof body.published !== 'boolean') throw fail(400, 'Published must be true or false.');
  return { title: text(body.title, 'Title', 3, 100), category: body.category, description: text(body.description, 'Description', 5, 300), topics: text(body.topics, 'Topics', 3, 250), badge: text(body.badge, 'Badge', 1, 40), language: text(body.language, 'Language', 2, 50), price: body.price, originalPrice: body.originalPrice, pages: body.pages, chapters: body.chapters, published: body.published };
}
async function jsonBody(req) {
  if (!req.headers['content-type']?.includes('application/json')) throw fail(415, 'Use application/json.');
  let body = '';
  for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 20000) throw fail(413, 'Request is too large.'); }
  try { const parsed = JSON.parse(body || '{}'); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error(); return parsed; } catch { throw fail(400, 'Invalid JSON object.'); }
}
export async function createApp({ dataDir = resolve(root, 'backend/data'), adminPassword = process.env.ADMIN_PASSWORD, gateway = razorpayGateway(), databaseUrl = process.env.DATABASE_URL, blobToken = process.env.BLOB_READ_WRITE_TOKEN } = {}) {
  if (typeof adminPassword !== 'string' || adminPassword.length < 12) throw Error('Set ADMIN_PASSWORD to a unique password of at least 12 characters.');
  console.log("VERCEL ENV CHECK:", {
    VERCEL: Boolean(process.env.VERCEL),
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    BLOB_READ_WRITE_TOKEN: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
  });
  if (process.env.VERCEL && (!databaseUrl || !blobToken)) throw Error('Configure DATABASE_URL and private BLOB_READ_WRITE_TOKEN before deployment.');
  const store = databaseUrl ? await createPostgresStore(databaseUrl) : await createStore(dataDir);
  const cloud = blobToken ? createCloudFiles(blobToken) : null;
  const uploadsDir = resolve(dataDir, 'uploads');
  if (!cloud) await mkdir(uploadsDir, { recursive: true });
  const readPdf = storageName => cloud ? cloud.read(storageName) : readFile(resolve(uploadsDir, storageName));
  const removePdf = storageName => cloud ? cloud.remove(storageName) : unlink(resolve(uploadsDir, storageName));
  const previews = new Map();
  async function previewFor(note) {
    if (!note?.file) throw fail(404, 'The admin has not uploaded a PDF for these notes yet.');
    const key = note.file.storageName;
    if (!previews.has(key)) {
      if (previews.size >= 6) previews.delete(previews.keys().next().value);
      previews.set(key, readPdf(key).then(renderPreview).catch(error => { previews.delete(key); throw error; }));
    }
    return previews.get(key);
  }
  const hasAccess = order => order.status === 'Paid' && order.paymentVerified === true && order.paymentId;
  async function markPaid(orderId, payment) {
    return store.update(data => {
      const order = data.orders.find(item => item.id === orderId);
      if (!order || !capturedPaymentMatches(payment, order)) throw fail(400, 'Payment does not match this order or is not captured yet.');
      if (order.status === 'Cancelled') throw fail(409, 'This order was cancelled. Contact support with your payment ID.');
      if (data.orders.some(item => item.id !== order.id && item.paymentId === payment.id)) throw fail(409, 'Payment already belongs to another order.');
      Object.assign(order, { status: 'Paid', paymentVerified: true, paymentId: payment.id, paidAt: order.paidAt || new Date().toISOString() });
      return { ...order, canDownload: true };
    });
  }
  async function sendNoteFile(res, note) {
    if (!note?.file) throw fail(404, 'No PDF has been uploaded for these notes yet.');
    if (cloud) return cloud.send(res, note.file);
    let content;
    try { content = await readFile(resolve(uploadsDir, note.file.storageName)); }
    catch (error) { if (error.code === 'ENOENT') throw fail(404, 'The notes file is unavailable. Please contact support.'); throw error; }
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': content.length, 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="notes.pdf"; filename*=UTF-8''${encodeURIComponent(note.file.name).replace(/'/g, '%27')}` });
    res.end(content);
  }
  const salt = randomBytes(16);
  const passwordHash = scryptSync(adminPassword, salt, 64);
  const tokenHash = token => createHash('sha256').update(token).digest('hex');
  async function throttle(req, kind, limit, windowMs) {
    const address = process.env.VERCEL ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
    const key = tokenHash(kind + ':' + address);
    await store.update(data => {
      data.rateLimits ||= {};
      for (const [id, value] of Object.entries(data.rateLimits)) if (value.until < Date.now()) delete data.rateLimits[id];
      const value = data.rateLimits[key] || { count: 0, until: Date.now() + windowMs };
      if (value.count >= limit) throw fail(429, 'Too many attempts. Please try again later.');
      value.count++; data.rateLimits[key] = value;
    });
    return key;
  }
  async function session(req, kind) {
    const token = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`bf_${kind}=`))?.split('=')[1];
    const value = token ? (await store.read()).sessions?.[tokenHash(token)] : null;
    if (!value || value.kind !== kind || value.expires < Date.now()) return null;
    return { ...value, token };
  }
  async function setSession(res, kind, user) {
    const token = randomBytes(32).toString('hex');
    const maxAge = kind === 'student' ? 30 * 24 * 3600 : 28800;
    const value = { kind, user, expires: Date.now() + maxAge * 1000 };
    await store.update(data => {
      data.sessions ||= {};
      for (const [key, entry] of Object.entries(data.sessions)) if (entry.expires < Date.now()) delete data.sessions[key];
      if (Object.values(data.sessions).filter(entry => entry.kind === kind).length >= (kind === 'admin' ? 100 : 10000)) throw fail(503, 'Please try again later.');
      data.sessions[tokenHash(token)] = value;
    });
    res.setHeader('Set-Cookie', `bf_${kind}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  }
  return http.createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const method = req.method;
      if (!path.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') throw fail(405, 'Method not allowed.');
        const pathname = path === '/' ? '/frontend/index.html' : path.endsWith('/') ? path + 'index.html' : path;
        const dist = resolve(root, 'dist');
        const file = resolve(dist, '.' + decodeURIComponent(pathname));
        if (!file.startsWith(dist + sep)) throw fail(403, 'Forbidden.');
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.pdf': 'application/pdf' };
        try { const content = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(method === 'HEAD' ? undefined : content); } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error; throw fail(404, 'Page not found. Run npm run build to serve the website.'); }
        return;
      }
      if (path === '/api/payments/webhook' && method === 'POST') {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 1000000) throw fail(413, 'Webhook too large.'); chunks.push(chunk); }
        const raw = Buffer.concat(chunks);
        if (!gateway.verifyWebhook(raw, req.headers['x-razorpay-signature'])) throw fail(401, 'Invalid webhook signature.');
        let event; try { event = JSON.parse(raw); } catch { throw fail(400, 'Invalid webhook JSON.'); }
        if (['payment.captured', 'order.paid'].includes(event.event)) {
          const entity = event.payload?.payment?.entity;
          const order = (await store.read()).orders.find(item => item.gatewayOrderId === entity?.order_id);
          if (order && order.status !== 'Cancelled') await markPaid(order.id, await gateway.fetchPayment(entity.id));
        }
        return send(200, { ok: true });
      }
      if (!['GET', 'HEAD'].includes(method) && req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Cross-site requests are not allowed.');
      if (req.headers.origin && !['GET', 'HEAD'].includes(method)) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        if (new URL(req.headers.origin).host !== host) throw fail(403, 'Origin is not allowed.');
      }
      if (path === '/api/health') return send(200, { ok: true, mode: 'demo' });
      if (path === '/api/notes' && method === 'GET') return send(200, (await store.read()).notes.filter(note => note.published).map(({ file, ...note }) => ({ ...note, hasFile: Boolean(file), pages: file?.pageCount || note.pages })));
      const previewMatch = path.match(/^\/api\/notes\/([^/]+)\/preview(?:\/([12]))?$/);
      if (previewMatch && method === 'GET') {
        const note = (await store.read()).notes.find(item => item.id === previewMatch[1] && item.published);
        if (!note) throw fail(404, 'Notes not found.');
        const preview = await previewFor(note);
        if (!previewMatch[2]) return send(200, { pageCount: preview.pageCount, pages: preview.pages.map((_, i) => `/api/notes/${note.id}/preview/${i + 1}`) });
        const content = preview.pages[Number(previewMatch[2]) - 1];
        if (!content) throw fail(404, 'Page not found.');
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); res.end(content); return;
      }
      if (path === '/api/payments/config' && method === 'GET') return send(200, gateway.config);
      if (path === '/api/settings' && method === 'GET') return send(200, (await store.read()).settings);
      if (path === '/api/admin/login' && method === 'POST') {
        const key = await throttle(req, 'admin-login', 10, 600000);
        const body = await jsonBody(req);
        const password = typeof body.password === 'string' && body.password.length <= 256 ? body.password : '';
        if (!timingSafeEqual(scryptSync(password, salt, 64), passwordHash)) throw fail(401, 'Incorrect admin password.');
        await store.update(data => { delete data.rateLimits[key]; }); await setSession(res, 'admin', { name: 'Administrator' }); return send(200, { name: 'Administrator' });
      }
      if (path === '/api/session') {
        if (method === 'GET') return send(200, (await session(req, 'student'))?.user || null);
        if (method === 'POST') {
          await throttle(req, 'student-session', 20, 3600000);
          const body = await jsonBody(req);
          const name = text(body.name, 'Name', 2, 80);
          const email = text(body.email, 'Email', 5, 120).toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address.');
          const user = { id: randomUUID(), name, email };
          await setSession(res, 'student', user); return send(201, user);
        }
        if (method === 'DELETE') { const existing = (await session(req, 'student')); if (existing) await store.update(data => { delete data.sessions?.[tokenHash(existing.token)]; }); res.setHeader('Set-Cookie', 'bf_student=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0'); return send(200, { ok: true }); }
      }
      const downloadMatch = path.match(/^\/api\/orders\/([^/]+)\/download$/);
      if (downloadMatch && method === 'GET') {
        const student = (await session(req, 'student'));
        if (!student) throw fail(401, 'Start a demo student session first.');
        const data = (await store.read());
        const order = data.orders.find(item => item.id === downloadMatch[1] && item.userId === student.user.id);
        if (!order) throw fail(404, 'Order not found.');
        if (!hasAccess(order)) throw fail(403, 'Complete payment to download the full PDF.');
        return await sendNoteFile(res, data.notes.find(item => item.id === order.noteId));
      }
      if (path === '/api/orders') {
        const student = (await session(req, 'student'));
        if (!student) throw fail(401, 'Start a demo student session first.');
        if (method === 'GET') {
          const data = (await store.read());
          return send(200, data.orders.filter(order => order.userId === student.user.id).map(order => ({ ...order, canDownload: Boolean(hasAccess(order)), hasFile: Boolean(data.notes.find(note => note.id === order.noteId)?.file) })));
        }
        if (method === 'POST') {
          const body = await jsonBody(req);
          const order = await store.update(data => {
            const note = data.notes.find(item => item.id === body.noteId && item.published);
            if (!note) throw fail(404, 'These notes are no longer available.');
            if (!note.file) throw fail(409, 'The PDF has not been uploaded yet. Please try another study pack.');
            const existing = data.orders.find(item => item.userId === student.user.id && item.noteId === note.id && (hasAccess(item) || (item.status === 'Pending' && item.amount === note.price)));
            if (existing) return existing;
            const item = { id: 'BF-' + randomBytes(5).toString('hex').toUpperCase(), userId: student.user.id, name: student.user.name, email: student.user.email, noteId: note.id, title: note.title, amount: note.price, status: 'Pending', createdAt: new Date().toISOString() };
            data.orders.unshift(item); return item;
          });
          return send(201, order);
        }
      }
      if (['/api/payments/create', '/api/payments/verify'].includes(path) && method === 'POST') {
        const student = (await session(req, 'student'));
        if (!student) throw fail(401, 'Please start a student session.');
        const body = await jsonBody(req);
        const order = (await store.read()).orders.find(item => item.id === body.orderId && item.userId === student.user.id);
        if (!order) throw fail(404, 'Order not found.');
        if (hasAccess(order)) return send(200, { ...order, canDownload: true });
        if (order.status !== 'Pending') throw fail(409, 'Please create a new order.');
        if (path === '/api/payments/create') {
          if (!gateway.config.enabled) throw fail(503, 'Payments are not configured yet. Please contact the institute.');
          if (!(await store.read()).notes.find(note => note.id === order.noteId && note.published && note.file)) throw fail(409, 'These notes are no longer available.');
          let gatewayOrderId = order.gatewayOrderId;
          if (!gatewayOrderId) {
            const created = await gateway.createOrder(order);
            if (!created.id || created.amount !== order.amount * 100 || created.currency !== 'INR') throw fail(502, 'Invalid payment order response.');
            gatewayOrderId = await store.update(data => {
              const current = data.orders.find(item => item.id === order.id);
              if (current.status !== 'Pending') throw fail(409, 'Order status changed. Please refresh.');
              current.gatewayOrderId ||= created.id;
              return current.gatewayOrderId;
            });
          }
          return send(200, { keyId: gateway.keyId, gatewayOrderId, amount: order.amount * 100, currency: 'INR', orderId: order.id });
        }
        if (!order.gatewayOrderId || body.razorpay_order_id !== order.gatewayOrderId || !/^pay_[a-zA-Z0-9]+$/.test(body.razorpay_payment_id || '') || !gateway.verify(order.gatewayOrderId, body.razorpay_payment_id, body.razorpay_signature)) throw fail(400, 'Payment verification failed.');
        return send(200, await markPaid(order.id, await gateway.fetchPayment(body.razorpay_payment_id)));
      }
      if (path.startsWith('/api/admin/')) {
        const admin = (await session(req, 'admin'));
        if (!admin) throw fail(401, 'Please sign in to the admin panel.');
        if (path === '/api/admin/session' && method === 'GET') return send(200, admin.user);
        if (path === '/api/admin/logout' && method === 'POST') { await store.update(data => { delete data.sessions?.[tokenHash(admin.token)]; }); res.setHeader('Set-Cookie', 'bf_admin=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0'); return send(200, { ok: true }); }
        if (path === '/api/admin/notes' && method === 'GET') return send(200, (await store.read()).notes);
        if (path === '/api/admin/orders' && method === 'GET') return send(200, (await store.read()).orders);
        if (path === '/api/admin/upload-config' && method === 'GET') return send(200, { mode: cloud ? 'cloud' : 'local', maxBytes: 50 * 1024 * 1024 });
        const cloudMatch = path.match(/^\/api\/admin\/notes\/([^/]+)\/upload\/(prepare|complete)$/);
        if (cloudMatch && method === 'POST') {
          if (!cloud) throw fail(400, 'Cloud uploads are not enabled.');
          const body = await jsonBody(req);
          const note = (await store.read()).notes.find(item => item.id === cloudMatch[1]);
          if (!note) throw fail(404, 'Notes not found.');
          if (cloudMatch[2] === 'prepare') {
            const name = text(body.name, 'Filename', 5, 180);
            if (!/\.pdf$/i.test(name) || /[\\/\x00-\x1f\x7f]/.test(name)) throw fail(400, 'Choose a valid PDF filename.');
            if (!Number.isInteger(body.size) || body.size <= 0 || body.size > 50 * 1024 * 1024) throw fail(413, 'Choose a non-empty PDF, 50 MB or smaller.');
            const pathname = 'notes/' + randomUUID() + '.pdf';
            const token = await cloud.token(pathname);
            await store.update(data => {
              data.pendingUploads ||= {};
              for (const [key, item] of Object.entries(data.pendingUploads)) if (item.expires < Date.now()) delete data.pendingUploads[key];
              data.pendingUploads[pathname] = { noteId: note.id, name, expires: Date.now() + 3600000 };
            });
            return send(200, { pathname, token });
          }
          const pending = (await store.read()).pendingUploads?.[body.pathname];
          if (!pending || pending.noteId !== note.id || pending.expires < Date.now()) {
            if (note.file?.storageName === body.pathname) return send(200, note);
            throw fail(400, 'Upload expired. Select the PDF and upload it again.');
          }
          const content = await cloud.read(body.pathname);
          let preview;
          try { preview = await renderPreview(content); }
          catch (error) { await cloud.remove(body.pathname).catch(() => {}); throw error; }
          const file = { name: pending.name, size: content.length, pageCount: preview.pageCount, storageName: body.pathname, uploadedAt: new Date().toISOString() };
          let previous;
          const updated = await store.update(data => {
            const current = data.notes.find(item => item.id === note.id);
            if (!current) throw fail(404, 'Notes no longer exist.');
            if (!data.pendingUploads?.[body.pathname]) {
              if (current.file?.storageName === body.pathname) return current;
              throw fail(409, 'Upload was already processed.');
            }
            previous = current.file;
            current.file = file;
            delete data.pendingUploads[body.pathname];
            return current;
          });
          previews.clear();
          if (previous && previous.storageName !== file.storageName) await removePdf(previous.storageName).catch(() => {});
          return send(200, updated);
        }
        const fileMatch = path.match(/^\/api\/admin\/notes\/([^/]+)\/file$/);
        if (fileMatch && ['GET', 'PUT'].includes(method)) {
          const note = (await store.read()).notes.find(item => item.id === fileMatch[1]);
          if (!note) throw fail(404, 'Notes not found.');
          if (method === 'GET') return await sendNoteFile(res, note);
          if (cloud) throw fail(400, 'Use direct cloud upload for this deployment.');
          if (req.headers['content-type']?.split(';')[0] !== 'application/pdf') throw fail(415, 'Choose a PDF file.');
          const limit = 50 * 1024 * 1024;
          if (Number(req.headers['content-length']) > limit) throw fail(413, 'PDF must be 50 MB or smaller.');
          let filename;
          try { filename = decodeURIComponent(req.headers['x-file-name'] || 'notes.pdf'); } catch { throw fail(400, 'Invalid filename.'); }
          filename = text(filename, 'Filename', 5, 180);
          if (!/\.pdf$/i.test(filename) || /[\\/\x00-\x1f\x7f]/.test(filename)) throw fail(400, 'Choose a valid PDF filename.');
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail(413, 'PDF must be 50 MB or smaller.'); chunks.push(chunk); }
          const content = Buffer.concat(chunks);
          if (content.subarray(0, 5).toString() !== '%PDF-' || !content.subarray(-1024).includes(Buffer.from('%%EOF'))) throw fail(400, 'The selected file is not a valid PDF.');
          const preview = await renderPreview(content);
          const file = { name: filename, size, pageCount: preview.pageCount, storageName: randomUUID() + '.pdf', uploadedAt: new Date().toISOString() };
          const destination = resolve(uploadsDir, file.storageName);
          await writeFile(destination, content, { flag: 'wx' });
          let previous;
          let updated;
          try {
            updated = await store.update(data => {
              const item = data.notes.find(item => item.id === fileMatch[1]);
              if (!item) throw fail(404, 'Notes no longer exist.');
              previous = item.file;
              item.file = file;
              return item;
            });
          } catch (error) { await unlink(destination).catch(() => {}); throw error; }
          previews.clear();
          if (previous) await unlink(resolve(uploadsDir, previous.storageName)).catch(error => { if (error.code !== 'ENOENT') console.error(error); });
          return send(200, updated);
        }
        if (path === '/api/admin/settings' && method === 'PUT') {
          const body = await jsonBody(req);
          if (!Number.isInteger(body.discount) || body.discount < 0 || body.discount > 90) throw fail(400, 'Discount must be between 0 and 90.');
          const settings = { phone: '9161868600', offerTitle: text(body.offerTitle, 'Offer title', 3, 100), offerSubtitle: text(body.offerSubtitle, 'Offer description', 3, 250), discount: body.discount };
          await store.update(data => { data.settings = settings; }); return send(200, settings);
        }
        if (path === '/api/admin/notes' && method === 'POST') { const note = { ...validateNote(await jsonBody(req)), id: randomUUID() }; await store.update(data => data.notes.push(note)); return send(201, note); }
        const noteMatch = path.match(/^\/api\/admin\/notes\/([^/]+)$/);
        if (noteMatch && ['PUT', 'DELETE'].includes(method)) {
          const body = method === 'PUT' ? validateNote(await jsonBody(req)) : null;
          let removedFile;
          const result = await store.update(data => {
            const index = data.notes.findIndex(note => note.id === noteMatch[1]);
            if (index < 0) throw fail(404, 'Notes not found.');
            if (method === 'DELETE') { removedFile = data.notes[index].file; data.notes.splice(index, 1); return { ok: true }; }
            return data.notes[index] = { ...body, id: noteMatch[1], ...(data.notes[index].file ? { file: data.notes[index].file } : {}) };
          });
          if (removedFile) await removePdf(removedFile.storageName).catch(error => { if (error.code !== 'ENOENT') console.error(error); });
          return send(200, result);
        }
        const orderMatch = path.match(/^\/api\/admin\/orders\/([^/]+)$/);
        if (orderMatch && method === 'PUT') {
          const body = await jsonBody(req);
          if (!['Pending', 'Cancelled'].includes(body.status)) throw fail(400, 'Paid access is granted only by verified Razorpay payments.');
          const order = await store.update(data => { const item = data.orders.find(item => item.id === orderMatch[1]); if (!item) throw fail(404, 'Order not found.'); item.status = body.status; return item; });
          return send(200, order);
        }
      }
      throw fail(404, 'Endpoint not found.');
    } catch (error) { if (!error.status) console.error(error); if (!res.headersSent) send(error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' }); else res.end(); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { loadEnvFile(resolve(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const app = await createApp();
  app.listen(Number(process.env.PORT) || 4000, '127.0.0.1', () => console.log('Bright Future: http://localhost:4000/frontend/ | Admin: http://localhost:4000/admin/'));
}
