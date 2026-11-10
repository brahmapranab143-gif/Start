// Aura Shop - dependency-free Node server (shop + admin on ONE port)
// Run: node server.js   |  Shop: /   |  Admin: /admin
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UP_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(UP_DIR, { recursive: true });

// ---------- helpers ----------
const uid = (p = '') => p + crypto.randomBytes(5).toString('hex');
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const checkPw = (pw, stored) => { const [s, h] = stored.split(':'); const x = crypto.scryptSync(pw, s, 32).toString('hex'); return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(x, 'hex')); };
const ph = (t, c) => `/ph.svg?t=${encodeURIComponent(t)}&c=${c}`;

// ---------- DB ----------
let db;
function seed() {
  let firstPw = process.env.ADMIN_PASSWORD;
  if (!firstPw) { firstPw = crypto.randomBytes(5).toString('hex'); console.log('\n*** FIRST RUN ***\nAdmin login -> user: owner  password: ' + firstPw + '\n(Change it in Admin > Settings. This is shown only once.)\n'); }
  const cats = [['Cotton','#c9b79c'],['Sweaters','#8a6f5a'],['Jeans','#3f5b7a'],['Kurtas','#a65e5e'],['Tops','#7d8f69'],['Jackets','#4b4b4b']].map(([n, c]) => ({ id: uid('c_'), name: n, image: ph(n, c.slice(1)) }));
  const mk = (name, ci, price, mrp, c, feat) => ({
    id: uid('p_'), name, category: cats[ci].id, price, mrp, images: [ph(name + ' Front', c), ph(name + ' Back', c), ph(name + ' Detail', c)], videos: [],
    description: 'Premium quality piece, comfortable all-day wear. Edit this description from the admin panel.',
    details: [{ k: 'Material', v: '100% Cotton' }, { k: 'Length', v: '70 cm' }, { k: 'Chest', v: '102 cm' }, { k: 'Wash care', v: 'Machine wash cold' }],
    sizes: ['S', 'M', 'L', 'XL'], stock: 25, featured: !!feat, active: true, created: Date.now()
  });
  return {
    admin: { user: 'owner', pass: hashPw(firstPw) },
    settings: {
      shopName: 'Aura', tagline: 'Timeless style, everyday comfort', currency: '₹',
      helplinePhone: '', helplineEmail: '', whatsapp: '',
      upiId: '', upiName: 'Aura Shop', upiQr: '', codEnabled: true, upiEnabled: true,
      announcement: 'Free delivery on orders above ₹999',
      theme: { primary: '#111111', accent: '#0b4fd8', bg: '#f0f0ee', font: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
      promos: [{ t: 'FREE DELIVERY', s: 'On orders above ₹999' }, { t: '10% OFF FIRST ORDER', s: 'Use code WELCOME10' }, { t: 'EASY RETURNS', s: 'Within 7 days of delivery' }],
      heroImage: ph('Aura Collection', 'd8cfc2'), heroTitle: 'Find clothes that match your style', heroSub: 'Classic cuts, honest fabrics and fair prices, delivered to your door.',
      faq: [
        { q: 'How do I pay?', a: 'Choose UPI (pay in any UPI app, then enter the transaction ID) or Cash on Delivery at checkout.' },
        { q: 'Where is my order / is it confirmed?', a: 'Open "Track Order" and enter your order ID and mobile number. You will see confirmed / shipped / delivered.' },
        { q: 'Can I use an offer code?', a: 'Yes. Enter the code in the cart before checkout and tap Apply.' },
        { q: 'Return policy?', a: 'Contact the helpline within 7 days of delivery for exchange or return.' }
      ],
      layout: [
        { id: uid('s_'), type: 'hero', title: '', enabled: true },
        { id: uid('s_'), type: 'categories', title: 'Shop by Category', enabled: true },
        { id: uid('s_'), type: 'featured', title: 'New Arrivals', enabled: true },
        { id: uid('s_'), type: 'products', title: 'All Products', enabled: true },
        { id: uid('s_'), type: 'testimonials', title: 'What people say', enabled: true },
        { id: uid('s_'), type: 'text', title: 'Why Aura', text: 'Quality fabrics, fair prices, delivered to your door.', enabled: true }
      ]
    },
    categories: cats,
    products: [mk('Classic Cotton Shirt', 0, 899, 1299, 'c9b79c', 1), mk('Cable Knit Sweater', 1, 1499, 2199, '8a6f5a', 1), mk('Slim Fit Jeans', 2, 1299, 1799, '3f5b7a', 1), mk('Printed Kurta', 3, 999, 1499, 'a65e5e'), mk('Linen Top', 4, 749, 999, '7d8f69'), mk('Bomber Jacket', 5, 2299, 2999, '4b4b4b')],
    reviews: [], coupons: [{ code: 'WELCOME10', percent: 10, flat: 0, minOrder: 500, active: true }], orders: []
  };
}
function load() { try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { db = seed(); save(); } }
let saveT; function save() { clearTimeout(saveT); saveT = setTimeout(() => { const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, DB_FILE); }, 100); }
function saveNow() { clearTimeout(saveT); fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); }
load(); db.customers = db.customers || {}; db.smsKey = db.smsKey || ''; db.vtokens = db.vtokens || {}; if (!fs.existsSync(DB_FILE)) saveNow();
// daily backup
setInterval(() => { try { fs.copyFileSync(DB_FILE, path.join(DATA_DIR, 'backup-' + new Date().toISOString().slice(0, 10) + '.json')); } catch {} }, 6 * 3600e3);

