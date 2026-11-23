// Shah Jackets backend: Cloudinary for Images + Resend for Customer Emails + data.json
const express = require('express'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const { Resend } = require('resend');

const app = express();
app.use(express.json({ limit: '15mb' }));

// CORS: allowed frontends (testing)
const ORIGINS = [
  'https://shah-jackets.netlify.app',
  'https://gg-shah-admin.netlify.app',
  'https://shah-mdq2jc138-sh-ah-jac-kets.vercel.app'
];
app.use((q, s, n) => {
  if (ORIGINS.includes(q.headers.origin)) {
    s.set('Access-Control-Allow-Origin', q.headers.origin);
    s.set('Vary', 'Origin');
    s.set('Access-Control-Allow-Headers', 'Content-Type, x-admin');
    s.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  }
  if (q.method === 'OPTIONS') return s.sendStatus(204);
  n();
});

const SRC = path.join(__dirname, 'data.json');
const DB = process.env.VERCEL ? '/tmp/data.json' : SRC;

// Master Password - ONLY HAZIQALI
const PW = 'HAZIQALI';

// Cloudinary Direct Config
cloudinary.config({
  cloud_name: 'lq3fdicc',
  api_key: '572519186223966',
  api_secret: 'IKOiMGiRQlL3ZQnk6o0vhTiRAY8'
});

// Resend Direct Config
const resend = new Resend('re_R95UozNr_CedKj97mAqwJWznBAnCwFDzM');

// Email settings. Resend's test sender (onboarding@resend.dev) only delivers to your own Resend account email.
// To email customers, verify a domain in Resend and change FROM to e.g. 'Shah Jackets <orders@yourdomain.com>'.
const FROM = 'Shah Jackets <onboarding@resend.dev>';
const SHOP_URL = 'https://shah-jackets.netlify.app';
const REQUIRE_VERIFY = true; // customers must verify their email (6-digit code) before ordering

// Default Data Schema
const DEF = {
  products: [],
  orders: [],
  chats: {},
  refunds: [],
  discounts: [],
  carts: {},
  settings: {
    banner: 'FREE SHIPPING ON ALL ORDERS | 7-DAY HASSLE-FREE RETURNS',
    saleActive: false,
    salePercent: 0,
    saleLabel: 'Sale',
    specialBtn: { on: false, text: '', code: '' },
    slides: [],
    tiles: [],
    reviews: [],
    footer: { about: '', email: '', whatsapp: '' }
  }
};

const A = v => Array.isArray(v) ? v : Object.values(v || {});
const fill = d => {
  d = d && !d.error ? d : {};
  const x = { ...DEF, ...d, settings: { ...DEF.settings, ...(d.settings || {}) } };
  ['products', 'orders', 'refunds', 'discounts'].forEach(k => x[k] = A(x[k]));
  ['slides', 'tiles', 'reviews'].forEach(k => x.settings[k] = A(x.settings[k]));
  x.chats = x.chats || {};
  x.carts = x.carts || {};
  Object.values(x.chats).forEach(c => c.messages = A(c.messages));
  x.orders.forEach(o => o.items = A(o.items));
  x.products.forEach(p => ['images', 'thumbs', 'sizes', 'colors'].forEach(k => p[k] = A(p[k])));
  return x;
};

// Persistent storage: Firebase Realtime Database over REST (set FIREBASE_DB_URL on Vercel).
// Without it, data lives in /tmp, which Vercel wipes and does not share between instances.
const FB = (process.env.FIREBASE_DB_URL || 'https://halmspai-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/+$/, '');
let cache = null;
async function load() {
  if (FB) {
    const r = await fetch(FB + '/store.json');
    if (!r.ok) throw new Error('Database read failed (' + r.status + ')');
    return fill(await r.json());
  }
  if (cache) return cache;
  try {
    if (!fs.existsSync(DB)) {
      if (fs.existsSync(SRC)) fs.copyFileSync(SRC, DB);
      else fs.writeFileSync(DB, JSON.stringify(DEF, null, 2));
    }
    cache = fill(JSON.parse(fs.readFileSync(DB)));
  } catch (e) {
    cache = fill({});
  }
  return cache;
}

async function save(d) {
  if (FB) {
    const r = await fetch(FB + '/store.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
    if (!r.ok) throw new Error('Database write failed (' + r.status + ')');
    return;
  }
  cache = d;
  try { fs.writeFileSync(DB, JSON.stringify(d, null, 2)); } catch (e) {}
}

const sidOf = q => String(q.params.sid).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
const wrap = f => (q, s) => f(q, s).catch(e => s.status(500).json({ error: e.message }));
const admin = (q, s, n) => q.headers['x-admin'] === PW ? n() : s.status(401).json({ error: 'Unauthorized' });
const id = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const eff = (p, st) => p.price * (1 - (st.saleActive ? +st.salePercent || 0 : 0) / 100);
const rate = (d, c) => {
  const x = d.discounts.find(v => v.active && v.code === String(c || '').toUpperCase());
  return x ? x.pct / 100 : 0;
};

// Clean Order Receipt Email for Customer
function orderReceiptHtml(order) {
  const itemsHtml = order.items.map(i => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;">
        <strong>${i.title}</strong><br>
        <span style="color:#777;font-size:13px;">Size: ${i.size} | Color: ${i.color}</span>
      </td>
      <td style="padding:10px 0;text-align:center;border-bottom:1px solid #eee;">x${i.qty}</td>
      <td style="padding:10px 0;text-align:right;border-bottom:1px solid #eee;">$${(i.price * i.qty).toFixed(2)}</td>
    </tr>
  `).join('');

  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:auto;padding:24px;border:1px solid #e4e1dc;border-radius:8px;color:#141414;">
    <h1 style="font-family:Georgia,serif;letter-spacing:0.1em;margin-top:0;font-size:24px;">SHAH JACKETS</h1>
    <h2 style="font-size:18px;margin-bottom:8px;">Thank you for your order!</h2>
    <p style="color:#555;">We have received your order <strong>#${order.id}</strong>.</p>
    
    <table style="width:100%;border-collapse:collapse;margin:20px 0;">
      <thead>
        <tr style="text-align:left;color:#777;font-size:12px;border-bottom:2px solid #141414;">
          <th style="padding-bottom:6px;">ITEM</th>
          <th style="padding-bottom:6px;text-align:center;">QTY</th>
          <th style="padding-bottom:6px;text-align:right;">PRICE</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div style="text-align:right;margin-bottom:20px;font-size:14px;">
      <p style="margin:4px 0;">Subtotal: <strong>$${order.subtotal.toFixed(2)}</strong></p>
      ${order.discount ? `<p style="margin:4px 0;color:#a22;">Discount (${order.code}): <strong>-$${order.discount.toFixed(2)}</strong></p>` : ''}
      <p style="margin:4px 0;">Shipping: <strong>FREE</strong></p>
      <p style="font-size:18px;margin:8px 0;border-top:1px solid #ddd;padding-top:8px;">Total: <strong>$${order.total.toFixed(2)}</strong></p>
    </div>

    <div style="background:#f9f9f9;padding:14px;border-radius:6px;font-size:13px;color:#444;">
      <p style="margin:0 0 6px 0;font-weight:bold;">Shipping to:</p>
      ${order.address.name}<br>
      ${order.address.street} ${order.address.apt || ''}<br>
      ${order.address.city}, ${order.address.state} ${order.address.zip}<br>
      ${order.address.country}<br>
      Phone: ${order.address.phone}
    </div>
  </div>`;
}

function refundHtml(refund) {
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:auto;padding:24px;border:1px solid #e4e1dc;border-radius:8px;color:#141414;">
    <h1 style="font-family:Georgia,serif;letter-spacing:0.1em;margin-top:0;font-size:24px;">SHAH JACKETS</h1>
    <h2 style="font-size:18px;margin-bottom:8px;">Refund Request Received (${refund.id})</h2>
    <p style="color:#555;">We have received your 7-day refund request for order <strong>#${refund.orderId}</strong>.</p>
    <div style="background:#f9f9f9;padding:14px;border-radius:6px;margin:16px 0;font-size:13px;">
      <strong>Reason:</strong> ${refund.reason}
    </div>
  </div>`;
}

async function sendMail(to, subject, html) {
  try {
    const r = await resend.emails.send({ from: FROM, to, subject, html });
    if (r && r.error) { console.error('Resend error:', r.error.message || r.error); return false; }
    return true;
  } catch (err) { console.error('Resend error:', err.message); return false; }
}

// Email verification (stateless: codes and tokens are derived from the email, so it works on serverless)
const hm = (k, s) => crypto.createHmac('sha256', PW + k).update(s).digest('hex');
const em = v => String(v || '').trim().toLowerCase();
const win = () => Math.floor(Date.now() / 6e5), day = () => Math.floor(Date.now() / 864e5);
const codeFor = (e, w) => String(parseInt(hm('c', e + ':' + w).slice(0, 8), 16) % 1e6).padStart(6, '0');
const tokFor = (e, dy) => hm('t', e + ':' + dy).slice(0, 32);
const tokOk = (e, t) => [day(), day() - 1].some(x => tokFor(e, x) === t);
const cartKey = e => crypto.createHash('sha1').update(e).digest('hex').slice(0, 20);

const shell = body => `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:auto;padding:24px;border:1px solid #e4e1dc;border-radius:8px;color:#141414;"><h1 style="font-family:Georgia,serif;letter-spacing:0.1em;margin-top:0;font-size:24px;">SHAH JACKETS</h1>${body}</div>`;
const codeHtml = c => shell(`<h2 style="font-size:18px;">Verify your email</h2><p style="color:#555;">Enter this code at checkout. It expires in 10 minutes.</p><p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:16px 0;">${c}</p><p style="color:#888;font-size:12px;">If you did not request this, you can ignore this email.</p>`);
const cartHtml = rows => shell(`<h2 style="font-size:18px;margin-bottom:8px;">You left something in your cart</h2><p style="color:#555;">Your jackets are still waiting for you.</p><table style="width:100%;border-collapse:collapse;margin:16px 0;">${rows.map(({ p, i, price }) => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;"><strong>${p.title}</strong><br><span style="color:#777;font-size:13px;">Size: ${i.size} | Color: ${i.color}</span></td><td style="padding:10px 0;text-align:center;border-bottom:1px solid #eee;">x${i.qty}</td><td style="padding:10px 0;text-align:right;border-bottom:1px solid #eee;">$${(price * i.qty).toFixed(2)}</td></tr>`).join('')}</table><p><a href="${SHOP_URL}" style="display:inline-block;background:#141414;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;">Complete your order</a></p><p style="color:#888;font-size:12px;">Free shipping on all orders | 7-day hassle-free returns</p>`);

async function sendReminders() {
  const d = await load();
  let n = 0;
  for (const c of Object.values(d.carts)) {
    const age = Date.now() - c.t;
    if (c.reminded || age < 36e5 || age > 7 * 864e5) continue;
    const rows = A(c.items).map(i => { const p = d.products.find(x => x.id === i.id); return p ? { p, i, price: eff(p, d.settings) } : null; }).filter(Boolean);
    if (!rows.length) continue;
    if (await sendMail(c.email, 'You left something in your cart - Shah Jackets', cartHtml(rows))) { c.reminded = true; n++; }
  }
  if (n) await save(d);
  return n;
}

// Public Routes
app.get('/api/data', wrap(async (q, s) => {
  const d = await load();
  s.set('Cache-Control', 'public, max-age=15, s-maxage=15');
  s.json({ products: d.products, settings: d.settings });
}));

app.post('/api/promo', wrap(async (q, s) => {
  const r = rate(await load(), q.body.code);
  s.json(r ? { ok: true, rate: r } : { ok: false });
}));

app.post('/api/order', wrap(async (q, s) => {
  const d = await load(), b = q.body;
  let sub = 0;
  const items = (b.items || []).map(i => {
    const p = d.products.find(x => x.id === i.id);
    if (!p) return null;
    const qty = Math.min(50, Math.max(1, +i.qty || +i.q || 1)), pr = +eff(p, d.settings).toFixed(2);
    sub += pr * qty;
    return { id: p.id, title: p.title, price: pr, size: i.size, color: i.color, qty };
  }).filter(Boolean);

  if (!items.length || !b.address || !b.address.email) return s.status(400).json({ error: 'Invalid order' });
  if (REQUIRE_VERIFY && !tokOk(em(b.address.email), b.vtoken)) return s.status(400).json({ error: 'Please verify your email first.' });
  delete d.carts[cartKey(em(b.address.email))];

  const code = String(b.promo || '').toUpperCase(), disc = sub * rate(d, code);
  const o = {
    id: id('SJ-').toUpperCase(),
    date: new Date().toISOString(),
    items,
    subtotal: +sub.toFixed(2),
    discount: +disc.toFixed(2),
    code: disc ? code : '',
    shipping: 0,
    total: +(sub - disc).toFixed(2),
    currency: b.currency,
    address: b.address,
    gateway: b.gateway || 'cod',
    status: 'Pending',
    paid: false
  };

  d.orders.unshift(o);
  await save(d);

  sendMail(b.address.email, `Order Confirmation #${o.id} - Shah Jackets`, orderReceiptHtml(o));
  s.json({ ok: true, order: o });
}));

app.post('/api/verify/send', wrap(async (q, s) => {
  const e = em(q.body.email);
  if (!/^\S+@\S+\.\S+$/.test(e)) return s.status(400).json({ error: 'Enter a valid email.' });
  (await sendMail(e, 'Your Shah Jackets verification code', codeHtml(codeFor(e, win()))))
    ? s.json({ ok: true }) : s.status(502).json({ error: 'Could not send the email. Please try again.' });
}));
app.post('/api/verify/check', wrap(async (q, s) => {
  const e = em(q.body.email), c = String(q.body.code || '').trim();
  if (![win(), win() - 1].some(w => codeFor(e, w) === c)) return s.status(400).json({ error: 'That code is not right or has expired.' });
  s.json({ ok: true, token: tokFor(e, day()) });
}));
app.post('/api/cart', wrap(async (q, s) => {
  const e = em(q.body.email);
  if (!tokOk(e, q.body.vtoken)) return s.status(400).json({ error: 'Verify your email first.' });
  const d = await load(), k = cartKey(e);
  const items = (Array.isArray(q.body.items) ? q.body.items : []).map(i => ({ id: String(i.id), size: i.size, color: i.color, qty: Math.min(50, Math.max(1, +i.q || +i.qty || 1)) }));
  if (!items.length) { if (!d.carts[k]) return s.json({ ok: true }); delete d.carts[k]; }
  else d.carts[k] = { email: e, items, t: Date.now(), reminded: false };
  await save(d);
  s.json({ ok: true });
}));
app.get('/api/cron/reminders', wrap(async (q, s) => s.json({ ok: true, sent: await sendReminders() })));

app.post('/api/refund', wrap(async (q, s) => {
  const d = await load(), { orderId, email, reason } = q.body;
  const o = d.orders.find(x => x.id === (orderId || '').trim().toUpperCase() && x.address.email.toLowerCase() === (email || '').trim().toLowerCase());
  if (!o) return s.status(404).json({ error: 'No order matches that ID and email.' });
  if (Date.now() - new Date(o.date) > 7 * 864e5) return s.status(400).json({ error: 'The 7-day refund window has passed.' });

  const r = { id: id('RF-').toUpperCase(), orderId: o.id, email, reason, date: new Date().toISOString(), status: 'Requested' };
  d.refunds.unshift(r);
  await save(d);

  sendMail(email, `Refund Request Received #${r.id} - Shah Jackets`, refundHtml(r));
  s.json({ ok: true });
}));

app.get('/api/chat/:sid', wrap(async (q, s) => s.json((await load()).chats[sidOf(q)] || { messages: [] })));
app.post('/api/chat/:sid', wrap(async (q, s) => {
  const d = await load(), c = d.chats[sidOf(q)] || (d.chats[sidOf(q)] = { name: q.body.name || 'Guest', messages: [] });
  if (q.body.name) c.name = q.body.name;
  c.messages.push({ from: 'customer', text: String(q.body.text || '').slice(0, 2000), t: Date.now() });
  c.unread = true;
  await save(d);
  s.json({ ok: true });
}));

const gateways = {
  cod: async () => ({ ok: true }),
  stripe: async (o, q) => ({ error: 'Stripe is not activated.' }),
  paypal: async () => ({ error: 'PayPal is not activated.' })
};

app.post('/api/pay/:g', wrap(async (q, s) => {
  const d = await load(), o = d.orders.find(x => x.id === q.body.orderId), g = gateways[q.params.g];
  if (!o || !g) return s.status(400).json({ error: 'Bad request' });
  s.json(await g(o, q));
}));

// Admin Routes - Login ONLY checks password === 'HAZIQALI'
app.post('/api/admin/login', (q, s) => q.body.password === PW ? s.json({ ok: true }) : s.status(401).json({ error: 'Wrong password' }));
app.get('/api/admin/data', admin, wrap(async (q, s) => s.json({ ...(await load()), persistent: !!FB || !process.env.VERCEL })));

// Cloudinary Direct Upload
app.post('/api/admin/reminders', admin, wrap(async (q, s) => s.json({ ok: true, sent: await sendReminders() })));

app.post('/api/admin/image', admin, wrap(async (q, s) => {
  if (!q.body.data || !/^data:image\//.test(q.body.data)) {
    return s.status(400).json({ error: 'Invalid image format' });
  }

  const res = await cloudinary.uploader.upload(q.body.data, {
    folder: 'shah_jackets',
    fetch_format: 'auto',
    quality: 'auto'
  });

  s.json({ url: res.secure_url });
}));

app.post('/api/admin/product', admin, wrap(async (q, s) => {
  const d = await load(), p = q.body, i = d.products.findIndex(x => x.id === p.id);
  if (i < 0) { p.id = id('p'); d.products.unshift(p); } else d.products[i] = p;
  await save(d);
  s.json({ ok: true });
}));

app.delete('/api/admin/product/:id', admin, wrap(async (q, s) => {
  const d = await load();
  d.products = d.products.filter(x => x.id !== q.params.id);
  await save(d);
  s.json({ ok: true });
}));

app.post('/api/admin/order/:id', admin, wrap(async (q, s) => {
  const d = await load(), o = d.orders.find(x => x.id === q.params.id);
  if (o) { o.status = q.body.status; if (q.body.paid != null) o.paid = q.body.paid; }
  await save(d);
  s.json({ ok: true });
}));

app.post('/api/admin/refund/:id', admin, wrap(async (q, s) => {
  const d = await load(), r = d.refunds.find(x => x.id === q.params.id);
  if (r) r.status = q.body.status;
  await save(d);
  s.json({ ok: true });
}));

app.post('/api/admin/chat/:sid', admin, wrap(async (q, s) => {
  const d = await load(), c = d.chats[sidOf(q)];
  if (c) { if (q.body.text) c.messages.push({ from: 'owner', text: q.body.text, t: Date.now() }); c.unread = false; }
  await save(d);
  s.json({ ok: true });
}));

app.post('/api/admin/settings', admin, wrap(async (q, s) => {
  const d = await load();
  d.settings = fill({ settings: q.body }).settings;
  await save(d);
  s.json({ ok: true });
}));

app.post('/api/admin/discount', admin, wrap(async (q, s) => {
  const d = await load(), code = String(q.body.code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, ''), x = d.discounts.find(v => v.code === code);
  if (!code) return s.status(400).json({ error: 'Bad code' });
  const v = { code, pct: Math.min(90, Math.max(1, +q.body.pct || 0)), active: q.body.active !== false };
  x ? Object.assign(x, v) : d.discounts.push(v);
  await save(d);
  s.json({ ok: true });
}));

app.delete('/api/admin/discount/:c', admin, wrap(async (q, s) => {
  const d = await load();
  d.discounts = d.discounts.filter(v => v.code !== q.params.c);
  await save(d);
  s.json({ ok: true });
}));

const GOOGLE_CLIENT_ID = '137888463657-a8hh021g8i4tg1ookc2kqna41tlb4n33.apps.googleusercontent.com';
app.get('/api/config', (q, s) => s.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID }));
app.post('/api/auth/google', wrap(async (q, s) => {
  const cid = process.env.GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID;
  if (!cid) return s.status(503).json({ error: 'Google sign-in is not set up.' });
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(q.body.credential || '')));
  const t = await r.json();
  if (!r.ok || t.aud !== cid || String(t.email_verified) !== 'true') return s.status(401).json({ error: 'Google could not verify this account.' });
  s.json({ ok: true, name: t.name || t.email, email: t.email, picture: t.picture || '', vtoken: tokFor(em(t.email), day()) });
}));

// Static files
['index.html', 'admin.html', 'robots.txt'].forEach(f =>
  app.get(f === 'index.html' ? ['/', '/index.html'] : '/' + f, (q, s) => s.sendFile(path.join(__dirname, f)))
);

module.exports = app;
if (require.main === module) {
  app.listen(process.env.PORT || 3000, () => console.log('Shah Jackets on :3000'));
}
