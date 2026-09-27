// Toko Online - server tanpa dependency. Jalankan: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ERWIN2011';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_STATE_TABLE = process.env.SUPABASE_STATE_TABLE || 'app_state';
const SUPABASE_PUBLIC_BUCKET = process.env.SUPABASE_PUBLIC_BUCKET || 'public-assets';
const SUPABASE_PRIVATE_BUCKET = process.env.SUPABASE_PRIVATE_BUCKET || 'private-uploads';
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- helpers ---------- */
const now = () => new Date().toISOString();
const uid = (n = 8) => crypto.randomBytes(n).toString('hex');
const httpErr = (status, message) => Object.assign(new Error(message), { status });
const str = (v, max) => String(v ?? '').trim().slice(0, max);

function rupiahText(n) {
  return 'Rp' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function orderCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const x of crypto.randomBytes(10)) s += A[x % A.length];
  return 'INV-' + s;
}

/* ---------- database / cloud storage ---------- */
function defaultDb() {
  return {
    settings: { storeName: 'ERWIN STORE', socials: { instagram: 'wwine_22', telegram: 'aboutwinz', whatsapp: '628588363027' } },
    products: [
      { id: uid(), name: 'Produk Contoh A', price: 10000, description: 'Ganti atau hapus produk ini lewat halaman admin.', image: '', active: true },
      { id: uid(), name: 'Produk Contoh B', price: 25000, description: 'Ganti atau hapus produk ini lewat halaman admin.', image: '', active: true },
      { id: uid(), name: 'Produk Contoh C', price: 50000, description: 'Ganti atau hapus produk ini lewat halaman admin.', image: '', active: true }
    ],
    payments: [
      { id: 'qris', name: 'QRIS', enabled: true, holder: '', number: '', image: '', note: 'Scan QR di atas, lalu bayar sesuai nominal.' },
      { id: 'gopay', name: 'GoPay', enabled: true, holder: '', number: '', image: '', note: '' },
      { id: 'dana', name: 'DANA', enabled: true, holder: '', number: '', image: '', note: '' }
    ],
    orders: [],
    bugs: []
  };
}

let db = defaultDb();

async function supabaseRequest(pathname, options = {}) {
  if (!USE_SUPABASE) throw new Error('Supabase belum dikonfigurasi');
  const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY, ...(options.headers || {}) };
  const r = await fetch(SUPABASE_URL + pathname, { ...options, headers });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error((data && (data.message || data.error || data.hint)) || `Supabase HTTP ${r.status}`);
  return data;
}

async function initDb() {
  if (USE_SUPABASE) {
    const rows = await supabaseRequest(`/rest/v1/${SUPABASE_STATE_TABLE}?id=eq.1&select=data`);
    if (rows && rows[0] && rows[0].data) db = rows[0].data;
    else { db = defaultDb(); await save(); }
  } else {
    try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
    catch { db = defaultDb(); await save(); }
  }
  db.settings = db.settings || {};
  if (!db.settings.storeName || db.settings.storeName === 'Toko Saya') db.settings.storeName = 'ERWIN STORE';
  db.settings.socials = { instagram: 'wwine_22', telegram: 'aboutwinz', whatsapp: '628588363027', ...(db.settings.socials || {}) };
  db.bugs = db.bugs || [];
}