// ---------- sessions / rate limit / otp ----------
const sessions = new Map(); // token -> expiry
const hits = new Map();
function limited(key, max, winMs) { const n = Date.now(), a = (hits.get(key) || []).filter(t => n - t < winMs); a.push(n); hits.set(key, a); return a.length > max; }
setInterval(() => { const n = Date.now(); for (const [k, v] of sessions) if (v < n) sessions.delete(k); for (const [k, a] of hits) if (!a.some(t => n - t < 3600e3)) hits.delete(k); }, 600e3);
const otps = new Map(); // phone -> {code, exp, tries}
const verified = new Map(); // token -> {phone, exp}
for (const [t, v] of Object.entries(db.vtokens)) if (v.exp > Date.now()) verified.set(t, v); else delete db.vtokens[t];
const smsKey = () => db.smsKey || process.env.FAST2SMS_KEY || '';
function sendSms(phone, code) {
  const key = smsKey();
  if (!key) return Promise.resolve({ ok: false, none: true });
  return new Promise(res => {
    const fail = msg => { db.smsLastError = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' - ' + msg; res({ ok: false, msg }); };
    const q = `/dev/bulkV2?authorization=${encodeURIComponent(key)}&route=otp&variables_values=${code}&numbers=${phone}`;
    const rq = https.get({ host: 'www.fast2sms.com', path: q, headers: { 'cache-control': 'no-cache' } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        let j = {}; try { j = JSON.parse(d); } catch {}
        const msg = Array.isArray(j.message) ? j.message.join(' ') : (j.message || ('HTTP ' + r.statusCode));
        if (r.statusCode === 200 && j.return !== false) { db.smsLastError = ''; res({ ok: true, msg }); } else fail(msg);
      });
    }).on('error', e => fail(e.message));
    rq.setTimeout(12000, () => { rq.destroy(); fail('SMS provider timed out'); });
  });
}
function getCust(token) {
  const v = verified.get(token); if (!v || v.exp < Date.now()) return null;
  return db.customers[v.phone] || (db.customers[v.phone] = { phone: v.phone, name: '', altPhone: '', addresses: [], firstLogin: Date.now(), lastLogin: Date.now(), lastActive: Date.now(), logins: 1, cart: [] });
}
function cleanAddr(a) {
  a = a || {}; const pin = a.pin && Math.abs(num(a.pin.lat)) <= 90 && Math.abs(num(a.pin.lng)) <= 180 ? { lat: num(a.pin.lat), lng: num(a.pin.lng) } : null;
  return { id: str(a.id, 20) || uid('a_'), label: str(a.label, 20) || 'Home', name: str(a.name, 80), phone: str(a.phone, 15).replace(/\D/g, '').slice(-10), line1: str(a.line1, 200), line2: str(a.line2, 200), city: str(a.city, 60), state: str(a.state, 60), pincode: str(a.pincode, 6).replace(/\D/g, ''), pin };
}
const acctOut = c => ({ phone: c.phone, name: c.name || '', altPhone: c.altPhone || '', addresses: c.addresses || [] });

