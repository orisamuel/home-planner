// home-planner: the shopping list for the house. Vanilla JS, no build step.
// Data: Google Sheet behind Apps Script (see backend/). Two phones stay in sync by polling.

const STATUS = { need: 'צריך', chosen: 'בחרנו', bought: 'קנינו' };
const NEXT = { need: 'chosen', chosen: 'bought', bought: 'need' };
const CATS = [['furniture', 'רהיטים'], ['lighting', 'תאורה ומאווררים'], ['textile', 'טקסטיל'], ['appliances', 'מוצרי חשמל'],
  ['kitchen', 'מטבח וכלים'], ['bath', 'אמבטיה'], ['storage', 'אחסון וארונות'], ['decor', 'דקורציה'],
  ['garden', 'גינה וחוץ'], ['works', 'עבודות ובעלי מקצוע'], ['tech', 'תקשורת ומיגון']];
const WHO = { ori: 'אורי', rani: 'רני' };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shekel = (n) => '₪' + Math.round(Number(n) || 0).toLocaleString('he-IL');
const LS = {
  get(k, d) { try { const v = localStorage.getItem('hp.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hp.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('hp.' + k); } catch {} },
};

const S = {
  code: LS.get('code', ''), who: LS.get('who', ''),
  items: LS.get('items', []), rooms: LS.get('rooms', [{ id: 'general', name: 'כללי' }]), settings: {},
  pending: {}, filter: 'all', editing: null, status: 'need', photo: null, lastSync: 0, creating: false,
};

// ---------- server ----------
async function api(action, payload = {}) {
  const res = await fetch(CONFIG.SCRIPT_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },       // text/plain: no CORS preflight
    body: JSON.stringify({ action, code: S.code, who: S.who, ...payload }),
  });
  const j = await res.json();
  if (j.auth === false) { logout(j.message); throw new Error(j.message); }
  return j;
}
const ping = () => fetch(CONFIG.SCRIPT_URL + '?action=ping').then((r) => r.json());

// ---------- gate ----------
async function showGate(msg = '') {
  $('main').classList.add('hidden'); $('fab').classList.add('hidden'); $('gate').classList.remove('hidden');
  $('gateErr').textContent = msg;
  try {
    S.creating = !(await ping()).hasCode;
  } catch { $('gateErr').textContent = 'אין חיבור לשרת. בודקים את האינטרנט ומנסים שוב.'; }
  $('code2Wrap').classList.toggle('hidden', !S.creating);
  $('gateHint').textContent = S.creating ? 'פעם ראשונה: בוחרים קוד בית ומספרים אותו רק לבית.' : 'מקלידים את קוד הבית פעם אחת, והטלפון זוכר.';
  $('enter').textContent = S.creating ? 'שומרים את הקוד ונכנסים' : 'כניסה';
  document.querySelectorAll('.who button').forEach((b) => b.classList.toggle('on', b.dataset.who === S.who));
  gateReady();
}
function gateReady() { $('enter').disabled = !($('code').value.trim().length >= 4 && S.who); }
$('code').oninput = gateReady;
document.querySelectorAll('.who button').forEach((b) => b.onclick = () => {
  S.who = b.dataset.who; document.querySelectorAll('.who button').forEach((x) => x.classList.toggle('on', x === b)); gateReady();
});
$('enter').onclick = async () => {
  const code = $('code').value.trim();
  $('enter').disabled = true; $('gateErr').textContent = '';
  try {
    if (S.creating) {
      if (code !== $('code2').value.trim()) throw new Error('שני הקודים לא זהים');
      const r = await api('setCode', { newCode: code });
      if (!r.success) throw new Error(r.message);
    }
    S.code = code;
    const r = await api('check');
    if (!r.success) throw new Error(r.message);
    LS.set('code', code); LS.set('who', S.who);
    $('code').value = ''; $('code2').value = '';
    start();
  } catch (e) { S.code = ''; $('gateErr').textContent = e.message || 'משהו השתבש'; gateReady(); }
};
function logout(msg) { S.code = ''; LS.del('code'); showGate(msg); }

// ---------- data ----------
function view() {                                     // server items with this phone's unsaved changes on top
  const map = new Map(S.items.map((i) => [i.id, i]));
  for (const [id, p] of Object.entries(S.pending)) {
    if (p.op === 'delete') map.delete(id); else map.set(id, { ...map.get(id), ...p.item, _pending: true, _preview: p.preview });
  }
  return [...map.values()];
}
async function sync() {
  if (S.syncing || !S.code) return;
  S.syncing = true;
  try {
    await flushPending();
    const j = await api('getAll');
    if (j.success) { S.items = j.items; S.settings = j.settings || {}; LS.set('items', S.items); S.lastSync = Date.now(); }
  } catch { setSync('אין חיבור. מוצגים הנתונים האחרונים'); }
  S.syncing = false; render();
}
async function flushPending() {                       // resend changes that failed earlier
  for (const [id, p] of Object.entries(S.pending)) if (p.failed) await send(id);
}
async function send(id) {
  const p = S.pending[id]; if (!p) return;
  try {
    if (p.photoData && !p.item.photo) {
      const up = await api('uploadPhoto', { data: p.photoData.split(',')[1], mime: 'image/jpeg', name: p.item.name });
      if (!up.success) throw new Error(up.message);
      p.item.photo = up.id;
    }
    const j = p.op === 'delete' ? await api('deleteItem', { id }) : await api(p.op === 'add' ? 'addItem' : 'updateItem', { item: strip(p.item) });
    if (!j.success) throw new Error(j.message);
    if (j.item) { S.items = S.items.filter((i) => i.id !== id).concat(j.item); }
    if (p.op === 'delete') S.items = S.items.filter((i) => i.id !== id);
    LS.set('items', S.items);
    delete S.pending[id];
  } catch (e) { p.failed = true; toast('לא נשמר עדיין, ננסה שוב בעדכון הבא'); }
  render();
}
const strip = (i) => Object.fromEntries(Object.entries(i).filter(([k]) => !k.startsWith('_')));
async function loadHouse() {
  try {
    const j = await api('getHouse');
    if (!j.success) return;
    const H = j.house;
    S.rooms = [...H.rooms, ...H.outdoor.filter((o) => !o.approx)].map((r) => ({ id: r.id, name: r.name })).concat([{ id: 'general', name: 'כללי' }]);
    LS.set('rooms', S.rooms); render();
  } catch {}
}

// ---------- render ----------
function setSync(t) { $('sync').textContent = t; }
function syncLabel() {
  if (!S.lastSync) return;
  const s = Math.round((Date.now() - S.lastSync) / 1000);
  setSync(s < 15 ? 'מעודכן' : s < 90 ? `עודכן לפני ${s} שניות` : `עודכן לפני ${Math.round(s / 60)} דקות`);
}
function photoHTML(i) {
  if (i._preview) return `<img src="${i._preview}" alt="">`;
  if (i.photo) return `<img data-photo="${esc(i.photo)}" src="https://lh3.googleusercontent.com/d/${encodeURIComponent(i.photo)}=w240" alt="" loading="lazy">`;
  return '🛋';
}
function render() {
  const all = view(), roomName = Object.fromEntries(S.rooms.map((r) => [r.id, r.name]));
  // summary
  const paid = all.filter((i) => i.status === 'bought').reduce((s, i) => s + (Number(i.paid) || Number(i.planned) || 0), 0);
  const plan = all.filter((i) => i.status !== 'bought').reduce((s, i) => s + (Number(i.planned) || 0) * (Number(i.qty) || 1), 0);
  $('sumPaid').textContent = shekel(paid);
  $('sumPlan').textContent = plan ? `עוד ${shekel(plan)} מתוכנן` : '';
  $('sumCount').textContent = `${all.length} פריטים · ${all.filter((i) => i.status === 'bought').length} קנינו`;
  const tot = paid + plan || 1;
  $('barPaid').style.width = (paid / tot * 100) + '%'; $('barPlan').style.width = (plan / tot * 100) + '%';
  // chips
  const counts = { all: all.length, need: 0, chosen: 0, bought: 0 }; all.forEach((i) => counts[i.status]++);
  $('statusChips').innerHTML = [['all', 'הכול'], ...Object.entries(STATUS)].map(([k, t]) =>
    `<button class="chip ${S.filter === k ? 'on' : ''}" data-f="${k}">${t}<span class="n">${counts[k] || 0}</span></button>`).join('');
  // list grouped by room, in house order
  const shown = all.filter((i) => S.filter === 'all' || i.status === S.filter);
  const order = S.rooms.map((r) => r.id), groups = {};
  const pos = (id) => { const k = order.indexOf(id); return k < 0 ? 999 : k; };
  shown.forEach((i) => (groups[i.room || 'general'] ||= []).push(i));
  const ids = Object.keys(groups).sort((a, b) => pos(a) - pos(b));
  $('list').innerHTML = ids.length ? ids.map((rid) => `
    <h2 class="room"><span>${esc(roomName[rid] || rid)}</span><span class="muted">${groups[rid].length}</span></h2>
    ${groups[rid].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).map((i) => `
      <div class="item ${i._pending ? 'pending' : ''}" data-id="${esc(i.id)}" role="button" tabindex="0">
        <div class="ph">${photoHTML(i)}</div>
        <div class="txt"><div class="n">${esc(i.name)}</div>
          <div class="m">${[i.status === 'bought' && i.paid ? shekel(i.paid) : i.planned ? 'בערך ' + shekel(i.planned) : '', i.store].filter(Boolean).map(esc).join(' · ')}</div></div>
        ${i.added_by ? `<span class="by" style="background:var(--${i.added_by === 'רני' ? 'rani' : 'ori'})">${esc(i.added_by[0])}</span>` : ''}
        <button class="st ${i.status}" data-cycle="${esc(i.id)}" aria-label="שינוי מצב">${STATUS[i.status] || ''}</button>
      </div>`).join('')}`).join('')
    : `<div class="empty">${S.filter === 'all' ? 'עוד אין פריטים. לוחצים על + ומוסיפים את הראשון.' : 'אין פריטים במצב הזה.'}</div>`;
  $('me').textContent = (WHO[S.who] || '?')[0];
  $('me').style.background = `var(--${S.who || 'ori'})`;
  syncLabel();
}
// photos the domain will not share by link come back through the script
document.addEventListener('error', async (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.photo || img.dataset.tried) return;
  img.dataset.tried = '1';
  try { const j = await api('getPhoto', { id: img.dataset.photo }); if (j.success) img.src = `data:${j.mime};base64,${j.data}`; } catch {}
}, true);