async function save() {
  if (USE_SUPABASE) {
    await supabaseRequest(`/rest/v1/${SUPABASE_STATE_TABLE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: 1, data: db, updated_at: now() })
    });
    return;
  }
  const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2)); fs.renameSync(tmp, DB_FILE);
}

const MAGIC = {
  png: b => b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  jpeg: b => b.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  webp: b => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP'
};
async function saveImage(dataUrl, prefix, privateFile = false) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw httpErr(400, 'Gambar harus berformat PNG, JPG, atau WEBP');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 5 * 1024 * 1024) throw httpErr(400, 'Ukuran gambar maksimal 5 MB');
  if (!MAGIC[m[1]](buf)) throw httpErr(400, 'File gambar tidak valid');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const name = `${prefix}-${uid(12)}.${ext}`;
  if (!USE_SUPABASE) { fs.writeFileSync(path.join(UPLOAD_DIR, name), buf); return '/uploads/' + name; }
  const bucket = privateFile ? SUPABASE_PRIVATE_BUCKET : SUPABASE_PUBLIC_BUCKET;
  await supabaseRequest(`/storage/v1/object/${bucket}/${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': `image/${m[1]}`, 'x-upsert': 'false' }, body: buf });
  return `supabase://${bucket}/${name}`;
}
const isDataUrl = v => typeof v === 'string' && v.startsWith('data:');

async function publicAssetUrl(ref) {
  if (!ref) return '';
  if (!USE_SUPABASE || !ref.startsWith('supabase://')) return ref;
  const [, bucket, ...parts] = ref.split('/');
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${parts.join('/')}`;
}
async function signedAssetUrl(ref, expires = 3600) {
  if (!ref) return '';
  if (!USE_SUPABASE || !ref.startsWith('supabase://')) return ref;
  const [, bucket, ...parts] = ref.split('/');
  const data = await supabaseRequest(`/storage/v1/object/sign/${bucket}/${parts.map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: expires }) });
  return data && data.signedURL ? (data.signedURL.startsWith('http') ? data.signedURL : SUPABASE_URL + '/storage/v1' + data.signedURL) : '';
}
async function preparePublicDb() {
  const out = JSON.parse(JSON.stringify(db));
  for (const p of out.products || []) p.image = await publicAssetUrl(p.image);
  for (const p of out.payments || []) p.image = await publicAssetUrl(p.image);
  return out;
}
async function prepareAdminDb() {
  const out = await preparePublicDb();
  for (const o of out.orders || []) if (o.proof) o.proof = await signedAssetUrl(o.proof, 3600);
  for (const b of out.bugs || []) if (b.image) b.image = await signedAssetUrl(b.image, 3600);
  return out;
}

/* ---------- auth admin ---------- */
const tokens = new Map(); // token -> waktu kedaluwarsa
const attempts = new Map(); // ip -> {n, reset}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function isAdmin(req) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const exp = tokens.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { tokens.delete(t); return false; }
  return true;
}

/* ---------- request/response ---------- */
function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false;
    const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) tooBig = true; else chunks.push(c); });
    req.on('end', () => {
      if (tooBig) return reject(httpErr(413, 'Data terlalu besar'));
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch { reject(httpErr(400, 'Format data tidak valid')); }
    });
    req.on('error', reject);
  });
}
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const pubPayment = p => ({ id: p.id, name: p.name, holder: p.holder, number: p.number, image: p.image, note: p.note });
const pubOrder = o => ({
  code: o.code, status: o.status, product: o.product, payment: o.payment, proof: '',
  rejectReason: o.rejectReason, details: o.details, delivery: o.delivery,
  createdAt: o.createdAt, paidAt: o.paidAt || null
});

