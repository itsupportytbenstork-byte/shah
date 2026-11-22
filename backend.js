// Shah Jackets backend. Pi: npm i express && node backend.js | Vercel: exports app.
// Env: ADMIN_PASSWORD, FIREBASE_DB_URL (+FIREBASE_SECRET) [required for photos], STRIPE_SECRET_KEY, SITE_URL
// data.json = text only. Photos live in Firebase Realtime DB (/images) and are served at /img/:id with 1-year cache.
const express = require('express'), fs = require('fs'), path = require('path');
const app = express(); app.use(express.json({ limit: '6mb' }));
const SRC = path.join(__dirname, 'data.json'), DB = process.env.VERCEL ? '/tmp/data.json' : SRC;
const PW = process.env.ADMIN_PASSWORD || 'HAZIQALI', FB = process.env.FIREBASE_DB_URL;
const fb = p => FB.replace(/\/$/, '') + '/' + p + '.json' + (process.env.FIREBASE_SECRET ? '?auth=' + process.env.FIREBASE_SECRET : '');
const DEF = { products: [], orders: [], chats: {}, refunds: [], discounts: [], settings: { banner: 'FREE SHIPPING ON ALL ORDERS | 7-DAY HASSLE-FREE RETURNS', saleActive: false, salePercent: 0, saleLabel: 'Sale', specialBtn: { on: false, text: '', code: '' }, slides: [], tiles: [], reviews: [], footer: { about: '', email: '', whatsapp: '' } } };
const A = v => Array.isArray(v) ? v : Object.values(v || {});
const fill = d => { d = d && !d.error ? d : {}; const x = { ...DEF, ...d, settings: { ...DEF.settings, ...(d.settings || {}) } };
  ['products', 'orders', 'refunds', 'discounts'].forEach(k => x[k] = A(x[k])); ['slides', 'tiles', 'reviews'].forEach(k => x.settings[k] = A(x.settings[k])); x.chats = x.chats || {};
  Object.values(x.chats).forEach(c => c.messages = A(c.messages)); x.orders.forEach(o => o.items = A(o.items)); x.products.forEach(p => ['images', 'thumbs', 'sizes', 'colors'].forEach(k => p[k] = A(p[k]))); return x; };
let cache = null;
async function load() {
  if (cache) return cache;
  try { if (FB) { const j = await (await fetch(fb('store'))).json(); if (j && !j.error) return (cache = fill(j)); } } catch (e) {}
  try { if (!fs.existsSync(DB)) fs.copyFileSync(SRC, DB); cache = fill(JSON.parse(fs.readFileSync(DB))); } catch (e) { cache = fill({}); }
  return cache;
}
async function save(d) {
  cache = d; try { fs.writeFileSync(DB, JSON.stringify(d, null, 1)); } catch (e) {}
  if (FB) try { await fetch(fb('store'), { method: 'PUT', body: JSON.stringify(d) }); } catch (e) {}
}
const wrap = f => (q, s) => f(q, s).catch(e => s.status(500).json({ error: e.message }));
const admin = (q, s, n) => q.headers['x-admin'] === PW ? n() : s.status(401).json({ error: 'Unauthorized' });
const id = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const eff = (p, st) => p.price * (1 - (st.saleActive ? +st.salePercent || 0 : 0) / 100);
const rate = (d, c) => { const x = d.discounts.find(v => v.active && v.code === String(c || '').toUpperCase()); return x ? x.pct / 100 : 0; };