// ---------- http utils ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.svg': 'image/svg+xml' };
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
function body(req, max = 30e6) {
  return new Promise((ok, no) => { let n = 0; const c = []; req.on('data', d => { n += d.length; if (n > max) { no(new Error('too large')); req.destroy(); } else c.push(d); }); req.on('end', () => { try { ok(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch { no(new Error('bad json')); } }); req.on('error', no); });
}
const isAdmin = req => { const t = (req.headers.authorization || '').replace('Bearer ', ''); const e = sessions.get(t); return e && e > Date.now(); };
const str = (v, n = 500) => String(v == null ? '' : v).slice(0, n);
const num = (v, d = 0) => { v = Number(v); return Number.isFinite(v) ? v : d; };
const ip = req => req.socket.remoteAddress;

function saveUpload(dataUrl, kinds, maxBytes) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl || ''); if (!m) throw new Error('bad file');
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm' }[m[1]];
  if (!ext || !kinds.some(k => m[1].startsWith(k))) throw new Error('file type not allowed');
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > maxBytes) throw new Error('file too big');
  const name = uid('u_') + ext; fs.writeFileSync(path.join(UP_DIR, name), buf); return '/uploads/' + name;
}
function pubProduct(p) { return p; }
function sanitizeProduct(i, old = {}) {
  return {
    id: old.id || uid('p_'), name: str(i.name, 120), category: str(i.category, 40), price: num(i.price), mrp: num(i.mrp), images: (i.images || []).map(x => str(x, 300)).slice(0, 10), videos: (i.videos || []).map(x => str(x, 300)).slice(0, 5),
    description: str(i.description, 3000), details: (i.details || []).slice(0, 30).map(d => ({ k: str(d.k, 60), v: str(d.v, 200) })), sizes: (i.sizes || []).map(x => str(x, 12)).slice(0, 15),
    stock: Math.max(0, num(i.stock)), featured: !!i.featured, active: i.active !== false, created: old.created || Date.now()
  };
}
function calcCoupon(code, subtotal) {
  const c = db.coupons.find(x => x.active && x.code.toUpperCase() === str(code, 30).toUpperCase());
  if (!c) return { ok: false, msg: 'Invalid code' };
  if (subtotal < c.minOrder) return { ok: false, msg: 'Minimum order ₹' + c.minOrder };
  const off = Math.min(subtotal, Math.round(subtotal * c.percent / 100) + c.flat);
  return { ok: true, off, code: c.code };
}

