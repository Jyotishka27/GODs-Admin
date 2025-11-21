// scripts/admin.js
// Full admin script — replace your existing file with this.
// - Robust time parsing & slotId derivation (outputs "8:00 PM – 9:00 PM")
// - Court labels use SITE_CFG.courts[].label when present, otherwise explicit overrides below

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  writeBatch,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js";

/* ---------- CONFIG ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyAXDvwYufUn5C_E_IYAdm094gSmyHOg46s",
  authDomain: "gods-turf.firebaseapp.com",
  projectId: "gods-turf",
  storageBucket: "gods-turf.appspot.com",
  messagingSenderId: "46992157689",
  appId: "1:46992157689:web:b547bc847c7a0331bb2b28"
};
const SITE_JSON = "/data/site.json";

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
let functions = null;
try { functions = getFunctions(app); } catch(e){ functions = null; console.warn("Functions not available", e); }

/* ---------- DOM helpers ---------- */
const $id = id => document.getElementById(id);
function el(tag, cls=''){ const e = document.createElement(tag); if(cls) e.className = cls; return e; }

/* ---------- UI elements ---------- */
const filterDate = $id("filterDate");
const filterCourt = $id("filterCourt");
const filterStatus = $id("filterStatus");
const exportCsvBtn = $id("exportCsv");
const clearAllBtn = $id("clearAll");
const refreshBtn = $id("refreshBtn");
const rowsTbody = $id("rows");
const wlRowsTbody = $id("wlRows");
const adminNotifs = $id("adminNotifs");
const bizNameEl = $id("bizName");

/* ---------- Site config runtime ---------- */
let SITE_CFG = null;
async function loadSiteCfg(){
  try{
    const r = await fetch(SITE_JSON, { cache: "no-store" });
    SITE_CFG = await r.json();
    populateCourtsDropdown();
  }catch(e){
    console.warn("Failed to load site.json", e);
    SITE_CFG = null;
  }
}
function populateCourtsDropdown(){
  if(!filterCourt || !SITE_CFG || !Array.isArray(SITE_CFG.courts)) return;
  filterCourt.innerHTML = `<option value="">All courts</option>`;
  SITE_CFG.courts.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.label || c.id;
    filterCourt.appendChild(opt);
  });
}

