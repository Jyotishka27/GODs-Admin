// scripts/admin.js
// Admin panel script (no login handling here — login is done on another page)
// - Expects the admin HTML you provided (IDs: filterDate, filterCourt, filterStatus, rows, wlRows, exportCsv, clearAll, refreshBtn, etc.)
// - Uses Firebase client SDK (Firestore). Make sure Firestore rules allow this admin client to read/write, or use server-proxy approach for production.

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  deleteDoc,
  addDoc,
  updateDoc,
  serverTimestamp,
  writeBatch,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js";

/* ---------- CONFIG: update if needed ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyAXDvwYufUn5C_E_IYAdm094gSmyHOg46s",
  authDomain: "gods-turf.firebaseapp.com",
  projectId: "gods-turf",
  storageBucket: "gods-turf.appspot.com",
  messagingSenderId: "46992157689",
  appId: "1:46992157689:web:b547bc847c7a0331bb2b28"
};
const SITE_JSON = "/data/site.json";
/* --------------------------------------------- */

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
let functions = null;
try { functions = getFunctions(app); } catch(e){ functions = null; console.warn("Functions not available", e); }

/* ---------- DOM helpers ---------- */
const $id = id => document.getElementById(id);
const $ = (sel, el=document) => el.querySelector(sel);
function el(tag, cls=''){ const e = document.createElement(tag); if(cls) e.className = cls; return e; }

/* ---------- UI elements (your admin.html IDs) ---------- */
const filterDate = $id("filterDate");
const filterCourt = $id("filterCourt");
const filterStatus = $id("filterStatus");
const exportCsvBtn = $id("exportCsv");
const clearAllBtn = $id("clearAll");
const refreshBtn = $id("refreshBtn");
const rowsTbody = $id("rows");
const wlRowsTbody = $id("wlRows");
const tabBookings = $id("tabBookings");
const tabWaitlist = $id("tabWaitlist");
const tabNotifications = $id("tabNotifications");
const bookingsSection = $id("bookingsSection");
const waitlistSection = $id("waitlistSection");
const notificationsSection = $id("notificationsSection");
// optional notif area
const adminNotifs = $id("adminNotifs");

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
function timeFromISO(iso){
  try { return new Date(iso).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }); }
  catch(e){ return iso || ""; }
}
function toast(msg, err=false){
  // minimal toast: append to adminNotifs if available
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

/* ---------- NEW helper: derive court amount ---------- */
// Return numeric amount for a court id using SITE_CFG.courts
function getCourtAmount(courtId){
  if(!SITE_CFG || !Array.isArray(SITE_CFG.courts) || !courtId) return 0;
  const c = SITE_CFG.courts.find(x => String(x.id) === String(courtId));
  if(!c) return 0;
  // accept common field names: price, amount, rate, fee
  const amt = c.price ?? c.amount ?? c.rate ?? c.fee ?? 0;
  return Number(amt) || 0;
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
    // if no filters, we still query collection
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(d => {
      const data = d.data(); data._id = d.id;
      items.push(data);
    });
    // sort by slotId (lexicographic) then createdAt
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

    // Buttons: show Confirm if pending, always show Delete, show Cancel when not cancelled
    let actionButtons = '';
    if ((b.status || 'pending') === 'pending') {
      actionButtons += `<button data-confirm="${escapeHtml(b._id)}" class="px-2 py-1 rounded border text-green-700 text-sm">Confirm</button>`;
      actionButtons += ` <button data-cancel="${escapeHtml(b._id)}" class="px-2 py-1 rounded border text-red-600 text-sm">Cancel</button>`;
    } else if ((b.status || '') === 'confirmed') {
      actionButtons += `<button data-cancel="${escapeHtml(b._id)}" class="px-2 py-1 rounded border text-red-600 text-sm">Cancel</button>`;
    } else if ((b.status || '') === 'cancelled') {
      actionButtons += `<button data-delete="${escapeHtml(b._id)}" class="px-2 py-1 rounded border text-red-600 text-sm">Delete</button>`;
    } else {
      // fallback actions
      actionButtons += `<button data-delete="${escapeHtml(b._id)}" class="px-2 py-1 rounded border text-red-600 text-sm">Delete</button>`;
    }

    tr.innerHTML = `
      <td class="px-3 py-2 font-mono text-xs">${escapeHtml(b._id)}</td>
      <td class="px-3 py-2">${statusBadge}</td>
      <td class="px-3 py-2">${escapeHtml(b.court || b.courtId || '')}</td>
      <td class="px-3 py-2">${escapeHtml(b.date || b.dateISO || '')}</td>
      <td class="px-3 py-2">${escapeHtml(timeFromISO(b.startISO || b.start))}</td>
      <td class="px-3 py-2">${escapeHtml(b.userName || b.name || '')}<br><span class="text-gray-500 text-xs">${escapeHtml(b.phone || '')}</span></td>
      <td class="px-3 py-2">₹${Number(b.amount || b.price || 0).toLocaleString('en-IN')}</td>
      <td class="px-3 py-2">${escapeHtml(b.notes || '')}</td>
      <td class="px-3 py-2 space-x-2">
        ${actionButtons}
        <button data-wa="${escapeHtml(b._id)}" class="px-2 py-1 rounded border text-sm">WhatsApp</button>
      </td>
    `;
    rowsTbody.appendChild(tr);
  });

  // bind actions
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
  rowsTbody.querySelectorAll("button[data-wa]").forEach(btn=>{
    btn.addEventListener("click", ()=> {
      const id = btn.dataset.wa;
      const b = bookings.find(x => x._id === id);
      if(!b || !b.phone){ toast("Phone not available", true); return; }
      const phonePlain = String(b.phone).replace(/^\+/, '');
      const msg = `Booking ID: ${b._id}\nDate: ${b.date}\nTime: ${timeFromISO(b.startISO || b.start)}\nStatus: ${b.status||'pending'}`;
      window.open(`https://wa.me/${phonePlain}?text=${encodeURIComponent(msg)}`, '_blank');
    });
  });
}

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
    tr.innerHTML = `
      <td class="px-3 py-2 font-mono text-xs">${escapeHtml(w._id)}</td>
      <td class="px-3 py-2">${escapeHtml(w.court || w.courtId || '')}</td>
      <td class="px-3 py-2">${escapeHtml(w.date || '')}</td>
      <td class="px-3 py-2">${escapeHtml(timeFromISO(w.startISO || w.start))}</td>
      <td class="px-3 py-2">${escapeHtml(w.userName || w.name || '')}<br><span class="text-gray-500 text-xs">${escapeHtml(w.phone||'')}</span></td>
      <td class="px-3 py-2 space-x-2">
        <button data-wl-del="${escapeHtml(w._id)}" class="px-2 py-1 rounded border text-red-600 text-sm">Delete</button>
        <button data-wl-convert="${escapeHtml(w._id)}" class="px-2 py-1 rounded border text-sm">Convert → Booking (Pending)</button>
        <button data-wl-wa="${escapeHtml(w._id)}" class="px-2 py-1 rounded border text-sm">WhatsApp</button>
      </td>
    `;
    wlRowsTbody.appendChild(tr);
  });

  // bind
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
      const msg = `Waitlist: ${w.slotLabel || w.slotId}\nDate: ${w.date}`;
      window.open(`https://wa.me/${phonePlain}?text=${encodeURIComponent(msg)}`, '_blank');
    });
  });
}