function cleanSocials(b = {}) {
  const ig = str(b.instagram, 120).replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  if (ig && !/^[A-Za-z0-9._]{1,30}$/.test(ig)) throw httpErr(400, 'Username Instagram tidak valid');
  const tg = str(b.telegram, 120).replace(/^https?:\/\/(www\.)?(t\.me|telegram\.me)\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  if (tg && !/^[A-Za-z0-9_]{5,32}$/.test(tg)) throw httpErr(400, 'Username Telegram tidak valid (5-32 karakter: huruf, angka, atau _)');
  let wa = str(b.whatsapp, 30).replace(/[\s\-().+]/g, '');
  if (wa.startsWith('0')) wa = '62' + wa.slice(1);
  if (wa && !/^\d{8,15}$/.test(wa)) throw httpErr(400, 'Nomor WhatsApp tidak valid');
  return { instagram: ig, telegram: tg, whatsapp: wa };
}

const bugHits = new Map(); // ip -> {n, reset}
const chatHits = new Map(); // ip -> {n, reset}

async function cleanProduct(b, existing) {
  const out = existing ? { ...existing } : { id: uid(), image: '', active: true };
  if (b.name !== undefined || !existing) {
    out.name = str(b.name, 100);
    if (!out.name) throw httpErr(400, 'Nama produk wajib diisi');
  }
  if (b.price !== undefined || !existing) {
    const price = Math.round(Number(b.price));
    if (!Number.isFinite(price) || price < 0 || price > 1e9) throw httpErr(400, 'Harga tidak valid');
    out.price = price;
  }
  if (b.description !== undefined) out.description = str(b.description, 500);
  else if (!existing) out.description = '';
  if (b.active !== undefined) out.active = !!b.active;
  if (isDataUrl(b.image)) out.image = await saveImage(b.image, 'product', false);
  else if (b.removeImage) out.image = '';
  return out;
}

/* ---------- API ---------- */
async function api(req, res, url) {
  await dbReady;
  const p = url.pathname, method = req.method;
  let m;

  /* === publik === */
  if (method === 'GET' && p === '/api/shop') {
    const view = await preparePublicDb();
    return send(res, 200, {
      storeName: view.settings.storeName,
      socials: view.settings.socials,
      products: view.products.filter(x => x.active),
      payments: view.payments.filter(x => x.enabled).map(pubPayment)
    });
  }

  if (method === 'POST' && p === '/api/bugs') {
    const ip = req.socket.remoteAddress || 'x';
    const a = bugHits.get(ip) || { n: 0, reset: Date.now() + 60 * 60 * 1000 };
    if (a.reset < Date.now()) { a.n = 0; a.reset = Date.now() + 60 * 60 * 1000; }
    if (a.n >= 5) throw httpErr(429, 'Terlalu banyak laporan. Coba lagi sekitar satu jam lagi.');
    const b = await readBody(req);
    const message = str(b.message, 1000);
    if (message.length < 10) throw httpErr(400, 'Jelaskan masalahnya minimal 10 huruf');
    const bug = {
      id: uid(), message, contact: str(b.contact, 100), page: str(b.page, 200),
      ua: str(req.headers['user-agent'], 200), image: isDataUrl(b.image) ? await saveImage(b.image, 'bug', true) : '',
      status: 'baru', createdAt: now()
    };
    a.n++; bugHits.set(ip, a);
    db.bugs.unshift(bug);
    if (db.bugs.length > 500) db.bugs.length = 500;
    await save();
    return send(res, 201, { ok: true });
  }

  if (method === 'POST' && p === '/api/chat') {
    if (!GROQ_API_KEY) throw httpErr(503, 'Chatbot belum aktif. Admin belum mengatur API key.');
    const ip = req.socket.remoteAddress || 'x';
    const a = chatHits.get(ip) || { n: 0, reset: Date.now() + 60 * 1000 };
    if (a.reset < Date.now()) { a.n = 0; a.reset = Date.now() + 60 * 1000; }
    if (a.n >= 15) throw httpErr(429, 'Terlalu banyak pertanyaan. Coba lagi sebentar lagi.');
    a.n++; chatHits.set(ip, a);

    const b = await readBody(req);
    const history = (Array.isArray(b.messages) ? b.messages : [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-10)
      .map(m => ({ role: m.role, content: str(m.content, 800) }));
    if (!history.length) throw httpErr(400, 'Pesan kosong');

    const active = db.products.filter(x => x.active);
    const daftarProduk = active.length
      ? active.map(x => `- ${x.name}: ${rupiahText(x.price)}${x.description ? ' — ' + x.description : ''}`).join('\n')
      : '(belum ada produk aktif)';
    const metode = db.payments.filter(x => x.enabled).map(x => x.name).join(', ') || '(belum ada metode aktif)';

    const systemPrompt = `Kamu adalah asisten toko online bernama "${db.settings.storeName}". Jawab HANYA seputar toko ini: produk yang dijual, harga, cara pesan, dan metode pembayaran. Gunakan Bahasa Indonesia yang ramah dan singkat (maksimal beberapa kalimat). Jangan mengarang produk atau harga di luar daftar berikut. Kalau ditanya di luar topik toko, arahkan dengan sopan kembali ke topik toko.

Daftar produk aktif:
${daftarProduk}

Metode pembayaran aktif: ${metode}

Alur belanja: pembeli pilih produk lalu tekan Beli, pilih metode bayar, dapat kode pesanan (INV-XXXXXXXXXX), bayar dan upload bukti transfer, admin mengecek dan mengonfirmasi pembayaran, lalu pembeli mengisi data pengiriman dan pesanan dikirim lewat menu "Cek pesanan" di web ini.`;

    let reply;
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GROQ_API_KEY },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: 'system', content: systemPrompt }, ...history],
          temperature: 0.4,
          max_tokens: 350
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error((data && data.error && data.error.message) || 'Chatbot sedang bermasalah');
      reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!reply) throw new Error('Chatbot tidak memberi jawaban');
    } catch (e) {
      throw httpErr(502, 'Chatbot sedang bermasalah, coba lagi nanti.');
    }
    return send(res, 200, { reply: reply.trim() });
  }

  if (method === 'POST' && p === '/api/orders') {
    const b = await readBody(req);
    const prod = db.products.find(x => x.id === b.productId && x.active);
    const pay = db.payments.find(x => x.id === b.paymentId && x.enabled);
    if (!prod || !pay) throw httpErr(400, 'Produk atau metode pembayaran tidak tersedia');
    const o = {
      code: orderCode(), status: 'menunggu_bukti',
      product: { id: prod.id, name: prod.name, price: prod.price, image: prod.image },
      payment: pubPayment(pay), proof: '', rejectReason: '', details: null, delivery: null,
      createdAt: now(), updatedAt: now()
    };
    db.orders.unshift(o);
    await save();
    return send(res, 201, { code: o.code });
  }

  if ((m = p.match(/^\/api\/orders\/(INV-[A-Z0-9]+)(?:\/(proof|details))?$/))) {
    const o = db.orders.find(x => x.code === m[1]);
    if (!o) throw httpErr(404, 'Pesanan tidak ditemukan. Cek kembali kode pesanan.');

    if (method === 'GET' && !m[2]) return send(res, 200, pubOrder(o));

    if (method === 'POST' && m[2] === 'proof') {
      if (!['menunggu_bukti', 'ditolak'].includes(o.status)) throw httpErr(409, 'Bukti pembayaran tidak bisa dikirim pada status ini');
      const b = await readBody(req);
      o.proof = await saveImage(b.image, 'proof', true);
      o.status = 'menunggu_konfirmasi';
      o.rejectReason = '';
      o.updatedAt = now();
      await save();
      return send(res, 200, pubOrder(o));
    }

    if (method === 'POST' && m[2] === 'details') {
      if (!['dibayar', 'data_terisi'].includes(o.status)) throw httpErr(409, 'Data belum bisa diisi. Pembayaran belum dikonfirmasi.');
      const b = await readBody(req);
      const name = str(b.name, 80), item = str(b.item, 120), email = str(b.email, 120);
      const phone = str(b.phone, 20).replace(/[\s\-().]/g, '');
      if (name.length < 2) throw httpErr(400, 'Nama wajib diisi');
      if (!item) throw httpErr(400, 'Nama barang wajib diisi');
      if (!/^\+?\d{8,16}$/.test(phone)) throw httpErr(400, 'Nomor HP tidak valid');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpErr(400, 'Email tidak valid');
      o.details = { name, item, phone, email, note: str(b.note, 500) };
      o.status = 'data_terisi';
      o.updatedAt = now();
      await save();
      return send(res, 200, pubOrder(o));
    }
    throw httpErr(405, 'Metode tidak didukung');
  }

  /* === admin === */
  if (p === '/api/admin/login' && method === 'POST') {
    const ip = req.socket.remoteAddress || 'x';
    const a = attempts.get(ip) || { n: 0, reset: Date.now() + 5 * 60 * 1000 };
    if (a.reset < Date.now()) { a.n = 0; a.reset = Date.now() + 5 * 60 * 1000; }
    if (a.n >= 5) throw httpErr(429, 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.');
    const b = await readBody(req);
    if (!safeEqual(b.password || '', ADMIN_PASSWORD)) {
      a.n++; attempts.set(ip, a);
      throw httpErr(401, 'Password salah');
    }
    attempts.delete(ip);
    const token = uid(24);
    tokens.set(token, Date.now() + 12 * 60 * 60 * 1000);
    return send(res, 200, { token });
  }

  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) throw httpErr(401, 'Sesi habis. Silakan login lagi.');

    if (p === '/api/admin/data' && method === 'GET') {
      const view = await prepareAdminDb();
      return send(res, 200, { settings: view.settings, products: view.products, payments: view.payments, orders: view.orders, bugs: view.bugs });
    }

    if (p === '/api/admin/settings' && method === 'PUT') {
      const b = await readBody(req);
      const name = str(b.storeName, 60);
      if (!name) throw httpErr(400, 'Nama toko wajib diisi');
      const socials = b.socials !== undefined ? cleanSocials(b.socials) : db.settings.socials;
      db.settings.storeName = name;
      db.settings.socials = socials;
      await save();
      return send(res, 200, db.settings);
    }

    if ((m = p.match(/^\/api\/admin\/bugs\/([a-f0-9]+)$/))) {
      const i = db.bugs.findIndex(x => x.id === m[1]);
      if (i < 0) throw httpErr(404, 'Laporan tidak ditemukan');
      if (method === 'PUT') {
        const b = await readBody(req);
        if (!['baru', 'selesai'].includes(b.status)) throw httpErr(400, 'Status tidak valid');
        db.bugs[i].status = b.status;
        save();
        return send(res, 200, db.bugs[i]);
      }
      if (method === 'DELETE') {
        db.bugs.splice(i, 1);
        save();
        return send(res, 200, { ok: true });
      }
    }

    if (p === '/api/admin/products' && method === 'POST') {
      const prod = await cleanProduct(await readBody(req));
      db.products.unshift(prod);
      await save();
      return send(res, 201, prod);
    }

    if ((m = p.match(/^\/api\/admin\/products\/([a-f0-9]+)$/))) {
      const i = db.products.findIndex(x => x.id === m[1]);
      if (i < 0) throw httpErr(404, 'Produk tidak ditemukan');
      if (method === 'PUT') {
        db.products[i] = await cleanProduct(await readBody(req), db.products[i]);
        save();
        return send(res, 200, db.products[i]);
      }
      if (method === 'DELETE') {
        db.products.splice(i, 1);
        save();
        return send(res, 200, { ok: true });
      }
    }

    if ((m = p.match(/^\/api\/admin\/payments\/(qris|gopay|dana)$/)) && method === 'PUT') {
      const pay = db.payments.find(x => x.id === m[1]);
      const b = await readBody(req);
      if (b.enabled === false && !db.payments.some(x => x.id !== pay.id && x.enabled)) {
        throw httpErr(400, 'Minimal satu metode pembayaran harus aktif');
      }
      if (b.enabled !== undefined) pay.enabled = !!b.enabled;
      if (b.holder !== undefined) pay.holder = str(b.holder, 80);
      if (b.number !== undefined) pay.number = str(b.number, 40);
      if (b.note !== undefined) pay.note = str(b.note, 300);
      if (isDataUrl(b.image)) pay.image = await saveImage(b.image, 'pay-' + pay.id, false);
      else if (b.removeImage) pay.image = '';
      await save();
      return send(res, 200, pay);
    }

    if ((m = p.match(/^\/api\/admin\/orders\/(INV-[A-Z0-9]+)\/(approve|reject|deliver)$/)) && method === 'POST') {
      const o = db.orders.find(x => x.code === m[1]);
      if (!o) throw httpErr(404, 'Pesanan tidak ditemukan');
      const b = await readBody(req);
      if (m[2] === 'approve') {
        if (o.status !== 'menunggu_konfirmasi') throw httpErr(409, 'Pesanan ini tidak sedang menunggu konfirmasi');
        o.status = 'dibayar'; o.paidAt = now();
      } else if (m[2] === 'reject') {
        if (o.status !== 'menunggu_konfirmasi') throw httpErr(409, 'Pesanan ini tidak sedang menunggu konfirmasi');
        o.status = 'ditolak';
        o.rejectReason = str(b.reason, 300) || 'Bukti pembayaran tidak sesuai.';
      } else {
        if (!['dibayar', 'data_terisi'].includes(o.status)) throw httpErr(409, 'Pesanan belum bisa dikirim');
        const message = str(b.message, 3000);
        if (!message) throw httpErr(400, 'Isi pesan pengiriman wajib diisi');
        o.status = 'selesai';
        o.delivery = { message, at: now() };
      }
      o.updatedAt = now();
      await save();
      return send(res, 200, o);
    }
  }

  throw httpErr(404, 'Endpoint tidak ditemukan');
}