/* ---------- util ---------- */
function fmtDateISO(d = new Date()){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function escapeHtml(s){ if(s===undefined||s===null) return ""; return String(s).replace(/[&<>"]/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function toast(msg, err=false){
  if(adminNotifs){
    const p = el("div","p-1 text-sm");
    p.textContent = msg;
    p.style.color = err ? "#991b1b" : "#064e3b";
    adminNotifs.prepend(p);
    setTimeout(()=> p.remove(), 8000);
  } else {
    console.log(msg);
  }
}

/* ---------- Time parsing/format helpers (robust) ---------- */

function parseToDate(val){
  if(val === undefined || val === null || val === "") return null;
  try {
    if (typeof val === 'object' && typeof val.toDate === 'function') return val.toDate();
    if (typeof val === 'object' && (val.seconds !== undefined)) {
      const ms = (Number(val.seconds) * 1000) + (Number(val.nanoseconds || 0) / 1e6);
      return new Date(ms);
    }
    if (typeof val === 'number') {
      if (String(Math.trunc(val)).length <= 10) return new Date(val * 1000);
      return new Date(val);
    }
    if (typeof val === 'string') {
      const d = new Date(val);
      if (!Number.isNaN(d.getTime())) return d;
    }
    if (val instanceof Date) return val;
  } catch(e){}
  return null;
}

function formatDateTo12Hour(d){
  if(!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function normalizeTimeToken(token){
  if(!token) return null;
  token = String(token).trim();
  token = token.replace(/\s*(am|pm|AM|PM)\s*/g, (m,p)=> p.toUpperCase());
  if(/^\d{1,2}:\d{2}(AM|PM)?$/i.test(token)) return token;
  if(/^\d{4}$/.test(token)) return `${token.slice(0,2)}:${token.slice(2,4)}`;
  if(/^\d{3}$/.test(token)) return `${token.slice(0,1)}:${token.slice(1,3)}`;
  if(/^\d{1,2}$/.test(token)) return `${String(token).padStart(2,'0')}:00`;
  let m = token.match(/^(\d{1,2})(AM|PM)$/i);
  if(m) return `${String(m[1]).padStart(2,'0')}${m[2].toUpperCase()}`;
  if(token.includes(":")){
    const parts = token.split(":").map(s=>s.replace(/\D/g,''));
    if(parts.length>=2) return `${parts[0].padStart(2,'0')}:${parts[1].padStart(2,'0')}`;
  }
  return null;
}

function parseRangeFromLabel(label){
  if(!label || typeof label !== 'string') return null;
  const sepRegex = /(?:\s*(?:-|–|—|to|–|—)\s*)/i;
  const parts = label.split(sepRegex);
  if(parts.length < 2) return null;
  const left = parts[0].trim();
  const right = parts[1].trim();
  const ln = normalizeTimeToken(left) || left;
  const rn = normalizeTimeToken(right) || right;
  const sd = parseToDate(`2000-01-01T${ln}`) || parseToDate(left);
  const ed = parseToDate(`2000-01-01T${rn}`) || parseToDate(right);
  if(sd && ed) return `${formatDateTo12Hour(sd)} – ${formatDateTo12Hour(ed)}`;
  if(/[ap]m/i.test(left) && /[ap]m/i.test(right)){
    const s = new Date(`2000-01-01 ${left}`);
    const e = new Date(`2000-01-01 ${right}`);
    if(!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) return `${formatDateTo12Hour(s)} – ${formatDateTo12Hour(e)}`;
  }
  return null;
}

function deriveRangeFromSlotText(text){
  if(!text) return null;
  const s = String(text).trim();
  if(/[ap]m|:|\bto\b/i.test(s)){
    const pl = parseRangeFromLabel(s);
    if(pl) return pl;
  }
  const tokens = s.split(/[_\s|/]+/).filter(Boolean);
  for(const t of tokens){
    if(t.includes("-")){
      const [leftRaw, rightRaw] = t.split("-").map(x=>x.trim());
      const ln = normalizeTimeToken(leftRaw);
      const rn = normalizeTimeToken(rightRaw);
      if(ln && rn){
        const sd = parseToDate(`2000-01-01T${ln}`);
        const ed = parseToDate(`2000-01-01T${rn}`);
        if(sd && ed) return `${formatDateTo12Hour(sd)} – ${formatDateTo12Hour(ed)}`;
        const sd2 = parseToDate(leftRaw) || parseToDate(`2000-01-01 ${leftRaw}`);
        const ed2 = parseToDate(rightRaw) || parseToDate(`2000-01-01 ${rightRaw}`);
        if(sd2 && ed2) return `${formatDateTo12Hour(sd2)} – ${formatDateTo12Hour(ed2)}`;
      }
    }
  }
  const timeRegex = /(\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm)?|\d{3,4})/g;
  const found = [...s.matchAll(timeRegex)].map(m => m[0].trim());
  if(found.length >= 2){
    const l = normalizeTimeToken(found[0]);
    const r = normalizeTimeToken(found[1]);
    if(l && r){
      const sd = parseToDate(`2000-01-01T${l}`);
      const ed = parseToDate(`2000-01-01T${r}`);
      if(sd && ed) return `${formatDateTo12Hour(sd)} – ${formatDateTo12Hour(ed)}`;
    }
  }
  const digitsRegex = /(\d{3,4})/g;
  const digs = [...s.matchAll(digitsRegex)].map(m => m[0]);
  if(digs.length >= 2){
    const l = normalizeTimeToken(digs[0]);
    const r = normalizeTimeToken(digs[1]);
    if(l && r){
      const sd = parseToDate(`2000-01-01T${l}`);
      const ed = parseToDate(`2000-01-01T${r}`);
      if(sd && ed) return `${formatDateTo12Hour(sd)} – ${formatDateTo12Hour(ed)}`;
    }
  }
  return null;
}

function displayRangeForBooking(b){
  const startCandidates = ['startISO','start','startAt','start_time','startTimestamp','startAtISO'];
  const endCandidates = ['endISO','end','endAt','end_time','endTimestamp','endAtISO'];
  let sd = null, ed = null;
  for(const k of startCandidates){
    if(b[k] !== undefined && b[k] !== null){
      const p = parseToDate(b[k]);
      if(p){ sd = p; break; }
    }
  }
  for(const k of endCandidates){
    if(b[k] !== undefined && b[k] !== null){
      const p = parseToDate(b[k]);
      if(p){ ed = p; break; }
    }
  }
  if(sd && ed) return `${formatDateTo12Hour(sd)} – ${formatDateTo12Hour(ed)}`;
  if(sd && !ed) return `${formatDateTo12Hour(sd)}`;
  if(!sd && ed) return `${formatDateTo12Hour(ed)}`;
  const slotLabel = b.slotLabel || b.slot_label || b.label || '';
  if(slotLabel){
    const p = deriveRangeFromSlotText(slotLabel);
    if(p) return p;
  }
  const slotFields = [b.slotId, b.slot, b.slot_id, b.slotIdString, b.slotLabel];
  for(const sf of slotFields){
    if(!sf) continue;
    const p = deriveRangeFromSlotText(sf);
    if(p) return p;
  }
  console.warn("Time parse failed for booking:", {
    id: b._id,
    startISO: b.startISO, start: b.start, startAt: b.startAt,
    endISO: b.endISO, end: b.end, slotId: b.slotId, slot: b.slot, slotLabel: slotLabel
  });
  return "—";
}

/* ---------- Court label overrides (explicit mapping based on your input) ---------- */
const COURT_LABEL_OVERRIDES = {
  "5A": "Half Ground Football",
  "5A-B": "Half Ground Football",
  "7A": "Full Ground Football",
  "CRK": "Cricket"
};

/* ---------- Court label helper ---------- */
function getCourtLabel(courtId){
  if(!courtId && courtId !== 0) return "";
  const id = String(courtId).trim();

  // 1) prefer site config label
  if(SITE_CFG && Array.isArray(SITE_CFG.courts)){
    const found = SITE_CFG.courts.find(c => String(c.id) === id || String(c.id).toLowerCase() === id.toLowerCase());
    if(found){
      if(found.label) return String(found.label);
      if(found.name) return String(found.name);
    }
  }

  // 2) explicit overrides from the mapping you provided
  if(COURT_LABEL_OVERRIDES[id]) return COURT_LABEL_OVERRIDES[id];

  // 3) fallback heuristics (safe)
  const low = id.toLowerCase();
  if(low.includes("cricket") || low.includes("crk")) return "Full Ground (Cricket)";
  if(low.includes("full")) return "Full Ground";
  if(/^\d+[ab]$/i.test(id)) return "Half Ground Football";
  if(/^\d+$/.test(id)) return "Full Ground Football";
  return id;
}

/* ---------- derive court base price (optional) ---------- */
function getCourtAmount(courtId){
  if(SITE_CFG && Array.isArray(SITE_CFG.courts)){
    const c = SITE_CFG.courts.find(x => String(x.id) === String(courtId));
    if(c) return Number(c.basePrice ?? c.price ?? c.amount ?? 0) || 0;
  }
  // fallback defaults (optional — update if needed)
  const overrides = { "5A":1500, "5A-B":1500, "7A":2500, "CRK":2500 };
  return Number(overrides[String(courtId)] || 0);
}

/* ---------- Firestore reads ---------- */
async function fetchBookings({ date, court, status } = {}) {
  try {
    let q = collection(db, "bookings");
    const filters = [];
    if (date) filters.push(where("date", "==", date));
    if (court) filters.push(where("court", "==", court));
    if (status) filters.push(where("status", "==", status));
    if (filters.length) q = query(...([collection(db,"bookings")].concat(filters)));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(d => {
      const data = d.data(); data._id = d.id;
      items.push(data);
    });
    items.sort((a,b)=> (a.slotId||'').localeCompare(b.slotId||'') || (a.createdAt?.seconds||0) - (b.createdAt?.seconds||0));
    return items;
  } catch (err) {
    console.error("fetchBookings err", err);
    toast("Failed to fetch bookings", true);
    return [];
  }
}

async function fetchWishlists({ date } = {}) {
  try {
    let q = collection(db, "wishlists");
    if (date) q = query(collection(db,"wishlists"), where("date", "==", date));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(d => { const dt = d.data(); dt._id = d.id; items.push(dt); });
    items.sort((a,b)=> (a.createdAt?.seconds||0) - (b.createdAt?.seconds||0));
    return items;
  } catch (err) {
    console.error("fetchWishlists err", err);
    toast("Failed to fetch wishlists", true);
    return [];
  }
}

/* ---------- Renderers ---------- */
function renderBookingsTable(bookings) {
  if(!rowsTbody) return;
  rowsTbody.innerHTML = "";
  if(!bookings.length){
    const tr = el("tr"); tr.innerHTML = `<td class="px-3 py-2 text-sm text-gray-500" colspan="9">No bookings</td>`;
    rowsTbody.appendChild(tr);
    return;
  }

  bookings.forEach(b => {
    const tr = el("tr","border-b");
    const statusBadge = (b.status === 'confirmed')
      ? `<span class="px-2 py-1 rounded-full text-xs bg-emerald-100 text-emerald-700">Confirmed</span>`
      : `<span class="px-2 py-1 rounded-full text-xs bg-amber-100 text-amber-700">${escapeHtml(b.status || 'pending')}</span>`;

    let actionButtons = '';
    if ((b.status || 'pending') === 'pending') {
      actionButtons += `<button data-confirm="${escapeHtml(b._id)}" class="px-2 py-1 rounded border text-green-700 text-sm">Confirm</button>`;
      actionButtons += ` <button data-cancel="${escapeHtml(b._id)}" class="px-2 py-1 rounded border text-red-600 text-sm">Cancel</button>`;
    } else if ((b.status || '') === 'confirmed') {
      actionButtons += `<button data-cancel="${escapeHtml(b._id)}" class="px-2 py-1 rounded border text-red-600 text-sm">Cancel</button>`;
    } else if ((b.status || '') === 'cancelled') {
      actionButtons += `<button data-delete="${escapeHtml(b._id)}" class="px-2 py-1 rounded border text-red-600 text-sm">Delete</button>`;
    } else {
      actionButtons += `<button data-delete="${escapeHtml(b._id)}" class="px-2 py-1 rounded border text-red-600 text-sm">Delete</button>`;
    }

    const displayedRange = displayRangeForBooking(b);
    const displayedAmount = Number(b.amount || b.price || getCourtAmount(b.court) || 0);
    const courtLabel = getCourtLabel(b.court || b.courtId || b.court_id || '');

    tr.innerHTML = `
      <td class="px-3 py-2 font-mono text-xs">${escapeHtml(b._id)}</td>
      <td class="px-3 py-2">${statusBadge}</td>
      <td class="px-3 py-2">${escapeHtml(courtLabel)}</td>
      <td class="px-3 py-2">${escapeHtml(b.date || b.dateISO || '')}</td>
      <td class="px-3 py-2">${escapeHtml(displayedRange || "—")}</td>
      <td class="px-3 py-2">${escapeHtml(b.userName || b.name || '')}<br><span class="text-gray-500 text-xs">${escapeHtml(b.phone || '')}</span></td>
      <td class="px-3 py-2">₹${displayedAmount.toLocaleString('en-IN')}</td>
      <td class="px-3 py-2">${escapeHtml(b.notes || '')}</td>
      <td class="px-3 py-2 space-x-2">
        ${actionButtons}
        <button data-wa="${escapeHtml(b._id)}" class="px-2 py-1 rounded border text-sm">WhatsApp</button>
      </td>
    `;
    rowsTbody.appendChild(tr);
  });

  // bind actions (same as before)...
  rowsTbody.querySelectorAll("button[data-delete]").forEach(btn=>{
    btn.addEventListener("click", async ()=> {
      const id = btn.dataset.delete;
      if(!confirm(`Delete booking ${id}?`)) return;
      await deleteBooking(id);
      await refreshCurrentView();
    });
  });
  rowsTbody.querySelectorAll("button[data-cancel]").forEach(btn=>{
    btn.addEventListener("click", async ()=> {
      const id = btn.dataset.cancel;
      if(!confirm(`Mark booking ${id} as cancelled?`)) return;
      await cancelBooking(id);
      await refreshCurrentView();
    });
  });
  rowsTbody.querySelectorAll("button[data-confirm]").forEach(btn=>{
    btn.addEventListener("click", async ()=> {
      const id = btn.dataset.confirm;
      if(!confirm(`Confirm booking ${id}?`)) return;
      await confirmBooking(id);
      await refreshCurrentView();
    });
  });

  // WhatsApp button (uses courtLabel)
  rowsTbody.querySelectorAll("button[data-wa]").forEach(btn=>{
    btn.addEventListener("click", ()=> {
      const id = btn.dataset.wa;
      const b = bookings.find(x => x._id === id);
      if(!b || !b.phone){ toast("Phone not available", true); return; }
      const phonePlain = String(b.phone).replace(/^\+/, '');

      const sourceName = (SITE_CFG && SITE_CFG.name) ? SITE_CFG.name : (bizNameEl ? bizNameEl.textContent.trim() : "GODs Turf");
      const rangeStr = displayRangeForBooking(b);
      const amountStr = Number(b.amount || b.price || getCourtAmount(b.court) || 0).toLocaleString('en-IN');
      const courtLabel = getCourtLabel(b.court || b.courtId || b.court_id || '');

      const msg = `Hi! This is ${sourceName}.\nWe are sending this message from ${sourceName} (automated notification).\n\nBooking details:\nBooking ID: ${b._id}\nDate: ${b.date || ''}\nTime: ${rangeStr}\nCourt: ${courtLabel}\nStatus: ${b.status || 'pending'}\nAmount: ₹${amountStr}\n\nIf you have any questions, reply to this message. Thank you!`;

      window.open(`https://wa.me/${phonePlain}?text=${encodeURIComponent(msg)}`, '_blank');
    });
  });
}

/* ---------- Waitlist renderer (uses getCourtLabel) ---------- */
function renderWaitlistTable(wls) {
  if(!wlRowsTbody) return;
  wlRowsTbody.innerHTML = "";
  if(!wls.length){
    const tr = el("tr"); tr.innerHTML = `<td class="px-3 py-2 text-sm text-gray-500" colspan="6">No waitlist entries</td>`;
    wlRowsTbody.appendChild(tr);
    return;
  }

  wls.forEach(w => {
    const tr = el("tr","border-b");
    const courtLabel = getCourtLabel(w.court || w.courtId || w.court_id || '');
    tr.innerHTML = `
      <td class="px-3 py-2 font-mono text-xs">${escapeHtml(w._id)}</td>
      <td class="px-3 py-2">${escapeHtml(courtLabel)}</td>
      <td class="px-3 py-2">${escapeHtml(w.date || '')}</td>
      <td class="px-3 py-2">${escapeHtml(displayRangeForBooking(w))}</td>
      <td class="px-3 py-2">${escapeHtml(w.userName || w.name || '')}<br><span class="text-gray-500 text-xs">${escapeHtml(w.phone||'')}</span></td>
      <td class="px-3 py-2 space-x-2">
        <button data-wl-del="${escapeHtml(w._id)}" class="px-2 py-1 rounded border text-red-600 text-sm">Delete</button>
        <button data-wl-convert="${escapeHtml(w._id)}" class="px-2 py-1 rounded border text-sm">Convert → Booking (Pending)</button>
        <button data-wl-wa="${escapeHtml(w._id)}" class="px-2 py-1 rounded border text-sm">WhatsApp</button>
      </td>
    `;
    wlRowsTbody.appendChild(tr);
  });

  // bind waitlist actions...
  wlRowsTbody.querySelectorAll("button[data-wl-del]").forEach(btn=>{
    btn.addEventListener("click", async ()=> {
      const id = btn.dataset.wlDel;
      if(!confirm(`Delete waitlist ${id}?`)) return;
      await deleteWishlist(id);
      await refreshCurrentView();
    });
  });
  wlRowsTbody.querySelectorAll("button[data-wl-convert]").forEach(btn=>{
    btn.addEventListener("click", async ()=> {
      const id = btn.dataset.wlConvert;
      if(!confirm(`Convert wishlist ${id} to booking (creates a PENDING booking)?`)) return;
      await convertWishlistToBooking(id);
      await refreshCurrentView();
    });
  });
  wlRowsTbody.querySelectorAll("button[data-wl-wa]").forEach(btn=>{
    btn.addEventListener("click", ()=> {
      const id = btn.dataset.wlWa;
      const w = wls.find(x => x._id === id);
      if(!w || !w.phone){ toast("Phone not available", true); return; }
      const phonePlain = String(w.phone).replace(/^\+/, '');
      const courtLabel = getCourtLabel(w.court || w.courtId || w.court_id || '');
      const msg = `Waitlist: ${w.slotLabel || w.slotId}\nDate: ${w.date}\nCourt: ${courtLabel}`;
      window.open(`https://wa.me/${phonePlain}?text=${encodeURIComponent(msg)}`, '_blank');
    });
  });
}

/* ---------- Actions (same as before) ---------- */
async function deleteBooking(id){
  try {
    await deleteDoc(doc(db, "bookings", id));
    toast(`Deleted booking ${id}`);
  } catch (err){
    console.error("deleteBooking err", err);
    toast("Delete failed", true);
  }
}
async function cancelBooking(id){
  try{
    const ref = doc(db, "bookings", id);
    await updateDoc(ref, { status: "cancelled", cancelledAt: serverTimestamp() });
    toast(`Cancelled booking ${id}`);
  }catch(err){ console.error(err); toast("Cancel failed", true); }
}
async function confirmBooking(id){
  try{
    const ref = doc(db, "bookings", id);
    await updateDoc(ref, { status: "confirmed", confirmedAt: serverTimestamp() });
    toast(`Confirmed booking ${id}`);
  }catch(err){ console.error(err); toast("Confirm failed", true); }
}
async function deleteAllBookings(dateOnly){
  if(!confirm("Delete ALL bookings? This is destructive. Proceed?")) return;
  try {
    let q = collection(db, "bookings");
    if (dateOnly) q = query(collection(db,"bookings"), where("date", "==", dateOnly));
    const snap = await getDocs(q);
    const batch = writeBatch(db);
    snap.forEach(s => batch.delete(s.ref));
    await batch.commit();
    toast(`Deleted ${snap.size} bookings`);
  } catch (err) { console.error(err); toast("Delete all failed", true); }
}
async function exportBookingsCsv(date){
  try {
    let q = collection(db, "bookings");
    if (date) q = query(collection(db,"bookings"), where("date","==", date));
    const snap = await getDocs(q);
    const rows = [];
    snap.forEach(d => {
      const data = d.data();
      rows.push({
        id: d.id,
        status: data.status || '',
        court: getCourtLabel(data.court || data.courtId || ''),
        slotId: data.slotId || '',
        slotLabel: data.slotLabel || '',
        date: data.date || '',
        timeRange: (function(){ try { return displayRangeForBooking(data); } catch(e){ return ''; } })(),
        startISO: data.startISO || '',
        endISO: data.endISO || '',
        name: data.userName || data.name || '',
        phone: data.phone || '',
        amount: data.amount || data.price || '',
        notes: data.notes || ''
      });
    });
    const csvHead = Object.keys(rows[0]||{ id:1 }).join(",");
    const csvRows = rows.map(r => Object.values(r).map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(","));
    const csv = [csvHead].concat(csvRows).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = el("a"); a.href = url; a.download = `bookings-${date||'all'}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast("CSV exported");
  } catch (err) { console.error(err); toast("Export failed", true); }
}

/* ---------- Convert wishlist -> booking (same as before) ---------- */
async function convertWishlistToBooking(wishlistId){
  if(functions){
    try{
      const fn = httpsCallable(functions, "convertWishlistToBooking");
      const res = await fn({ wishlistId });
      toast("Converted wishlist → booking: " + (res.data?.bookingId || "ok"));
      return;
    }catch(fnErr){
      console.warn("Callable convert function failed:", fnErr);
      toast("Cloud function unavailable — trying client-side conversion", true);
    }
  }
  try {
    const wlRef = doc(db, "wishlists", wishlistId);
    await runTransaction(db, async (t)=>{
      const wlSnap = await t.get(wlRef);
      if(!wlSnap.exists()) throw new Error("Wishlist not found");
      const wl = wlSnap.data();
      const conflictQ = query(collection(db,"bookings"), where("date","==", wl.date), where("slotId","==", wl.slotId));
      const conflictSnap = await getDocs(conflictQ);
      let conflictExists = false;
      conflictSnap.forEach(d => {
        const dd = d.data();
        if(dd.status !== 'cancelled') conflictExists = true;
      });
      if(conflictExists) throw new Error("Slot already booked");
      const derivedAmount = (wl.amount && Number(wl.amount)) ? Number(wl.amount) : getCourtAmount(wl.court);
      const bookingRef = doc(collection(db,"bookings"));
      t.set(bookingRef, {
        userName: wl.userName || wl.name || "Converted",
        phone: wl.phone || null,
        notes: wl.notes || null,
        coupon: wl.coupon || null,
        court: wl.court,
        slotId: wl.slotId,
        slotLabel: wl.slotLabel,
        date: wl.date,
        amount: derivedAmount,
        status: "pending",
        createdAt: serverTimestamp(),
        convertedFromWishlist: wishlistId
      });
      t.update(wlRef, { status: "converted", convertedToBookingId: bookingRef.id, convertedAt: serverTimestamp() });
    });
    toast("Converted wishlist to booking (pending)");
  } catch (err) {
    console.error("convert fallback error", err);
    toast("Conversion failed: " + (err.message || err), true);
  }
}

async function deleteWishlist(id){
  try {
    await deleteDoc(doc(db, "wishlists", id));
    toast("Deleted waitlist item");
  } catch (err) { console.error(err); toast("Delete waitlist failed", true); }
}

/* ---------- Refresh & wiring ---------- */
async function refreshCurrentView(){
  const date = filterDate?.value || fmtDateISO();
  const court = filterCourt?.value || "";
  const status = filterStatus?.value || "";
  const bookings = await fetchBookings({ date, court: court || undefined, status: status || undefined });
  renderBookingsTable(bookings);
  const wishlist = await fetchWishlists({ date });
  renderWaitlistTable(wishlist);
}

/* ---------- Event wiring ---------- */
function wireUI(){
  if(filterDate && !filterDate.value) filterDate.value = fmtDateISO();
  if(filterDate) filterDate.addEventListener("change", refreshCurrentView);
  if(filterCourt) filterCourt.addEventListener("change", refreshCurrentView);
  if(filterStatus) filterStatus.addEventListener("change", refreshCurrentView);
  exportCsvBtn?.addEventListener("click", ()=> exportBookingsCsv(filterDate?.value || undefined));
  clearAllBtn?.addEventListener("click", ()=> {
    if(!confirm("Delete ALL bookings (for selected date if date chosen)? This is irreversible.")) return;
    deleteAllBookings(filterDate?.value || undefined).then(()=> refreshCurrentView());
  });
  refreshBtn?.addEventListener("click", refreshCurrentView);

  // Tabs
  document.getElementById("tabBookings")?.addEventListener("click", ()=> {
    document.getElementById("bookingsSection").classList.remove("hidden");
    document.getElementById("waitlistSection").classList.add("hidden");
    document.getElementById("notificationsSection").classList.add("hidden");
    document.getElementById("tabBookings").classList.add("bg-emerald-600","text-white");
    document.getElementById("tabWaitlist").classList.remove("bg-emerald-600","text-white");
    document.getElementById("tabNotifications").classList.remove("bg-emerald-600","text-white");
  });
  document.getElementById("tabWaitlist")?.addEventListener("click", ()=> {
    document.getElementById("bookingsSection").classList.add("hidden");
    document.getElementById("waitlistSection").classList.remove("hidden");
    document.getElementById("notificationsSection").classList.add("hidden");
    document.getElementById("tabBookings").classList.remove("bg-emerald-600","text-white");
    document.getElementById("tabWaitlist").classList.add("bg-emerald-600","text-white");
    document.getElementById("tabNotifications").classList.remove("bg-emerald-600","text-white");
  });
  document.getElementById("tabNotifications")?.addEventListener("click", ()=> {
    document.getElementById("bookingsSection").classList.add("hidden");
    document.getElementById("waitlistSection").classList.add("hidden");
    document.getElementById("notificationsSection").classList.remove("hidden");
    document.getElementById("tabBookings").classList.remove("bg-emerald-600","text-white");
    document.getElementById("tabWaitlist").classList.remove("bg-emerald-600","text-white");
    document.getElementById("tabNotifications").classList.add("bg-emerald-600","text-white");
  });
}

/* ---------- boot ---------- */
async function boot(){
  await loadSiteCfg();
  wireUI();
  await refreshCurrentView();
  toast("Admin panel loaded");
}
window.addEventListener("load", boot);
