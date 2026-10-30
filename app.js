// home-planner: the house is the home screen. A 3D model (house3d.js) fills the screen and a
// bottom sheet carries everything else: the whole house, one room, the full list, the budget.
// Data: Google Sheet behind Apps Script. Two phones stay in sync by polling.

const STATUS = { need: 'צריך', chosen: 'בחרנו', bought: 'קנינו' };
const CATS = [['furniture', 'רהיטים'], ['lighting', 'תאורה ומאווררים'], ['textile', 'טקסטיל'], ['appliances', 'מוצרי חשמל'],
  ['kitchen', 'מטבח'], ['bath', 'אמבטיה'], ['storage', 'אחסון וארונות'], ['decor', 'דקורציה'],
  ['garden', 'גינה וחוץ'], ['works', 'עבודות ובעלי מקצוע'], ['tech', 'תקשורת ומיגון']];
const CAT = Object.fromEntries(CATS);
const FLOOR = { porcelain80: 'פורצלן 80/80', porcelain60: 'פורצלן 60/60', parquet: 'פרקט', tile30: 'אריחים', outdoor: 'ריצוף חוץ', grass: 'דשא' };
const WHO = { ori: 'אורי', rani: 'רני' };

const $ = (id) => document.getElementById(id);
// "לפני 5 דק'": how long ago something changed
function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'עכשיו';
  if (s < 3600) return `לפני ${Math.round(s / 60)} דק'`;
  if (s < 7200) return 'לפני שעה';
  if (s < 86400) return `לפני ${Math.round(s / 3600)} שעות`;
  if (s < 172800) return 'אתמול';
  return `לפני ${Math.round(s / 86400)} ימים`;
}
// a pasted share often carries text around the link ("look at this https://…"): keep the link only, and only http(s)
function cleanLink(s) {
  const m = String(s || '').match(/https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/i);
  return m ? (/^www\./i.test(m[0]) ? 'https://' + m[0] : m[0]) : '';
}
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
// a first name from the product page address: stores put the product name in the last path segment
function nameFromLink(u) {
  try {
    const segs = new URL(u).pathname.split('/').map((s) => { try { return decodeURIComponent(s); } catch { return s; } })
      .map((s) => s.replace(/\.(html?|aspx?|php)$/i, '').replace(/[-_+]+/g, ' ').replace(/\b[a-z]{0,3}\d{4,}\b/gi, '').replace(/\s+/g, ' ').trim())
      .filter((s) => /[a-zא-ת]{3}/i.test(s) && !/^(products?|items?|shop|catalog|collections?|category)$/i.test(s));
    const n = segs.pop();
    return n ? n.slice(0, 40) : 'מוצר מ-' + host(u);
  } catch { return 'מוצר'; }
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shekel = (n) => '₪' + Math.round(Number(n) || 0).toLocaleString('he-IL');
const kShort = (n) => { n = Math.round(Number(n) || 0); return n >= 1000 ? (Math.round(n / 100) / 10).toLocaleString('he-IL') + 'K' : String(n); };
const LS = {
  get(k, d) { try { const v = localStorage.getItem('hp.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hp.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('hp.' + k); } catch {} },
};
// local testing only: point the site at a mock backend with ?api=...
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  const api = new URLSearchParams(location.search).get('api'); if (api) CONFIG.SCRIPT_URL = api;
}

const S = {
  code: LS.get('code', ''), who: LS.get('who', ''),
  items: LS.get('items', []), settings: LS.get('settings', {}), house: LS.get('house', null),
  rooms: [{ id: 'general', name: 'כללי' }], pending: {}, view: 'home', size: 'peek', room: null, filter: 'all', q: '',
  editing: null, status: 'need', photo: null, open: null, hidden: new Set(), order: new Map(), newOrder: new Map(), lastSync: 0, creating: false, h3: null,
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
const ping = () => fetch(CONFIG.SCRIPT_URL + (CONFIG.SCRIPT_URL.includes('?') ? '&' : '?') + 'action=ping').then((r) => r.json());

// ---------- gate ----------
async function showGate(msg = '') {
  $('app').classList.add('hidden'); $('gate').classList.remove('hidden');
  $('gateErr').textContent = msg;
  try { S.creating = !(await ping()).hasCode; } catch { $('gateErr').textContent = 'אין חיבור לשרת. בודקים את האינטרנט ומנסים שוב.'; }
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
  if (!S.order.size && S.items.length) S.order = new Map(S.items.map((x, k) => [x.id, k]));
  const map = new Map(S.items.filter((i) => !S.hidden.has(i.id)).map((i) => [i.id, i]));
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
    let j = await api('getAll');
    if (j.success && j.settings && j.settings.seeded !== 'כן' && !S.seeded) {           // first run: the starter list
      S.seeded = true;
      const s = await api('seed');
      if (s.success && s.added) { toast(`הכנסתי רשימה ראשונה: ${s.added} דברים שהבית צריך`); j = await api('getAll'); }
    }
    if (j.success) { S.items = j.items; S.order = new Map(j.items.map((x, k) => [x.id, k])); S.settings = j.settings || {}; LS.set('items', S.items); LS.set('settings', S.settings); S.lastSync = Date.now(); }
  } catch { setSync('אין חיבור. מוצגים הנתונים האחרונים'); }
  S.syncing = false; render();
}
async function flushPending() { for (const [id, p] of Object.entries(S.pending)) if (p.failed) await send(id); }
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
    if (j.item) S.items = S.items.filter((i) => i.id !== id).concat(j.item);
    if (p.op === 'delete') S.items = S.items.filter((i) => i.id !== id);
    LS.set('items', S.items);
    delete S.pending[id];
  } catch { p.failed = true; toast('לא נשמר עדיין, ננסה שוב בעדכון הבא'); }
  render();
}
const strip = (i) => Object.fromEntries(Object.entries(i).filter(([k]) => !k.startsWith('_')));
async function loadHouse() {
  if (S.house) useHouse(S.house);
  try {
    const j = await api('getHouse');
    if (j.success && JSON.stringify(j.house) !== JSON.stringify(S.house)) { S.house = j.house; LS.set('house', j.house); useHouse(j.house, true); }
  } catch {}
}
function useHouse(H, fresh = false) {
  S.rooms = [...H.rooms, ...H.outdoor].map((r) => ({ id: r.id, name: r.name, out: H.outdoor.includes(r) })).concat([{ id: 'general', name: 'כללי' }]);
  if (!S.h3 || fresh) build3D(H);
  render();
}
async function build3D(H) {
  try {
    if (S.h3) return;                                 // a newer model arrives on the next visit
    const { createHouse } = await import('./house3d.js?v=20261030a');
    S.h3 = createHouse({ canvas: $('c3d'), labelsEl: $('labels'), house: H, onRoomTap: openRoom });
    layout(); S.h3.setProgress(progress());
    const now = new Date(); setHour(Math.min(16, Math.max(8, now.getHours() + Math.round(now.getMinutes() / 15) * .25)));   // today's light, never after dark
    if (S.view === 'room' && S.room) S.h3.enterRoom(S.room); else S.h3.goHome();
    setTimeout(() => $('loading').classList.add('done'), 250);
  } catch (e) {
    console.error(e);
    $('loading').innerHTML = '<span>לא הצלחנו להציג את הבית בתלת ממד בטלפון הזה.</span>';
    setTimeout(() => $('loading').classList.add('done'), 1800);
    setSheet('list', 'full');
  }
}

// ---------- numbers ----------
const qty = (i) => Number(i.qty) || 1;
const plannedOf = (i) => (Number(i.planned) || 0) * qty(i);
const paidOf = (i) => Number(i.paid) || plannedOf(i);
function totals(list) {
  const t = { paid: 0, chosen: 0, need: 0, n: list.length, bought: 0, unpriced: 0 };
  for (const i of list) {
    if (i.status === 'bought') { t.paid += paidOf(i); t.bought++; }
    else if (i.status === 'chosen') t.chosen += plannedOf(i);
    else t.need += plannedOf(i);
    if (i.status !== 'bought' && !Number(i.planned)) t.unpriced++;
  }
  return t;
}
const budgetTotal = () => Number(S.settings.total_budget) || 0;            // the frame lives on the server only
function progress() {
  const map = {};
  for (const i of view()) { const p = (map[i.room || 'general'] ||= { total: 0, bought: 0 }); p.total++; if (i.status === 'bought') p.bought++; }
  return map;
}
function barHTML(t, total) {
  const max = Math.max(total, t.paid + t.chosen + t.need) || 1, pc = (v) => (v / max * 100).toFixed(2) + '%';
  return `<div class="bar ${total && t.paid + t.chosen + t.need > total ? 'over' : ''}"><i class="paid" style="width:${pc(t.paid)}"></i><i class="chosen" style="width:${pc(t.chosen)}"></i><i class="need" style="width:${pc(t.need)}"></i></div>`;
}

// ---------- sheet ----------
const SIZES = () => ({ peek: S.view === 'room' ? 262 : 312, half: Math.round(innerHeight * .5), full: Math.round(innerHeight * .88) });
function setSize(size) {
  S.size = size;
  $('sheet').style.setProperty('--sheet-h', SIZES()[size] + 'px');
  $('labels').classList.toggle('off', size === 'full');              // no room labels squeezed above a full sheet
  layout();
}
function setSheet(view, size, room) {
  S.view = view; if (room !== undefined) S.room = room;
  $('homeBtn').classList.toggle('hidden', view === 'home');
  setSize(size || S.size);
  renderSheet(true);
}
// typing on a phone: the keyboard covers the lower half, so the sheet rises first. Size only, no redraw
// (a redraw would replace the field and close the keyboard).
$('shBody').addEventListener('focusin', (e) => {
  if (e.target.matches('input') && S.size !== 'full' && matchMedia('(pointer: coarse)').matches) setSize('full');
});
function layout() {
  if (!S.h3) return;
  const desk = innerWidth >= 700;
  S.h3.resize(innerWidth, innerHeight);
  S.h3.setInsets(document.querySelector('.top').offsetHeight - 12, desk ? 0 : SIZES()[S.size]);
}
function openRoom(id) {
  if (S.h3) { if (id === 'general') S.h3.goHome(); else S.h3.enterRoom(id); }
  $('eyeHint')?.remove();
  S.open = null;
  setSheet('room', 'half', id);
}
function goHome() { if (S.h3) S.h3.goHome(); setSheet('home', 'peek', null); }

function itemHTML(i, showRoom) {
  const room = S.rooms.find((r) => r.id === i.room), open = S.open === i.id;
  const meta = [i.status === 'bought' && i.paid ? shekel(i.paid) : i.planned ? 'בערך ' + shekel(plannedOf(i)) : '', qty(i) > 1 ? `×${qty(i)}` : '', showRoom && room ? room.name : '', i.store || (i.link ? '🔗 ' + host(i.link) : '')].filter(Boolean);
  return `<div class="item ${open ? 'open' : ''} ${i._pending ? 'pending' : ''}" data-id="${esc(i.id)}">
    <div class="row1">
      <div class="ph">${photoHTML(i)}</div>
      <div class="txt"><div class="n">${esc(i.name)}</div><div class="m">${meta.map(esc).join(' · ')}${i.before_move && i.status !== 'bought' ? ' <span class="flag">· לפני הכניסה</span>' : ''}</div></div>
      ${i.added_by ? `<span class="by" style="background:var(--${i.added_by === 'רני' ? 'rani' : 'ori'})">${esc(i.added_by[0])}</span>` : ''}
      <span class="st ${i.status}">${i.status === 'bought' ? '✓ ' : ''}${STATUS[i.status] || ''}</span>
    </div>
    ${open ? `<div class="acts">
      <div class="seg3">${['need', 'chosen', 'bought'].map((st) => `<button type="button" data-set="${st}" data-s="${st}" class="${i.status === st ? 'on' : ''}">${STATUS[st]}</button>`).join('')}</div>
      <div class="pricerow">
        <label for="priceIn">${i.status === 'bought' ? 'כמה שילמנו' : 'מחיר משוער'}</label>
        <input class="input" id="priceIn" inputmode="numeric" enterkeyhint="done" value="${esc(i.status === 'bought' ? (i.paid ?? '') : (i.planned ?? ''))}" placeholder="${i.status === 'bought' && i.planned ? 'בערך ' + esc(i.planned) : '₪'}">
      </div>
      <div class="linkrow">${i.link
        ? `<a class="chipbtn link" href="${esc(i.link)}" target="_blank" rel="noopener">🔗 ${esc(host(i.link))} ↗</a><button type="button" class="chipbtn" data-act="unlink" aria-label="הסרת הקישור">✕</button>`
        : `<input class="input" id="linkIn" inputmode="url" dir="ltr" placeholder="🔗 הדבקת קישור למוצר" enterkeyhint="done">`}</div>
      <div class="row2">
        <button type="button" class="chipbtn" data-act="photo">📷 תמונה</button>
        <button type="button" class="chipbtn" data-act="edit">עוד פרטים</button>
        <button type="button" class="chipbtn danger" data-act="del">מחיקה</button>
      </div>
    </div>` : ''}
  </div>`;
}
function photoHTML(i) {
  if (i._preview) return `<img src="${i._preview}" alt="">`;
  if (i.photo) return `<img src="https://lh3.googleusercontent.com/d/${encodeURIComponent(i.photo)}=w240" alt="" loading="lazy">`;
  return { furniture: '🛋', lighting: '💡', textile: '🧵', appliances: '🔌', kitchen: '🍳', bath: '🛁', storage: '🗄', decor: '🖼', garden: '🌿', works: '🔨', tech: '📶' }[i.category] || '•';
}

function renderSheet(force) {
  const body = $('shBody');
  if (!force && body.contains(document.activeElement) && document.activeElement.matches('input')) return;   // don't fight typing
  const top = body.scrollTop, all = view(), T = totals(all), total = budgetTotal();
  let html = '';
  if (S.view === 'home') {
    const before = all.filter((i) => i.before_move && i.status !== 'bought').length;
    const counts = { need: 0, chosen: 0, bought: 0 }; all.forEach((i) => counts[i.status]++);
    const prog = progress();
    html = `
      <div class="sh-head"><div><h2>כל הבית</h2><div class="muted">${T.n} דברים ברשימה · ${T.bought} כבר בבית</div></div>
        <div class="hbtns"><button class="chipbtn primary" data-act="add">+ להוסיף</button></div></div>
      <button class="bud" data-go="budget">
        <div class="row"><span class="muted">שולם</span><span class="muted">${total ? 'מסגרת ' + shekel(total) : 'עוד אין מסגרת'}</span></div>
        <div class="row"><span class="big">${shekel(T.paid)}</span><span class="muted">${T.chosen + T.need ? 'עוד ' + shekel(T.chosen + T.need) + ' מתוכנן' : 'עוד אין מחירים'}</span></div>
        ${barHTML(T, total)}
      </button>
      <div class="tiles">${['need', 'chosen', 'bought'].map((s) => `<button class="tile ${s}" data-list="${s}"><b>${counts[s]}</b><span>${STATUS[s]}</span></button>`).join('')}</div>
      ${recentHTML(all)}
      ${before ? `<button class="line-btn" data-list="before"><span><b>לפני הכניסה</b> <span class="muted">· מה חייב להיות בבית ביום המעבר</span></span><span class="chipbtn">${before}</span></button>` : ''}
      <div class="sec"><span>חדרים</span><span class="muted">נגיעה בחדר בבית או כאן</span></div>
      <div class="strip">${S.rooms.map((r) => { const p = prog[r.id]; return `<button class="chipbtn" data-room="${esc(r.id)}">${esc(r.name)}${p ? `<span class="n">${p.bought}/${p.total}</span>` : ''}</button>`; }).join('')}</div>
      <button class="line-btn" data-list="all" style="margin-top:12px"><b>כל הרשימה</b><span class="muted">${T.n} ←</span></button>`;
  } else if (S.view === 'room') {
    const r = S.rooms.find((x) => x.id === S.room) || { id: S.room, name: S.room };
    const meta = S.h3 && r.id !== 'general' ? S.h3.roomMeta(r.id) : null;
    const items = all.filter((i) => (i.room || 'general') === r.id).sort(byOrder);
    const RT = totals(items), dims = meta && meta.w ? `${(meta.w / 100).toFixed(2)} × ${(meta.d / 100).toFixed(2)} מ' · ` : '';
    html = `
      <div class="sh-head"><div><h2>${esc(r.name)}</h2><div class="muted">${meta ? `${dims}${meta.area.toFixed(1)} מ"ר · ${FLOOR[meta.floor] || ''}` : 'דברים לכל הבית'}</div></div>
        <div class="hbtns">${meta && !meta.out ? `<button class="chipbtn ${S.h3 && S.h3.isEye() ? 'dark' : ''}" data-act="eye">👁 ${S.h3 && S.h3.isEye() ? 'מלמעלה' : 'בפנים'}</button>` : ''}<button class="chipbtn primary" data-act="add">+</button></div></div>
      ${items.length ? `<div class="bud" style="cursor:default"><div class="row"><span class="muted">${RT.bought} מתוך ${RT.n} כבר בבית</span><span class="muted">${RT.paid ? 'שולם ' + shekel(RT.paid) : ''}${RT.chosen + RT.need ? ' · מתוכנן ' + shekel(RT.chosen + RT.need) : ''}</span></div>${barHTML(RT, Math.max(1, RT.paid + RT.chosen + RT.need))}</div>` : ''}
      <form class="quick" id="quick"><input class="input" id="quickIn" placeholder="מה עוד צריך ב${esc(r.name)}?" enterkeyhint="done"><button class="chipbtn primary">הוספה</button></form>
      ${items.length ? items.map((i) => itemHTML(i)).join('') : `<div class="empty">עוד אין כאן כלום.</div>`}`;
  } else if (S.view === 'list') {
    const f = S.filter, q = S.q.trim();
    const counts = { all: all.length, need: 0, chosen: 0, bought: 0, before: 0 };
    all.forEach((i) => { counts[i.status]++; if (i.before_move && i.status !== 'bought') counts.before++; });
    const shown = all.filter((i) => (f === 'all' || (f === 'before' ? i.before_move && i.status !== 'bought' : i.status === f)) && (!q || (i.name + ' ' + (i.store || '') + ' ' + (i.note || '')).includes(q)));
    const order = S.rooms.map((r) => r.id), groups = {};
    shown.forEach((i) => (groups[i.room || 'general'] ||= []).push(i));
    const pos = (id) => { const k = order.indexOf(id); return k < 0 ? 999 : k; };
    const name = (id) => (S.rooms.find((r) => r.id === id) || {}).name || id;
    html = `
      <div class="sh-head"><div><h2>כל הרשימה</h2><div class="muted">${shown.length} מתוך ${all.length}</div></div><div class="hbtns"><button class="chipbtn" data-act="home">⌂ לבית</button><button class="chipbtn primary" data-act="add">+</button></div></div>
      <div class="filters">${[['all', 'הכול'], ['need', 'צריך'], ['chosen', 'בחרנו'], ['bought', 'קנינו'], ['before', 'לפני הכניסה']].map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-f="${k}">${t}<span class="n">${counts[k]}</span></button>`).join('')}</div>
      <input class="input search" id="q" placeholder="חיפוש" value="${esc(S.q)}">
      ${Object.keys(groups).sort((a, b) => pos(a) - pos(b)).map((rid) => `<h3 class="room"><button class="chipbtn" data-room="${esc(rid)}">${esc(name(rid))}</button><span class="muted">${groups[rid].length}</span></h3>${groups[rid].sort(byOrder).map((i) => itemHTML(i)).join('')}`).join('') || '<div class="empty">אין כאן כלום.</div>'}`;
  } else if (S.view === 'budget') {
    const free = total - T.paid - T.chosen - T.need;
    const by = (key, label) => {
      const g = {}; all.forEach((i) => (g[key(i)] ||= []).push(i));
      return Object.entries(g).map(([k, l]) => [k, totals(l)]).filter(([, t]) => t.paid + t.chosen + t.need > 0).sort((a, b) => (b[1].paid + b[1].chosen + b[1].need) - (a[1].paid + a[1].chosen + a[1].need))
        .map(([k, t]) => `<div class="brow"><span>${esc(label(k))}</span><span class="muted">${shekel(t.paid)}${t.chosen + t.need ? ' · עוד ' + shekel(t.chosen + t.need) : ''}</span>${barHTML(t, Math.max(1, t.paid + t.chosen + t.need))}</div>`).join('');
    };
    html = `
      <div class="sh-head"><div><h2>תקציב</h2><div class="muted">כל הסכומים כולל מע"מ</div></div><div class="hbtns"><button class="chipbtn" data-act="home">⌂ לבית</button></div></div>
      <label class="muted" for="totalIn">מסגרת לכל הבית</label>
      <div class="total-in"><input class="input" id="totalIn" inputmode="numeric" value="${total || ''}" placeholder="סכום בשקלים"><span>₪</span></div>
      ${barHTML(T, total)}
      <div class="kv">
        <div><span class="muted"><i style="background:var(--c-paid)"></i>שולם</span><b>${shekel(T.paid)}</b></div>
        <div><span class="muted"><i style="background:var(--c-chosen)"></i>בחרנו, עוד לא שולם</span><b>${shekel(T.chosen)}</b></div>
        <div><span class="muted"><i style="background:var(--c-need)"></i>צריך (הערכה)</span><b>${shekel(T.need)}</b></div>
        <div><span class="muted"><i style="background:var(--soft)"></i>${!total ? 'פנוי' : free >= 0 ? 'פנוי' : 'חריגה'}</span><b style="${total && free < 0 ? 'color:var(--danger)' : ''}">${total ? shekel(Math.abs(free)) : 'אין מסגרת'}</b></div>
      </div>
      ${T.unpriced ? `<div class="muted" style="margin-bottom:6px">${T.unpriced} פריטים עוד בלי מחיר, אז "מתוכנן" נמוך מהאמת.</div>` : ''}
      <div class="sec">לפי חדר</div>${by((i) => i.room || 'general', (k) => (S.rooms.find((r) => r.id === k) || {}).name || k) || '<div class="muted">עוד אין סכומים. מוסיפים מחיר לפריט, והוא יופיע כאן.</div>'}
      <div class="sec">לפי קטגוריה</div>${by((i) => i.category || '', (k) => CAT[k] || 'בלי קטגוריה') || '<div class="muted">עוד אין סכומים.</div>'}`;
  }
  body.innerHTML = html;
  body.scrollTop = top;
  const qIn = $('q'); if (qIn) qIn.oninput = () => { S.q = qIn.value; const p = qIn.selectionStart; renderSheet(true); const n = $('q'); n.focus(); n.setSelectionRange(p, p); };
  const qf = $('quick'); if (qf) qf.onsubmit = (e) => { e.preventDefault(); quickAdd($('quickIn').value, S.room); };
  const lIn = $('linkIn'); if (lIn) {
    lIn.onpaste = (e) => { const t = e.clipboardData?.getData('text'); if (t) { e.preventDefault(); saveLink(t); } };
    lIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); saveLink(lIn.value); } };
    lIn.onchange = () => saveLink(lIn.value, true);
  }
  const pIn = $('priceIn'); if (pIn) { pIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); pIn.blur(); } }; pIn.onchange = () => savePrice(pIn.value); }
  const tIn = $('totalIn'); if (tIn) tIn.onchange = () => { const v = Number(tIn.value.replace(/[^\d]/g, '')); if (v > 0) { S.settings.total_budget = v; LS.set('settings', S.settings); api('setSetting', { key: 'total_budget', value: v }).catch(() => toast('לא נשמר')); render(); } };
}
// the last changes, so each of us sees what the other did. The starter list landed in one go, right
// after the first item ever: anything from those first minutes is not news.
function recentHTML(all) {
  const t = (i) => Number(i.updated_at) || 0, t0 = Math.min(...all.map((i) => t(i) || Infinity));
  const rec = all.filter((i) => t(i) - t0 > 180e3 && Date.now() - t(i) < 14 * 86400e3).sort((a, b) => t(b) - t(a)).slice(0, 3);
  if (!rec.length) return '';
  const name = (id) => (S.rooms.find((r) => r.id === id) || {}).name || '';
  return `<div class="sec"><span>מה חדש</span></div>` + rec.map((i) => { const who = WHO[i.updated_by] || i.updated_by || i.added_by || ''; return `<button class="line-btn rec" data-open="${esc(i.id)}">
    <span><b>${esc(i.name)}</b><span class="muted"> · ${esc(name(i.room || 'general'))} · ${STATUS[i.status] || ''}</span></span>
    <span class="muted small">${esc(who)}${who ? ' · ' : ''}${ago(t(i))}</span></button>`; }).join('');
}
// stable order: as added (server row order; new ones at the end). Items never jump when their status changes.
function byOrder(a, b) {
  const pos = (i) => { const k = S.order.get(i.id); return k === undefined ? 1e6 + (S.newOrder.get(i.id) || 0) : k; };
  return pos(a) - pos(b);
}

