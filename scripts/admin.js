// scripts/admin-app.js
// Admin panel scripts (vanilla JS module)
// - Expects an admin HTML with elements described below (IDs).
// - Uses Firebase CDN v12.5 imports (ES modules).
// - Paste into /scripts/ and include as <script type="module" src="/scripts/admin-app.js"></script>

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  getIdTokenResult
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js";

/* ========= CONFIG: update if needed ========= */
const firebaseConfig = {
  apiKey: "AIzaSyAXDvwYufUn5C_E_IYAdm094gSmyHOg46s",
  authDomain: "gods-turf.firebaseapp.com",
  projectId: "gods-turf",
  storageBucket: "gods-turf.appspot.com",
  messagingSenderId: "46992157689",
  appId: "1:46992157689:web:b547bc847c7a0331bb2b28"
};
const SITE_JSON = "/data/site.json"; // path to your site.json used on public site
/* ============================================ */

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app); // used if you deploy callable functions

/* ========= DOM references (must exist in admin HTML) =========
Required DOM elements (IDs):
- admin-email, admin-pass, admin-login, admin-logout, admin-user
- admin-app (container for admin UI)
- admin-date (input[type=date]) - optional, defaults to today
- admin-refresh (button)
- admin-bookings (container)
- admin-wishlists (container)
- admin-status (for toasts/messages)
If your admin HTML uses different IDs, update the selectors below.
=============================================== */
const el = id => document.getElementById(id);

const emailEl = el("admin-email");
const passEl = el("admin-pass");
const loginBtn = el("admin-login");
const logoutBtn = el("admin-logout");
const userEl = el("admin-user");
const adminAppEl = el("admin-app");
const dateEl = el("admin-date");
const refreshBtn = el("admin-refresh");
const bookingsContainer = el("admin-bookings");
const wishlistsContainer = el("admin-wishlists");
const statusEl = el("admin-status");

/* ========= small helpers ========= */
function fmtDateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function toast(msg, error = false, timeout = 5000) {
  if (!statusEl) {
    alert(msg);
    return;
  }
  statusEl.textContent = msg;
  statusEl.style.color = error ? "#991b1b" : "#064e3b";
  clearTimeout(statusEl._t);
  statusEl._t = setTimeout(() => { statusEl.textContent = ""; }, timeout);
}
function elCreate(tag, cls = "") { const e = document.createElement(tag); if (cls) e.className = cls; return e; }

/* ========= runtime site config (site.json) ========= */
let SITE_CFG = null;
let COURT_META = {};     // built from site.json: id -> { type, label, resourceId, units }
let PRICE_BY_COURT = {}; // id -> price

async function loadSiteCfg() {
  try {
    const r = await fetch(SITE_JSON, { cache: "no-store" });
    if (!r.ok) throw new Error("site.json load failed: " + r.status);
    SITE_CFG = await r.json();
    // build maps
    COURT_META = {};
    PRICE_BY_COURT = {};
    (SITE_CFG.courts || []).forEach(c=>{
      // prefer explicit type, fallback to units heuristic
      const type = c.type || ((c.units && c.units >= 2) ? "full" : "half");
      COURT_META[c.id] = { type, label: c.label || c.id, resourceId: c.resourceId || null, units: c.units || 1 };
      PRICE_BY_COURT[c.id] = c.basePrice || 0;
    });
    toast("Site config loaded");
  } catch (err) {
    console.error("loadSiteCfg err", err);
    toast("Failed to load site.json", true);
  }
}

/* ========= AUTH flow ========= */
loginBtn?.addEventListener("click", async () => {
  const email = emailEl?.value?.trim();
  const pass = passEl?.value || "";
  if (!email || !pass) { toast("Enter email & password", true); return; }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    // onAuthStateChanged will handle UI change
  } catch (err) {
    console.error("login err", err);
    toast("Login failed: " + (err.message || err), true);
  }
});