// ---------- list interactions ----------
$('statusChips').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { S.filter = b.dataset.f; render(); } };
$('list').onclick = (e) => {
  const c = e.target.closest('[data-cycle]');
  if (c) { const i = view().find((x) => x.id === c.dataset.cycle); if (i) change(i.id, { ...strip(i), status: NEXT[i.status] }, 'update'); return; }
  const row = e.target.closest('.item'); if (row) openSheet(view().find((x) => x.id === row.dataset.id));
};
function change(id, item, op, extra = {}) { S.pending[id] = { op, item, ...extra }; render(); send(id); }
$('me').onclick = () => { if (confirm('להחליף משתמש בטלפון הזה?')) { LS.del('who'); S.who = ''; logout(''); } };

// ---------- add / edit sheet ----------
function fillSelects() {
  $('fRoom').innerHTML = S.rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  $('fCat').innerHTML = '<option value="">בלי קטגוריה</option>' + CATS.map(([k, t]) => `<option value="${k}">${t}</option>`).join('');
}
function setStatus(s) { S.status = s; document.querySelectorAll('#fStatus button').forEach((b) => b.classList.toggle('on', b.dataset.s === s)); $('paidWrap').classList.toggle('hidden', s !== 'bought'); }
function openSheet(item = null) {
  S.editing = item; S.photo = null; fillSelects();
  $('sheetTitle').textContent = item ? 'עריכה' : 'פריט חדש';
  $('fName').value = item?.name || ''; $('fRoom').value = item?.room || S.lastRoom || S.rooms[0]?.id || 'general';
  $('fCat').value = item?.category || ''; $('fPlanned').value = item?.planned ?? ''; $('fPaid').value = item?.paid ?? '';
  $('fStore').value = item?.store || ''; $('fLink').value = item?.link || ''; $('fNote').value = item?.note || '';
  $('fPhotoPrev').innerHTML = item ? photoHTML(item) : '📷';
  setStatus(item?.status || 'need');
  $('del').classList.toggle('hidden', !item);
  $('scrim').classList.remove('hidden'); $('sheet').classList.remove('hidden');
  if (!item) setTimeout(() => $('fName').focus(), 50);
}
function closeSheet() { $('scrim').classList.add('hidden'); $('sheet').classList.add('hidden'); }
document.querySelectorAll('#fStatus button').forEach((b) => b.onclick = () => setStatus(b.dataset.s));
$('fab').onclick = () => openSheet();
$('close').onclick = closeSheet; $('scrim').onclick = closeSheet;
$('pickPhoto').onclick = () => $('fPhoto').click();
$('fPhoto').onchange = async () => {
  const f = $('fPhoto').files[0]; if (!f) return;
  try { S.photo = await shrink(f); $('fPhotoPrev').innerHTML = `<img src="${S.photo}" alt="">`; } catch { toast('לא הצלחנו לקרוא את התמונה'); }
  $('fPhoto').value = '';
};
async function shrink(file) {                         // phone photo -> JPEG of at most PHOTO_MAX_PX
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, CONFIG.PHOTO_MAX_PX / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', .82);
}
const num = (v) => { const n = Number(String(v).replace(/[^\d.]/g, '')); return v === '' || isNaN(n) ? '' : n; };
$('sheet').onsubmit = (e) => {
  e.preventDefault();
  const name = $('fName').value.trim(); if (!name) { $('fName').focus(); return; }
  const isNew = !S.editing, id = isNew ? Math.random().toString(36).slice(2, 10) : S.editing.id;
  const item = {
    ...(S.editing ? strip(S.editing) : {}), id, name, room: $('fRoom').value, category: $('fCat').value, status: S.status,
    planned: num($('fPlanned').value), paid: S.status === 'bought' ? num($('fPaid').value) : (S.editing?.paid ?? ''),
    store: $('fStore').value.trim(), link: $('fLink').value.trim(), note: $('fNote').value.trim(),
    added_by: S.editing?.added_by || WHO[S.who], updated_at: Date.now(),
  };
  if (S.photo) item.photo = '';
  S.lastRoom = item.room;
  closeSheet();
  change(id, item, isNew ? 'add' : 'update', S.photo ? { photoData: S.photo, preview: S.photo } : {});
};
$('del').onclick = () => {
  if (!S.editing || !confirm(`למחוק את "${S.editing.name}"?`)) return;
  const id = S.editing.id; closeSheet(); change(id, {}, 'delete');
};

// ---------- misc ----------
let toastT;
function toast(t) { $('toast').textContent = t; $('toast').classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => $('toast').classList.add('hidden'), 3200); }

let timer;
function start() {
  $('gate').classList.add('hidden'); $('main').classList.remove('hidden'); $('fab').classList.remove('hidden');
  render(); loadHouse(); sync();
  clearInterval(timer);
  timer = setInterval(() => { if (document.visibilityState === 'visible') sync(); else syncLabel(); }, CONFIG.POLL_MS);
  setInterval(syncLabel, 10000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });

if (S.code && S.who) start(); else showGate();