// ---------- API ----------
async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  const admin = p.startsWith('/api/admin/');
  if (admin && p !== '/api/admin/login' && !isAdmin(req)) return json(res, 401, { error: 'Not logged in' });
  let b = {}; if (m === 'POST' || m === 'PUT') b = await body(req, admin ? 30e6 : 6e6);

  // ----- public -----
  if (p === '/api/shop' && m === 'GET') {
    const s = { ...db.settings }; 
    const testimonials = db.reviews.filter(r => r.approved && r.stars >= 4 && r.text).slice(-6).map(r => ({ name: r.name, text: r.text, stars: r.stars }));
    return json(res, 200, { settings: s, categories: db.categories, products: db.products.filter(x => x.active), testimonials });
  }
  if (p === '/api/reviews' && m === 'GET') {
    const pid = url.searchParams.get('product');
    const list = db.reviews.filter(r => r.approved && r.productId === pid).sort((a, b) => b.date - a.date);
    return json(res, 200, list);
  }
  if (p === '/api/review' && m === 'POST') {
    if (limited('rv' + ip(req), 5, 3600e3)) return json(res, 429, { error: 'Too many reviews, try later' });
    const prod = db.products.find(x => x.id === b.productId); if (!prod) return json(res, 400, { error: 'No product' });
    const stars = Math.min(5, Math.max(1, Math.round(num(b.stars, 5))));
    const images = []; for (const d of (b.images || []).slice(0, 3)) { try { images.push(saveUpload(d, ['image/'], 3e6)); } catch {} }
    db.reviews.push({ id: uid('r_'), productId: prod.id, name: str(b.name, 40) || 'Customer', stars, text: str(b.text, 800), images, date: Date.now(), approved: true });
    save(); return json(res, 200, { ok: true });
  }
  if (p === '/api/coupon' && m === 'POST') return json(res, 200, calcCoupon(b.code, num(b.subtotal)));
  if (p === '/api/otp/send' && m === 'POST') {
    const phone = str(b.phone, 15).replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: 'Enter valid 10-digit mobile number' });
    if (limited('otp' + phone, 3, 600e3) || limited('otpip' + ip(req), 10, 600e3)) return json(res, 429, { error: 'Too many OTP requests, wait 10 minutes' });
    const code = String(crypto.randomInt(100000, 999999));
    otps.set(phone, { code, exp: Date.now() + 5 * 60e3, tries: 0 });
    const r = await sendSms(phone, code);
    if (r.none) { console.log(`[OTP] SMS key not set (test mode). OTP for ${phone}: ${code}`); return json(res, 200, { ok: true, sms: false, devOtp: code }); }
    if (!r.ok) { console.log('[SMS FAILED] ' + r.msg); otps.delete(phone); return json(res, 502, { error: 'Could not send the SMS right now. Please try again in a minute.' }); }
    return json(res, 200, { ok: true, sms: true });
  }
  if (p === '/api/otp/verify' && m === 'POST') {
    const phone = str(b.phone, 15).replace(/\D/g, '').slice(-10), o = otps.get(phone);
    if (!o || o.exp < Date.now()) return json(res, 400, { error: 'OTP expired, request a new one' });
    if (++o.tries > 5) { otps.delete(phone); return json(res, 400, { error: 'Too many wrong tries' }); }
    if (str(b.code, 6) !== o.code) return json(res, 400, { error: 'Wrong OTP' });
    otps.delete(phone); const cu = db.customers[phone] || (db.customers[phone] = { phone, name: '', altPhone: '', addresses: [], firstLogin: Date.now(), logins: 0, cart: [] }); cu.logins = (cu.logins || 0) + 1; cu.lastLogin = cu.lastActive = Date.now(); save(); const t = uid('v_') + crypto.randomBytes(8).toString('hex'); verified.set(t, { phone, exp: Date.now() + 30 * 24 * 3600e3 }); db.vtokens[t] = verified.get(t); save();
    return json(res, 200, { ok: true, token: t });
  }
  if (p === '/api/order' && m === 'POST') {
    const v = verified.get(b.token); if (!v || v.exp < Date.now()) return json(res, 400, { error: 'Please verify mobile number with OTP' });
    if (limited('ord' + ip(req), 10, 3600e3)) return json(res, 429, { error: 'Too many orders' });
    const items = []; let sub = 0;
    for (const i of (b.items || []).slice(0, 30)) {
      const pr = db.products.find(x => x.id === i.id && x.active); if (!pr) continue;
      const q = Math.min(20, Math.max(1, Math.round(num(i.qty, 1))));
      if (pr.stock < q) return json(res, 400, { error: pr.name + ' – only ' + pr.stock + ' left' });
      items.push({ id: pr.id, name: pr.name, image: pr.images[0] || '', size: str(i.size, 12), qty: q, price: pr.price }); sub += pr.price * q;
    }
    if (!items.length) return json(res, 400, { error: 'Cart is empty' });
    const c = b.coupon ? calcCoupon(b.coupon, sub) : { ok: false }; const off = c.ok ? c.off : 0;
    const ship = sub - off >= 999 ? 0 : 60, total = sub - off + ship;
    const method = b.method === 'cod' && db.settings.codEnabled ? 'cod' : (db.settings.upiEnabled ? 'upi' : 'cod');
    const a = b.address || {};
    const pin = a.lat != null && Math.abs(num(a.lat)) <= 90 && Math.abs(num(a.lng)) <= 180 ? { lat: num(a.lat), lng: num(a.lng) } : null;
    const order = {
      id: 'AU' + Date.now().toString(36).toUpperCase().slice(-6) + crypto.randomBytes(1).toString('hex').toUpperCase(), items, subtotal: sub, discount: off, coupon: c.ok ? c.code : '', shipping: ship, total,
      customer: { name: str(a.name, 80), accountName: (db.customers[v.phone] || {}).name || '', altPhone: str(a.altPhone, 15).replace(/\D/g, '').slice(-10), phone: v.phone, line1: str(a.line1, 200), line2: str(a.line2, 200), city: str(a.city, 60), state: str(a.state, 60), pincode: str(a.pincode, 6).replace(/\D/g, ''), pin },
      payment: { method, status: 'pending', utr: '' }, status: 'placed', date: Date.now(), note: str(b.note, 300)
    };
    if (!order.customer.name || !order.customer.line1 || order.customer.pincode.length !== 6) return json(res, 400, { error: 'Fill name, address and 6-digit pincode' });
    items.forEach(i => { const pr = db.products.find(x => x.id === i.id); pr.stock -= i.qty; });
    db.orders.unshift(order); { const cu = getCust(b.token); if (cu) { cu.cart = []; cu.lastOrder = Date.now(); } } save();
    const upiLink = method === 'upi' && db.settings.upiId ? `upi://pay?pa=${encodeURIComponent(db.settings.upiId)}&pn=${encodeURIComponent(db.settings.upiName)}&am=${total}&cu=INR&tn=${order.id}&tr=${order.id}` : '';
    return json(res, 200, { ok: true, order: { id: order.id, total, method }, upiLink });
  }
  if (p === '/api/account' && m === 'GET') { const c = getCust(url.searchParams.get('token')); if (!c) return json(res, 401, { error: 'Please verify mobile number with OTP' }); return json(res, 200, acctOut(c)); }
  if (p === '/api/account' && m === 'PUT') {
    const c = getCust(b.token); if (!c) return json(res, 401, { error: 'Please verify mobile number with OTP' });
    if ('name' in b) c.name = str(b.name, 60).trim();
    if ('altPhone' in b) { const ap = str(b.altPhone, 15).replace(/\D/g, '').slice(-10); if (ap && !/^[6-9]\d{9}$/.test(ap)) return json(res, 400, { error: 'Enter a valid 10-digit additional number' }); c.altPhone = ap; }
    if (Array.isArray(b.addresses)) c.addresses = b.addresses.slice(0, 8).map(cleanAddr).filter(x => x.line1 || x.name);
    save(); return json(res, 200, acctOut(c));
  }
  if (p === '/api/ping' && m === 'POST') {
    const c = getCust(b.token); if (!c) return json(res, 401, { error: 'login' });
    c.lastActive = Date.now();
    if (Array.isArray(b.cart)) { c.cart = b.cart.slice(0, 30).map(i => { const pr = db.products.find(x => x.id === i.id); return pr ? { id: pr.id, name: pr.name, size: str(i.size, 12), qty: Math.min(20, Math.max(1, Math.round(num(i.qty, 1)))) } : null; }).filter(Boolean); c.cartAt = Date.now(); save(); }
    return json(res, 200, { ok: true });
  }
  if (p === '/api/myorders' && m === 'GET') {
    const v = verified.get(url.searchParams.get('token')); if (!v || v.exp < Date.now()) return json(res, 401, { error: 'Please verify mobile number with OTP' });
    return json(res, 200, db.orders.filter(o => o.customer.phone === v.phone).slice(0, 30).map(o => ({ id: o.id, status: o.status, total: o.total, date: o.date, items: o.items.map(i => i.name + ' × ' + i.qty), payment: { method: o.payment.method, status: o.payment.status } })));
  }
  if (p === '/api/order/utr' && m === 'POST') {
    const o = db.orders.find(x => x.id === str(b.id, 20) && x.customer.phone === str(b.phone, 10)); if (!o) return json(res, 404, { error: 'Order not found' });
    const utr = str(b.utr, 30).replace(/[^\w-]/g, ''); if (utr.length < 6) return json(res, 400, { error: 'Enter the transaction ID / UTR (at least 6 characters)' });
    o.payment.utr = utr; o.payment.status = 'verify'; save(); return json(res, 200, { ok: true });
  }
  if (p === '/api/track' && m === 'GET') {
    const o = db.orders.find(x => x.id === str(url.searchParams.get('id'), 20).toUpperCase() && x.customer.phone === str(url.searchParams.get('phone'), 10));
    if (!o) return json(res, 404, { error: 'No order found with that ID and mobile number' });
    return json(res, 200, { id: o.id, status: o.status, total: o.total, date: o.date, items: o.items, payment: { method: o.payment.method, status: o.payment.status } });
  }

  // ----- admin -----
  if (p === '/api/admin/login' && m === 'POST') {
    if (limited('login' + ip(req), 8, 600e3)) return json(res, 429, { error: 'Too many attempts. Wait 10 minutes.' });
    if (b.user !== db.admin.user || !checkPw(str(b.pass, 200), db.admin.pass)) return json(res, 401, { error: 'Wrong username or password' });
    const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, Date.now() + 12 * 3600e3); return json(res, 200, { token: t });
  }
  if (p === '/api/admin/all' && m === 'GET') return json(res, 200, { settings: db.settings, categories: db.categories, products: db.products, reviews: db.reviews, coupons: db.coupons, orders: db.orders });
  if (p === '/api/admin/customers' && m === 'GET') {
    const now = Date.now(), phones = new Set([...Object.keys(db.customers), ...db.orders.map(o => o.customer.phone)]);
    const list = [...phones].map(ph => {
      const c = db.customers[ph] || { phone: ph, name: '', altPhone: '', addresses: [], logins: 0, cart: [] };
      const os = db.orders.filter(o => o.customer.phone === ph), live = os.filter(o => o.status !== 'cancelled'), bought = {};
      live.forEach(o => o.items.forEach(i => bought[i.name] = (bought[i.name] || 0) + i.qty));
      const a0 = (c.addresses || [])[0] || (os[0] ? os[0].customer : null);
      return { phone: ph, name: c.name || (os[0] && os[0].customer.name) || '', altPhone: c.altPhone || '', logins: c.logins || 0, firstLogin: c.firstLogin || 0, lastLogin: c.lastLogin || 0, lastActive: c.lastActive || 0, online: now - (c.lastActive || 0) < 5 * 60e3,
        orders: os.length, spent: live.reduce((a, o) => a + o.total, 0), paid: os.filter(o => o.payment.status === 'paid').reduce((a, o) => a + o.total, 0), bought: Object.entries(bought).map(([n, q]) => n + ' × ' + q),
        cart: c.cart || [], cartAt: c.cartAt || 0, addresses: (c.addresses || []).length, address: a0 ? [a0.line1, a0.line2, a0.city, a0.state, a0.pincode].filter(Boolean).join(', ') : '' };
    }).sort((a, b) => Math.max(b.lastActive, b.lastLogin) - Math.max(a.lastActive, a.lastLogin));
    return json(res, 200, list);
  }
  if (p === '/api/admin/sms' && m === 'GET') { const k = smsKey(); return json(res, 200, { configured: !!k, last4: k ? k.slice(-4) : '', source: db.smsKey ? 'panel' : (k ? 'server setting' : ''), lastError: db.smsLastError || '' }); }
  if (p === '/api/admin/sms' && m === 'PUT') { db.smsKey = str(b.key, 200).trim(); saveNow(); const k = smsKey(); return json(res, 200, { configured: !!k, last4: k ? k.slice(-4) : '', source: db.smsKey ? 'panel' : '', lastError: '' }); }
  if (p === '/api/admin/sms/test' && m === 'POST') {
    const phone = str(b.phone, 15).replace(/\D/g, '').slice(-10); if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: 'Enter a valid 10-digit mobile number' });
    const r = await sendSms(phone, String(crypto.randomInt(100000, 999999))); if (r.none) return json(res, 400, { error: 'Save the SMS API key first' });
    return json(res, 200, { ok: r.ok, msg: r.msg });
  }
  if (p === '/api/admin/password' && m === 'POST') {
    if (!checkPw(str(b.old, 200), db.admin.pass)) return json(res, 400, { error: 'Old password wrong' });
    if (str(b.pass, 200).length < 8) return json(res, 400, { error: 'New password must be 8+ characters' });
    db.admin.pass = hashPw(b.pass); if (b.user) db.admin.user = str(b.user, 40); sessions.clear(); saveNow(); return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/upload' && m === 'POST') {
    try { return json(res, 200, { url: saveUpload(b.data, ['image/', 'video/'], 25e6) }); } catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (p === '/api/admin/settings' && m === 'PUT') {
    const s = db.settings, i = b;
    ['shopName', 'tagline', 'helplinePhone', 'helplineEmail', 'whatsapp', 'upiId', 'upiName', 'upiQr', 'announcement', 'heroImage', 'heroTitle', 'heroSub'].forEach(k => { if (k in i) s[k] = str(i[k], 300); });
    if ('codEnabled' in i) s.codEnabled = !!i.codEnabled; if ('upiEnabled' in i) s.upiEnabled = !!i.upiEnabled;
    if (i.theme) ['primary', 'accent', 'bg'].forEach(k => { if (/^#[0-9a-f]{6}$/i.test(i.theme[k] || '')) s.theme[k] = i.theme[k]; });
    if (i.theme && i.theme.font) s.theme.font = str(i.theme.font, 120).replace(/[;{}<>]/g, '');
    if (Array.isArray(i.promos)) s.promos = i.promos.slice(0, 4).map(x => ({ t: str(x.t, 40), s: str(x.s, 80) }));
    if (Array.isArray(i.faq)) s.faq = i.faq.slice(0, 30).map(f => ({ q: str(f.q, 200), a: str(f.a, 1000) }));
    if (Array.isArray(i.layout)) s.layout = i.layout.slice(0, 30).map(l => ({ id: str(l.id, 20) || uid('s_'), type: ['hero', 'categories', 'featured', 'products', 'banner', 'text', 'category', 'testimonials'].includes(l.type) ? l.type : 'text', title: str(l.title, 100), text: str(l.text, 1000), image: str(l.image, 300), category: str(l.category, 40), enabled: l.enabled !== false }));
    saveNow(); return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/categories' && m === 'PUT') { db.categories = (b.list || []).slice(0, 60).map(c => ({ id: str(c.id, 20) || uid('c_'), name: str(c.name, 40), image: str(c.image, 300) })); saveNow(); return json(res, 200, { list: db.categories }); }
  if (p === '/api/admin/coupons' && m === 'PUT') { db.coupons = (b.list || []).slice(0, 50).map(c => ({ code: str(c.code, 30).toUpperCase(), percent: num(c.percent), flat: num(c.flat), minOrder: num(c.minOrder), active: c.active !== false })).filter(c => c.code); saveNow(); return json(res, 200, { ok: true }); }
  if (p === '/api/admin/product' && m === 'POST') { const x = sanitizeProduct(b); db.products.unshift(x); saveNow(); return json(res, 200, x); }
  if (p.startsWith('/api/admin/product/')) {
    const id = p.split('/').pop(), i = db.products.findIndex(x => x.id === id); if (i < 0) return json(res, 404, { error: 'Not found' });
    if (m === 'PUT') { db.products[i] = sanitizeProduct(b, db.products[i]); saveNow(); return json(res, 200, db.products[i]); }
    if (m === 'DELETE') { db.products.splice(i, 1); saveNow(); return json(res, 200, { ok: true }); }
  }
  if (p.startsWith('/api/admin/order/') && m === 'PUT') {
    const o = db.orders.find(x => x.id === p.split('/').pop()); if (!o) return json(res, 404, { error: 'Not found' });
    if (['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'].includes(b.status)) o.status = b.status;
    if (['pending', 'verify', 'paid', 'failed'].includes(b.payStatus)) o.payment.status = b.payStatus;
    saveNow(); return json(res, 200, o);
  }
  if (p.startsWith('/api/admin/review/') && m === 'DELETE') { db.reviews = db.reviews.filter(r => r.id !== p.split('/').pop()); saveNow(); return json(res, 200, { ok: true }); }
  if (p === '/api/admin/review' && m === 'POST') { // owner can add review (e.g. with video) 
    db.reviews.push({ id: uid('r_'), productId: str(b.productId, 20), name: str(b.name, 40), stars: Math.min(5, Math.max(1, num(b.stars, 5))), text: str(b.text, 800), images: (b.images || []).map(x => str(x, 300)).slice(0, 5), date: Date.now(), approved: true }); saveNow(); return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Not found' });
}

// ---------- static ----------
function serveFile(res, file, cache) {
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache ? 'public, max-age=86400' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'); const p = decodeURIComponent(url.pathname);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Referrer-Policy', 'same-origin');
    if (p.startsWith('/api/')) return await api(req, res, url);
    if (p.startsWith('/uploads/')) { const f = path.join(UP_DIR, path.basename(p)); return serveFile(res, f, true); }
    if (p === '/ph.svg') {
      const t = (url.searchParams.get('t') || '').slice(0, 30).replace(/[<>&"']/g, ''), c = (url.searchParams.get('c') || 'ccc').replace(/[^0-9a-f]/gi, '').slice(0, 6) || 'ccc';
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
      return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 750"><rect width="600" height="750" fill="#${c}"/><g fill="none" stroke="rgba(255,255,255,.55)" stroke-width="6"><path d="M200 200l-80 60 40 60 40-30v250h200V290l40 30 40-60-80-60-50 30h-60z"/></g><text x="300" y="690" font-family="Georgia,serif" font-size="30" fill="#fff" text-anchor="middle">${t}</text></svg>`);
    }
    if (p === '/admin' || p === '/admin/') return serveFile(res, path.join(__dirname, 'admin.html'));
    if (p === '/' || p === '/index.html') return serveFile(res, path.join(__dirname, 'public.html'));
    res.writeHead(404); res.end('Not found');
  } catch (e) { if (!res.headersSent) json(res, e.message === 'too large' ? 413 : 400, { error: e.message }); else res.end(); }
});
server.listen(PORT, '0.0.0.0', () => console.log(`Aura Shop running\n Shop  -> http://localhost:${PORT}\n Admin -> http://localhost:${PORT}/admin`));
process.on('SIGTERM', () => { saveNow(); process.exit(0); });
process.on('SIGINT', () => { saveNow(); process.exit(0); });