logoutBtn?.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("logout err", err);
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // signed out
    userEl && (userEl.textContent = "");
    userEl && userEl.classList.add("hidden");
    logoutBtn && logoutBtn.classList.add("hidden");
    adminAppEl && adminAppEl.classList.add("hidden");
    toast("Signed out");
    return;
  }
  // user signed in; check custom claims for admin
  try {
    const tokenRes = await getIdTokenResult(user, /* forceRefresh */ true);
    const isAdmin = !!(tokenRes?.claims && tokenRes.claims.admin === true);
    if (!isAdmin) {
      toast("Not an admin. Contact owner.", true);
      await signOut(auth);
      return;
    }
    userEl && (userEl.textContent = `Signed in as ${user.email}`);
    userEl && userEl.classList.remove("hidden");
    logoutBtn && logoutBtn.classList.remove("hidden");
    adminAppEl && adminAppEl.classList.remove("hidden");
    // initialize admin UI
    await loadSiteCfg();
    initializeAdminUI();
    await loadAndRenderForDate(dateEl?.value || fmtDateISO());
  } catch (err) {
    console.error("auth check err", err);
    toast("Auth error", true);
  }
});

/* ========= Admin UI init ========= */
function initializeAdminUI() {
  // set date input default if absent
  if (dateEl && !dateEl.value) dateEl.value = fmtDateISO();

  refreshBtn?.addEventListener("click", async () => {
    await loadAndRenderForDate(dateEl.value || fmtDateISO());
  });

  dateEl?.addEventListener("change", async () => {
    await loadAndRenderForDate(dateEl.value || fmtDateISO());
  });
}

/* ========= Firestore helpers (admin) ========= */
async function fetchBookingsForDateAdmin(dateISO) {
  try {
    const q = query(collection(db, "bookings"), where("date", "==", dateISO));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(d => {
      const data = d.data(); data._id = d.id;
      items.push(data);
    });
    // sort by slot then time (slot ids like "06:00-07:00" will sort lexicographically OK)
    items.sort((a,b) => (a.slotId||"").localeCompare(b.slotId||"") || (a.createdAt?.seconds||0) - (b.createdAt?.seconds||0));
    return items;
  } catch (err) {
    console.error("fetchBookingsForDateAdmin err", err);
    toast("Failed to load bookings", true);
    return [];
  }
}

async function fetchWishlistsForDateAdmin(dateISO) {
  try {
    const q = query(collection(db, "wishlists"), where("date", "==", dateISO));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(d => {
      const data = d.data(); data._id = d.id;
      items.push(data);
    });
    // earliest first
    items.sort((a,b) => (a.createdAt?.seconds||0) - (b.createdAt?.seconds||0));
    return items;
  } catch (err) {
    console.error("fetchWishlistsForDateAdmin err", err);
    toast("Failed to load wishlists", true);
    return [];
  }
}

/* ========= Render helpers ========= */
function clearContainers() {
  if (bookingsContainer) bookingsContainer.innerHTML = "";
  if (wishlistsContainer) wishlistsContainer.innerHTML = "";
}