function render() {
  const T = totals(view()), total = budgetTotal();
  $('pillPaid').textContent = '₪' + kShort(T.paid);
  $('pillTotal').textContent = total ? kShort(total) : '';
  document.querySelector('.pill .of').classList.toggle('hidden', !total);
  $('me').textContent = (WHO[S.who] || '?')[0];
  $('me').style.background = `var(--${S.who || 'ori'})`;
  if (S.h3) S.h3.setProgress(progress());
  if (!$('editor').classList.contains('hidden')) return;
  renderSheet();
  syncLabel();
}
function setSync(t) { $('sync').textContent = t; }
$('sync').onclick = () => { setSync('מעדכן…'); sync(); };
function syncLabel() {
  if (!S.lastSync) return;
  const s = Math.round((Date.now() - S.lastSync) / 1000);
  setSync(s < 15 ? 'מעודכן' : s < 90 ? `עודכן לפני ${s} שניות` : `עודכן לפני ${Math.round(s / 60)} דקות`);
}

// ---------- interactions ----------
$('shBody').onclick = (e) => {
  const t = e.target.closest('button, a, .item'); if (!t) return;
  const card = e.target.closest('.item'), item = card && view().find((x) => x.id === card.dataset.id);
  if (t.tagName === 'A') return;
  if (t.dataset.set && item) return setItemStatus(item, t.dataset.set);
  if (t.dataset.act === 'photo' && item) { S.photoFor = item.id; return $('quickPhoto').click(); }
  if (t.dataset.act === 'edit' && item) return openEditor(item);
  if (t.dataset.act === 'del' && item) return removeItem(item);
  if (t.dataset.act === 'unlink' && item) { const before = strip(item); change(item.id, { ...before, link: '' }, 'update'); return toast('הקישור הוסר', 'ביטול', () => change(item.id, before, 'update')); }
  if (t.classList.contains('item')) {                  // tap a card: open it in place (tap again to close)
    if (e.target.closest('.acts')) return;
    if (item && S.open === item.id && e.target.closest('.ph') && (item.photo || item._preview)) return showPhoto(item);
    S.open = S.open === item.id ? null : item.id; return renderSheet(true);
  }
  if (t.dataset.act === 'add') return openEditor(null, S.view === 'room' ? S.room : null);
  if (t.dataset.act === 'home') return goHome();
  if (t.dataset.act === 'eye') {
    const on = !S.h3.isEye();
    if (on) { S.h3.setEye(true); setSheet('room', 'peek'); } else { S.h3.enterRoom(S.room); setSheet('room', 'half'); }
    return;
  }
  if (t.dataset.open) {
    const i = view().find((x) => x.id === t.dataset.open); if (!i) return;
    openRoom(i.room || 'general'); S.open = i.id; renderSheet(true);
    document.querySelector('.item.open')?.scrollIntoView({ block: 'center' }); return;
  }
  if (t.dataset.go === 'budget') return setSheet('budget', 'full');
  if (t.dataset.list) { S.filter = t.dataset.list; S.q = ''; return setSheet('list', 'full'); }
  if (t.dataset.f) { S.filter = t.dataset.f; return renderSheet(true); }
  if (t.dataset.room) return openRoom(t.dataset.room);
};
function setItemStatus(i, st) {
  if (i.status === st) return;
  const before = strip(i), next = { ...before, status: st };
  if (st === 'bought' && !Number(i.paid) && Number(i.planned)) next.paid = Number(i.planned) * qty(i);   // paid defaults to the estimate
  change(i.id, next, 'update');
  if (navigator.vibrate) navigator.vibrate(12);
  toast(`${i.name}: ${STATUS[st]}`, 'ביטול', () => change(i.id, before, 'update'));
}
function savePrice(val) {                              // on blur or Enter; the card stays open
  const i = view().find((x) => x.id === S.open), v = num(val); if (!i) return;
  const key = i.status === 'bought' ? 'paid' : 'planned';
  if ((i[key] ?? '') === v) return;
  change(i.id, { ...strip(i), [key]: v }, 'update', {}, true); toast('נשמר');
}
function saveLink(text, quiet) {                       // quiet: saved on blur, so the redraw waits for the server and never swallows the tap that blurred
  const i = view().find((x) => x.id === S.open); if (!i) return;
  const link = cleanLink(text);
  if (!link) return String(text || '').trim() && toast('זה לא נראה כמו קישור');
  if (link === i.link) return;
  if (!quiet) document.activeElement?.blur?.();        // so the card redraws with the link
  change(i.id, { ...strip(i), link }, 'update', {}, quiet); toast('הקישור נשמר');
}
function showPhoto(i) {
  $('lightbox').querySelector('img').src = i._preview || `https://lh3.googleusercontent.com/d/${encodeURIComponent(i.photo)}=w1600`;
  $('lightbox').classList.remove('hidden');
}
$('lightbox').onclick = () => $('lightbox').classList.add('hidden');
function removeItem(i) {                               // a short grace period instead of a confirm dialog
  S.hidden.add(i.id); S.open = null; render();
  const t = setTimeout(() => { S.hidden.delete(i.id); change(i.id, {}, 'delete'); }, 5000);
  toast(`"${i.name}" נמחק`, 'ביטול', () => { clearTimeout(t); S.hidden.delete(i.id); render(); });
}
function quickAdd(name, room) {
  name = (name || '').trim(); if (!name) return;
  const link = cleanLink(name);
  if (link) name = name.replace(/(https?:\/\/|www\.)[^\s<>"']+/i, '').trim() || nameFromLink(link);   // "ספה https://…" keeps "ספה"
  const id = Math.random().toString(36).slice(2, 10);
  S.newOrder.set(id, Date.now());
  change(id, { id, name, room: room || 'general', category: guessCategory(name), status: 'need', qty: 1, link, added_by: WHO[S.who], updated_at: Date.now() }, 'add');
  if (link) { S.open = id; renderSheet(true); }
  const q = $('quickIn'); if (q) { q.value = ''; q.focus(); }
}
// a first guess at the category from the name; editable later
const GUESS = [[/מנור|תאור|נבר|ספוט|מאוורר|גוף/, 'lighting'], [/ספה|כורס|שולחן|כיסא|מיטה|מזרן|שיד|מזנון|ספרי|כוננ|פוף/, 'furniture'],
  [/וילון|שטיח|מצע|כרית|שמיכ|מגבת/, 'textile'], [/מקרר|תנור|כירי|מדיח|מזגן|מכונת|מייבש|טלוויז|מיקרו|קולט|שואב/, 'appliances'],
  [/סיר|מחבת|כלי|צלח|סכו|כוס|מטבח/, 'kitchen'], [/מראה|מקלח|אמבט|אסל|ברז/, 'bath'], [/ארון|מדף|מתלה|אחסון|קופס/, 'storage'],
  [/תמונ|עציץ|אגרטל|קישוט|שעון/, 'decor'], [/גינ|דשא|צמח|גריל|מרפסת|פרגול|השקי/, 'garden'], [/נגר|חשמלאי|צבע|התקנ|שיפוץ|פרקט|דלת/, 'works'],
  [/ראוטר|רשת|מצלמ|אזעק|wifi/i, 'tech']];
const guessCategory = (n) => (GUESS.find(([re]) => re.test(n)) || [null, ''])[1];
function change(id, item, op, extra = {}, quiet = false) {
  S.pending[id] = { op, item: op === 'delete' ? item : { ...item, updated_at: Date.now(), updated_by: WHO[S.who] }, ...extra };   // shown as news right away; the server stamps its own
  if (!quiet) render(); send(id);
}
$('homeBtn').onclick = goHome;
$('pill').onclick = () => setSheet('budget', 'full');
$('me').onclick = () => { if (confirm('להחליף משתמש בטלפון הזה?')) { LS.del('who'); S.who = ''; logout(''); } };
function togglePop(btn, pop) {                      // one popover at a time
  const open = $(pop).classList.contains('hidden');
  ['sunPop', 'layerPop'].forEach((p) => $(p).classList.add('hidden')); ['sunBtn', 'layerBtn'].forEach((b) => $(b).classList.remove('on'));
  if (open) { $(pop).classList.remove('hidden'); $(btn).classList.add('on'); }
}
$('sunBtn').onclick = () => togglePop('sunBtn', 'sunPop');
$('layerBtn').onclick = () => togglePop('layerBtn', 'layerPop');
$('layers').onclick = async (e) => {
  const b = e.target.closest('[data-layer]'); if (!b || !S.h3) return;
  const name = b.dataset.layer;
  document.querySelectorAll('#layers button').forEach((x) => x.classList.toggle('on', x === b));
  $('layerBtn').classList.toggle('active', name !== 'none');
  togglePop('layerBtn', 'layerPop');                  // chosen: close, so the plan is visible
  if (name === 'none' || name === 'lights') return S.h3.setLayer(name);
  let L = LS.get('layer1.' + name, null);              // plan sheets come from the server once, then stay on the phone
  if (!L) {
    toast('טוען את השכבה…');
    try { const j = await api('getLayer', { name }); if (!j.success) throw new Error(j.message); L = { png: j.png, meta: j.meta }; LS.set('layer1.' + name, L); }
    catch { return toast('השכבה לא נטענה. מנסים שוב בעוד רגע'); }
  }
  S.h3.setLayer(name, L.png, L.meta);
};
function setHour(h) { $('t').value = h; $('tlabel').textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`; S.h3 && S.h3.setTime(h); }
$('t').oninput = () => setHour(+$('t').value);
document.querySelectorAll('#season button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('#season button').forEach((x) => x.classList.toggle('on', x === b)); S.h3 && S.h3.setSeason(+b.dataset.d);
});

// sheet drag: snap to peek / half / full
(() => {
  const g = $('grab'), sh = $('sheet');
  let y0 = 0, h0 = 0, drag = false;
  g.addEventListener('pointerdown', (e) => { drag = true; y0 = e.clientY; h0 = sh.offsetHeight; sh.classList.add('dragging'); g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointermove', (e) => { if (drag) sh.style.setProperty('--sheet-h', Math.max(120, Math.min(innerHeight * .92, h0 + y0 - e.clientY)) + 'px'); });
  const end = (e) => {
    if (!drag) return; drag = false; sh.classList.remove('dragging');
    const h = sh.offsetHeight, moved = Math.abs(e.clientY - y0) > 6, sz = SIZES();
    if (!moved) return setSheet(S.view, S.size === 'peek' ? 'half' : 'peek');           // a tap toggles
    const near = Object.entries(sz).sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0][0];
    if (near === 'peek' && (S.view === 'list' || S.view === 'budget')) return goHome();
    setSheet(S.view, near);
  };
  g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
})();
addEventListener('resize', () => { $('sheet').style.setProperty('--sheet-h', SIZES()[S.size] + 'px'); layout(); });

// ---------- editor ----------
function fillSelects() {
  $('fRoom').innerHTML = S.rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  $('fCat').innerHTML = '<option value="">בלי קטגוריה</option>' + CATS.map(([k, t]) => `<option value="${k}">${t}</option>`).join('');
}
function setStatus(s) { S.status = s; document.querySelectorAll('#fStatus button').forEach((b) => b.classList.toggle('on', b.dataset.s === s)); $('paidWrap').classList.toggle('hidden', s !== 'bought'); }
function openEditor(item = null, room = null) {
  S.editing = item; S.photo = null; fillSelects();
  $('edTitle').textContent = item ? 'עריכה' : 'מה להוסיף?';
  $('fName').value = item?.name || ''; $('fRoom').value = item?.room || room || S.lastRoom || 'general';
  $('fCat').value = item?.category || ''; $('fPlanned').value = item?.planned ?? ''; $('fPaid').value = item?.paid ?? '';
  $('fQty').value = item?.qty ?? 1; $('fBefore').checked = !!item?.before_move;
  $('fStore').value = item?.store || ''; $('fLink').value = item?.link || ''; $('fNote').value = item?.note || '';
  $('fPhotoPrev').innerHTML = item ? photoHTML(item) : '📷';
  setStatus(item?.status || 'need');
  $('del').classList.toggle('hidden', !item);
  $('more').open = !!(item && (item.store || item.note || qty(item) > 1 || item.before_move || item.category));
  $('scrim').classList.remove('hidden'); $('editor').classList.remove('hidden');
  if (!item) setTimeout(() => $('fName').focus(), 60);
}
function closeEditor() { $('scrim').classList.add('hidden'); $('editor').classList.add('hidden'); render(); }
document.querySelectorAll('#fStatus button').forEach((b) => b.onclick = () => setStatus(b.dataset.s));
$('close').onclick = closeEditor; $('scrim').onclick = closeEditor;
$('pickPhoto').onclick = () => $('fPhoto').click();
$('fName').onpaste = (e) => {
  const link = cleanLink(e.clipboardData?.getData('text')); if (!link) return;
  e.preventDefault(); $('fLink').value = link; if (!$('fName').value.trim()) $('fName').value = nameFromLink(link);
};
$('fPhoto').onchange = async () => {
  const f = $('fPhoto').files[0]; if (!f) return;
  try { S.photo = await shrink(f); $('fPhotoPrev').innerHTML = `<img src="${S.photo}" alt="">`; } catch { toast('לא הצלחנו לקרוא את התמונה'); }
  $('fPhoto').value = '';
};
$('quickPhoto').onchange = async () => {
  const f = $('quickPhoto').files[0], i = view().find((x) => x.id === S.photoFor); $('quickPhoto').value = '';
  if (!f || !i) return;
  try { const data = await shrink(f); change(i.id, { ...strip(i), photo: '' }, 'update', { photoData: data, preview: data }); toast('התמונה עולה…'); }
  catch { toast('לא הצלחנו לקרוא את התמונה'); }
};
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, CONFIG.PHOTO_MAX_PX / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', .82);
}
const num = (v) => { const n = Number(String(v).replace(/[^\d.]/g, '')); return v === '' || isNaN(n) ? '' : n; };
$('editor').onsubmit = (e) => {
  e.preventDefault();
  const name = $('fName').value.trim(); if (!name) { $('fName').focus(); return; }
  const isNew = !S.editing, id = isNew ? Math.random().toString(36).slice(2, 10) : S.editing.id;
  const item = {
    ...(S.editing ? strip(S.editing) : {}), id, name, room: $('fRoom').value, category: $('fCat').value || (S.editing ? '' : guessCategory(name)), status: S.status,
    planned: num($('fPlanned').value), paid: S.status === 'bought' ? num($('fPaid').value) : (S.editing?.paid ?? ''),
    qty: num($('fQty').value) || 1, before_move: $('fBefore').checked,
    store: $('fStore').value.trim(), link: cleanLink($('fLink').value), note: $('fNote').value.trim(),
    added_by: S.editing ? S.editing.added_by : WHO[S.who], updated_at: Date.now(),
  };
  if (S.photo) item.photo = '';
  if (isNew) S.newOrder.set(id, Date.now());
  S.lastRoom = item.room;
  closeEditor();
  change(id, item, isNew ? 'add' : 'update', S.photo ? { photoData: S.photo, preview: S.photo } : {});
};
$('del').onclick = () => {
  if (!S.editing || !confirm(`למחוק את "${S.editing.name}"?`)) return;
  const id = S.editing.id; closeEditor(); change(id, {}, 'delete');
};

// ---------- misc ----------
let toastT;
function toast(t, actLabel, act) {
  const el = $('toast'); el.innerHTML = ''; el.append(document.createTextNode(t));
  if (actLabel) { const b = document.createElement('button'); b.textContent = actLabel; b.onclick = () => { el.classList.add('hidden'); act(); }; el.append(b); }
  el.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), actLabel ? 5000 : 2800);
}

let timer;
function start() {
  $('gate').classList.add('hidden'); $('app').classList.remove('hidden');
  setSheet('home', 'peek', null);
  loadHouse(); sync();
  clearInterval(timer);
  timer = setInterval(() => { if (document.visibilityState === 'visible') sync(); else syncLabel(); }, CONFIG.POLL_MS);
  setInterval(syncLabel, 10000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
window.__hp = S;                                       // for testing in the console

if (S.code && S.who) start(); else showGate();