// Public
app.get('/api/data', wrap(async (q, s) => { const d = await load(); s.set('Cache-Control', 'public, max-age=15, s-maxage=15'); s.json({ products: d.products, settings: d.settings }); }));
app.get('/img/:id', wrap(async (q, s) => {
  if (!FB) return s.sendStatus(404);
  const v = await (await fetch(fb('images/' + q.params.id.replace(/\W/g, '')))).json(), m = v && /^data:(image\/[\w+.-]+);base64,(.*)$/.exec(v);
  if (!m) return s.sendStatus(404);
  s.set({ 'Content-Type': m[1], 'Cache-Control': 'public, max-age=31536000, immutable' }); s.send(Buffer.from(m[2], 'base64'));
}));
app.post('/api/promo', wrap(async (q, s) => { const r = rate(await load(), q.body.code); s.json(r ? { ok: true, rate: r } : { ok: false }); }));
app.post('/api/order', wrap(async (q, s) => {
  const d = await load(), b = q.body; let sub = 0;
  const items = (b.items || []).map(i => { const p = d.products.find(x => x.id === i.id); if (!p) return null; const qty = Math.max(1, +i.qty || 1), pr = +eff(p, d.settings).toFixed(2); sub += pr * qty; return { id: p.id, title: p.title, price: pr, size: i.size, color: i.color, qty }; }).filter(Boolean);
  if (!items.length || !b.address || !b.address.email) return s.status(400).json({ error: 'Invalid order' });
  const code = String(b.promo || '').toUpperCase(), disc = sub * rate(d, code);
  const o = { id: id('SJ-').toUpperCase(), date: new Date().toISOString(), items, subtotal: +sub.toFixed(2), discount: +disc.toFixed(2), code: disc ? code : '', shipping: 0, total: +(sub - disc).toFixed(2), currency: b.currency, address: b.address, gateway: b.gateway || 'cod', status: 'Pending', paid: false };
  d.orders.unshift(o); await save(d); s.json({ ok: true, order: o });
}));
app.post('/api/refund', wrap(async (q, s) => {
  const d = await load(), { orderId, email, reason } = q.body;
  const o = d.orders.find(x => x.id === (orderId || '').trim().toUpperCase() && x.address.email.toLowerCase() === (email || '').trim().toLowerCase());
  if (!o) return s.status(404).json({ error: 'No order matches that ID and email.' });
  if (Date.now() - new Date(o.date) > 7 * 864e5) return s.status(400).json({ error: 'The 7-day refund window has passed.' });
  d.refunds.unshift({ id: id('RF-').toUpperCase(), orderId: o.id, email, reason, date: new Date().toISOString(), status: 'Requested' });
  await save(d); s.json({ ok: true });
}));
app.get('/api/chat/:sid', wrap(async (q, s) => s.json((await load()).chats[q.params.sid] || { messages: [] })));
app.post('/api/chat/:sid', wrap(async (q, s) => {
  const d = await load(), c = d.chats[q.params.sid] || (d.chats[q.params.sid] = { name: q.body.name || 'Guest', messages: [] });
  if (q.body.name) c.name = q.body.name;
  c.messages.push({ from: 'customer', text: String(q.body.text).slice(0, 2000), t: Date.now() }); c.unread = true; await save(d); s.json({ ok: true });
}));
// Payment gateways (modular adapters)
const gateways = {
  cod: async () => ({ ok: true }),
  stripe: async (o, q) => {
    if (!process.env.STRIPE_SECRET_KEY) return { error: 'Stripe is not activated yet. Add STRIPE_SECRET_KEY.' };
    const site = process.env.SITE_URL || 'http://' + q.headers.host, p = new URLSearchParams({ mode: 'payment', success_url: site + '/?paid=' + o.id, cancel_url: site + '/', 'line_items[0][quantity]': 1, 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': Math.round(o.total * 100), 'line_items[0][price_data][product_data][name]': 'Shah Jackets order ' + o.id });
    const j = await (await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: p })).json();
    return j.url ? { ok: true, url: j.url } : { error: j.error?.message || 'Stripe error' };
  },
  paypal: async () => ({ error: 'PayPal/Square slot is not activated yet.' })
};
app.post('/api/pay/:g', wrap(async (q, s) => {
  const d = await load(), o = d.orders.find(x => x.id === q.body.orderId), g = gateways[q.params.g];
  if (!o || !g) return s.status(400).json({ error: 'Bad request' }); s.json(await g(o, q));
}));
// Admin
app.post('/api/admin/login', (q, s) => q.body.password === PW ? s.json({ ok: true }) : s.status(401).json({ error: 'Wrong password' }));
app.get('/api/admin/data', admin, wrap(async (q, s) => s.json(await load())));
app.post('/api/admin/image', admin, wrap(async (q, s) => {
  if (!FB) return s.status(400).json({ error: 'Set FIREBASE_DB_URL to store photos.' });
  if (!/^data:image\//.test(q.body.data || '')) return s.status(400).json({ error: 'Not an image' });
  const i = id('i'); await fetch(fb('images/' + i), { method: 'PUT', body: JSON.stringify(q.body.data) }); s.json({ url: '/img/' + i });
}));
app.post('/api/admin/product', admin, wrap(async (q, s) => {
  const d = await load(), p = q.body, i = d.products.findIndex(x => x.id === p.id);
  if (i < 0) { p.id = id('p'); d.products.unshift(p); } else d.products[i] = p; await save(d); s.json({ ok: true });
}));
app.delete('/api/admin/product/:id', admin, wrap(async (q, s) => {
  const d = await load(), p = d.products.find(x => x.id === q.params.id);
  if (p && FB) for (const u of [...(p.images || []), ...(p.thumbs || [])]) { const m = /^\/img\/(\w+)$/.exec(u); if (m) try { await fetch(fb('images/' + m[1]), { method: 'DELETE' }); } catch (e) {} }
  d.products = d.products.filter(x => x.id !== q.params.id); await save(d); s.json({ ok: true });
}));
app.post('/api/admin/order/:id', admin, wrap(async (q, s) => { const d = await load(), o = d.orders.find(x => x.id === q.params.id); if (o) { o.status = q.body.status; if (q.body.paid != null) o.paid = q.body.paid; } await save(d); s.json({ ok: true }); }));
app.post('/api/admin/refund/:id', admin, wrap(async (q, s) => { const d = await load(), r = d.refunds.find(x => x.id === q.params.id); if (r) r.status = q.body.status; await save(d); s.json({ ok: true }); }));
app.post('/api/admin/chat/:sid', admin, wrap(async (q, s) => { const d = await load(), c = d.chats[q.params.sid]; if (c) { if (q.body.text) c.messages.push({ from: 'owner', text: q.body.text, t: Date.now() }); c.unread = false; } await save(d); s.json({ ok: true }); }));
app.post('/api/admin/settings', admin, wrap(async (q, s) => { const d = await load(); d.settings = fill({ settings: q.body }).settings; await save(d); s.json({ ok: true }); }));
app.post('/api/admin/discount', admin, wrap(async (q, s) => {
  const d = await load(), code = String(q.body.code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, ''), x = d.discounts.find(v => v.code === code);
  if (!code) return s.status(400).json({ error: 'Bad code' });
  const v = { code, pct: Math.min(90, Math.max(1, +q.body.pct || 0)), active: q.body.active !== false }; x ? Object.assign(x, v) : d.discounts.push(v); await save(d); s.json({ ok: true });
}));
app.delete('/api/admin/discount/:c', admin, wrap(async (q, s) => { const d = await load(); d.discounts = d.discounts.filter(v => v.code !== q.params.c); await save(d); s.json({ ok: true }); }));
// Static (whitelist only)
['index.html', 'admin.html', 'robots.txt'].forEach(f => app.get(f === 'index.html' ? ['/', '/index.html'] : '/' + f, (q, s) => s.sendFile(path.join(__dirname, f))));
module.exports = app;
if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log('Shah Jackets on :' + (process.env.PORT || 3000)));