/* ---------- file statis ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
function serveFile(res, baseDir, rel) {
  let file;
  try { file = path.resolve(baseDir, '.' + path.sep + decodeURIComponent(rel)); } catch { file = ''; }
  if (!file.startsWith(baseDir + path.sep)) return notFound(res);
  fs.readFile(file, (err, data) => {
    if (err) return notFound(res);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': baseDir === UPLOAD_DIR ? 'public, max-age=86400' : 'no-cache'
    });
    res.end(data);
  });
}
function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Halaman tidak ditemukan');
}

/* ---------- server ---------- */
let dbReady = initDb().then(() => save()).catch(err => { console.error('Database initialization failed:', err); if (USE_SUPABASE) process.exit(1); });

http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/') return serveFile(res, PUBLIC_DIR, 'index.html');
    if (url.pathname === '/admin') return serveFile(res, PUBLIC_DIR, 'admin.html');
    if (url.pathname.startsWith('/uploads/')) return serveFile(res, UPLOAD_DIR, url.pathname.slice(9));
    return serveFile(res, PUBLIC_DIR, url.pathname.slice(1));
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    send(res, status, { error: status === 500 ? 'Terjadi kesalahan di server' : e.message });
  }
}).listen(PORT, () => {
  console.log(`Toko jalan di http://localhost:${PORT}`);
  console.log(`Admin di    http://localhost:${PORT}/admin`);
  if (!process.env.ADMIN_PASSWORD) console.warn('PERINGATAN: masih pakai password admin bawaan "admin123". Set ADMIN_PASSWORD sebelum dipakai publik.');
});
