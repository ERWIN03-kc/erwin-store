/* Shared helpers for ERWIN STORE */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function rupiah(n) {
  return 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
}
function tanggal(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function linkify(v) {
  const safe = esc(v);
  return safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}
function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:#123044;color:#EAF6FB;border:1px solid #2FA8D6;border-radius:12px;padding:10px 14px;font:600 14px Manrope,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);max-width:min(90vw,520px);text-align:center;';
    document.body.appendChild(el);
  }
  el.textContent = message;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.remove(), 2800);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(String(text)); toast('Berhasil disalin'); }
  catch { toast('Tidak bisa menyalin otomatis'); }
}
function fileToDataUrl(file, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Pilih gambar terlebih dahulu'));
    if (opts.max && file.size > opts.max * 1024 * 1024) return reject(new Error(`Ukuran gambar maksimal ${opts.max} MB`));
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Gagal membaca gambar'));
    r.readAsDataURL(file);
  });
}
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options = { ...options, body: JSON.stringify(options.body) };
  }
  if (options.admin) {
    const token = localStorage.getItem('adminToken');
    if (token) headers.Authorization = 'Bearer ' + token;
  }
  const r = await fetch(path, { ...options, headers });
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    const e = new Error((data && data.error) || `HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return data;
}