/* ---------- Actions (Firestore writes) ---------- */
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
        court: data.court || data.courtId || '',
        slotId: data.slotId || '',
        slotLabel: data.slotLabel || '',
        date: data.date || '',
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

/* ---------- Convert wishlist -> booking (call cloud function if available; fallback to transaction) ---------- */
async function convertWishlistToBooking(wishlistId){
  // try callable first
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

  // fallback: client-side transaction (best-effort)
  try {
    const wlRef = doc(db, "wishlists", wishlistId);
    await runTransaction(db, async (t)=>{
      const wlSnap = await t.get(wlRef);
      if(!wlSnap.exists()) throw new Error("Wishlist not found");
      const wl = wlSnap.data();
      // check conflicts for the date+slot
      const conflictQ = query(collection(db,"bookings"), where("date","==", wl.date), where("slotId","==", wl.slotId));
      const conflictSnap = await getDocs(conflictQ);
      let conflictExists = false;
      conflictSnap.forEach(d => {
        const dd = d.data();
        if(dd.status !== 'cancelled') conflictExists = true;
      });
      if(conflictExists) throw new Error("Slot already booked");
      // determine amount: prefer wishlist amount, otherwise derive from site config for that court
      const derivedAmount = (wl.amount && Number(wl.amount)) ? Number(wl.amount) : getCourtAmount(wl.court);
      // create booking doc and update wishlist (set booking as pending)
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

/* ---------- Delete wishlist ---------- */
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
  // bookings
  const bookings = await fetchBookings({ date, court: court || undefined, status: status || undefined });
  renderBookingsTable(bookings);
  // wishlists (fetch for date)
  const wishlist = await fetchWishlists({ date });
  renderWaitlistTable(wishlist);
}

/* ---------- Event wiring ---------- */
function wireUI(){
  // default date to today if empty
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

  // tabs
  tabBookings?.addEventListener("click", ()=> {
    bookingsSection.classList.remove("hidden");
    waitlistSection.classList.add("hidden");
    notificationsSection.classList.add("hidden");
    tabBookings.classList.add("bg-emerald-600","text-white");
    tabWaitlist.classList.remove("bg-emerald-600","text-white");
    tabNotifications.classList.remove("bg-emerald-600","text-white");
  });
  tabWaitlist?.addEventListener("click", ()=> {
    bookingsSection.classList.add("hidden");
    waitlistSection.classList.remove("hidden");
    notificationsSection.classList.add("hidden");
    tabBookings.classList.remove("bg-emerald-600","text-white");
    tabWaitlist.classList.add("bg-emerald-600","text-white");
    tabNotifications.classList.remove("bg-emerald-600","text-white");
  });
  tabNotifications?.addEventListener("click", ()=> {
    bookingsSection.classList.add("hidden");
    waitlistSection.classList.add("hidden");
    notificationsSection.classList.remove("hidden");
    tabBookings.classList.remove("bg-emerald-600","text-white");
    tabWaitlist.classList.remove("bg-emerald-600","text-white");
    tabNotifications.classList.add("bg-emerald-600","text-white");
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