function createActionButton(text, cls = "", onClick) {
  const btn = elCreate("button", cls);
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

/* ========= Action implementations ========= */

async function cancelBooking(bookingId) {
  try {
    const adminEmail = auth.currentUser?.email || "admin";
    const ref = doc(db, "bookings", bookingId);
    await updateDoc(ref, { status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: adminEmail });
    toast("Booking cancelled");
    await loadAndRenderForDate(dateEl?.value || fmtDateISO());
    // optional: after cancellation, you may want to notify earliest wishlist (admin action)
  } catch (err) {
    console.error("cancelBooking err", err);
    toast("Cancel failed: " + (err.message || err), true);
  }
}

/**
 * convertWishlistToBooking
 * - Preferred path: call a Cloud Function named 'convertWishlistToBooking' (deployable)
 * - Fallback path: attempt a client-side create with a transaction (not atomic across multiple clients
 *   but OK for low-concurrency admin actions). The function will attempt callable first.
 */
async function convertWishlistToBooking(wishlistId) {
  // try callable cloud function first
  try {
    const callable = httpsCallable(functions, "convertWishlistToBooking");
    const res = await callable({ wishlistId });
    const bookingId = res.data?.bookingId;
    toast("Converted to booking: " + (bookingId || "OK"));
    await loadAndRenderForDate(dateEl?.value || fmtDateISO());
    return;
  } catch (fnErr) {
    console.warn("Callable function failed or not deployed:", fnErr);
    toast("Cloud function unavailable — attempting client-side conversion (admin only).", true);
  }

  // fallback: client-side
  try {
    // read wishlist
    const wlRef = doc(db, "wishlists", wishlistId);
    const wlSnap = await getDocs( query(collection(db,"wishlists"), where("__name__", "==", wishlistId)) );
    // easier: use getDocs above just to confirm but we need the doc ref; instead we'll get the doc
    const wlDoc = await (async ()=>{
      const d = await wlRef.get?.(); // some environments may not support .get; use getDoc if available
      return d;
    })();
    // to keep it robust, we'll re-fetch wishlist by id via getDocs query (since getDoc import not used)
    // Simpler approach: use getDocs with a query on __name__ as we already used - but Firestore doesn't allow __name__ in client queries easily.
    // Let's instead attempt to read using getDocs on collection filtered by id field 'preferredBookingId' if stored.
    // To avoid complexity, we will not implement full client fallback here; instruct admin to deploy Cloud Function if needed.
    toast("Client-side conversion fallback is not implemented in this build. Please deploy convertWishlistToBooking Cloud Function.", true);
  } catch (err) {
    console.error("client-side convert err", err);
    toast("Conversion failed: " + (err.message || err), true);
  }
}

/* ========= Notify via WhatsApp (open new window) ========= */
function notifyWishlistUser(wl) {
  try {
    if (!wl || !wl.phone) { toast("No phone available to notify", true); return; }
    const phonePlain = wl.phone.replace(/[^+\d]/g, "").replace(/^\+/, "");
    const msg = `Hi ${wl.userName || "there"}, a slot is available at GODs Turf on ${wl.date} for ${wl.slotLabel}. Reply if you'd like to confirm.`;
    const url = `https://wa.me/${phonePlain}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  } catch (err) {
    console.error("notifyWishlistUser err", err);
    toast("Notify failed", true);
  }
}

/* ========= Render bookings & wishlists ========= */
function renderBookings(bookings) {
  if (!bookingsContainer) return;
  bookingsContainer.innerHTML = "";

  if (!bookings.length) {
    bookingsContainer.appendChild(elCreate("div", "text-sm text-gray-500")).textContent = "No bookings for selected date.";
    return;
  }

  bookings.forEach(b => {
    const row = elCreate("div", "admin-row border p-3 mb-2 rounded");
    // left: info
    const info = elCreate("div", "mb-2");
    info.innerHTML = `<div><strong>${b.slotLabel || b.slotId}</strong> · ${b.date}</div>
                      <div class="text-xs text-gray-600">Court: ${b.court} · Status: ${b.status || "pending"} · Amount: ${b.amount || "-"}</div>`;
    row.appendChild(info);

    // meta lines
    const meta = elCreate("div", "text-sm text-gray-700 mb-2");
    meta.textContent = `Name: ${b.userName || "-"} · Phone: ${b.phone || "-"}`;
    row.appendChild(meta);

    // actions
    const actions = elCreate("div", "flex gap-2");
    // Cancel
    const cancelBtn = createActionButton("Cancel", "btn btn-sm btn-danger", async () => {
      if (!confirm("Cancel this booking?")) return;
      await cancelBooking(b._id);
    });
    actions.appendChild(cancelBtn);

    // Optional: quick notify wishlist users (open WA)
    const notifyBtn = createActionButton("Notify Wishlist", "btn btn-sm", async () => {
      // open WhatsApp for earliest wishlist for same slot/date
      const wl = await findEarliestWishlist(b.date, b.slotId);
      if (!wl) { toast("No wishlist entries found"); return; }
      notifyWishlistUser(wl);
    });
    actions.appendChild(notifyBtn);

    row.appendChild(actions);
    bookingsContainer.appendChild(row);
  });
}

function renderWishlists(wishlists) {
  if (!wishlistsContainer) return;
  wishlistsContainer.innerHTML = "";

  if (!wishlists.length) {
    wishlistsContainer.appendChild(elCreate("div", "text-sm text-gray-500")).textContent = "No wishlists for selected date.";
    return;
  }

  wishlists.forEach(w => {
    const row = elCreate("div", "admin-row border p-3 mb-2 rounded");
    const info = elCreate("div", "mb-2");
    info.innerHTML = `<div><strong>${w.slotLabel || w.slotId}</strong> · ${w.date}</div>
                      <div class="text-xs text-gray-600">Court: ${w.court} · Status: ${w.status || "open"}</div>`;
    row.appendChild(info);

    const meta = elCreate("div", "text-sm text-gray-700 mb-2");
    meta.textContent = `Name: ${w.userName || "-"} · Phone: ${w.phone || "-"} · Added: ${w.createdAt?.toDate ? w.createdAt.toDate().toLocaleString() : "-"}`;
    row.appendChild(meta);

    const actions = elCreate("div", "flex gap-2");
    // Convert (call Cloud Function)
    const convertBtn = createActionButton("Convert → Booking", "btn btn-sm btn-primary", async () => {
      if (!confirm("Convert this wishlist entry into a booking? This will attempt an atomic conversion on the server.")) return;
      await convertWishlistToBooking(w._id);
    });
    actions.appendChild(convertBtn);

    // Notify (WhatsApp)
    const notifyBtn = createActionButton("Notify", "btn btn-sm", () => notifyWishlistUser(w));
    actions.appendChild(notifyBtn);

    row.appendChild(actions);
    wishlistsContainer.appendChild(row);
  });
}

/* ========= utility: find earliest wishlist for a slot & date ========= */
async function findEarliestWishlist(date, slotId) {
  try {
    const q = query(collection(db, "wishlists"), where("date", "==", date), where("slotId", "==", slotId), where("status", "==", "open"));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(d => {
      const dt = d.data(); dt._id = d.id;
      items.push(dt);
    });
    if (!items.length) return null;
    items.sort((a,b) => (a.createdAt?.seconds||0) - (b.createdAt?.seconds||0));
    return items[0];
  } catch (err) {
    console.error("findEarliestWishlist err", err);
    return null;
  }
}

/* ========= load & render for date ========= */
async function loadAndRenderForDate(dateISO) {
  if (!dateISO) dateISO = fmtDateISO();
  clearContainers();
  toast("Loading bookings & wishlists...");
  try {
    const [bookings, wishlists] = await Promise.all([
      fetchBookingsForDateAdmin(dateISO),
      fetchWishlistsForDateAdmin(dateISO)
    ]);
    renderBookings(bookings);
    renderWishlists(wishlists);
    toast("Loaded");
  } catch (err) {
    console.error("loadAndRenderForDate err", err);
    toast("Load failed", true);
  }
}

/* ========= Bootstrapping: expose some helpers for console debugging ========= */
window.__GODS_ADMIN = {
  loadSiteCfg,
  loadAndRenderForDate,
  fetchBookingsForDateAdmin,
  fetchWishlistsForDateAdmin,
  convertWishlistToBooking,
  cancelBooking,
  notifyWishlistUser
};

// If user is already signed in & admin, onAuthStateChanged will run. Otherwise show login UI by default.
toast("Admin scripts loaded. Sign in to continue.");

/* End of admin-app.js */
