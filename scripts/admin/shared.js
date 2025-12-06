// scripts/admin/shared.js
// Shared config, Firebase, helpers, and Firestore utilities

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
export const firebaseConfig = {
  apiKey: "AIzaSyAXDvwYufUn5C_E_IYAdm094gSmyHOg46s",
  authDomain: "gods-turf.firebaseapp.com",
  projectId: "gods-turf",
  storageBucket: "gods-turf.appspot.com",
  messagingSenderId: "46992157689",
  appId: "1:46992157689:web:b547bc847c7a0331bb2b28"
};
export const SITE_JSON = "/data/site.json";

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);

let _functions = null;
try {
  _functions = getFunctions(app);
} catch (e) {
  console.warn("Functions not available", e);
}
export const functions = _functions;

/* ---------- DOM helpers ---------- */
export const $id = (id) => document.getElementById(id);
export function el(tag, cls = "") {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/* ---------- Site config runtime ---------- */
export let SITE_CFG = null;

function populateCourtsDropdown() {
  if (!SITE_CFG || !Array.isArray(SITE_CFG.courts)) return;

  const filterCourt = $id("filterCourt");
  const calendarCourtSelect = $id("calendarCourt");

  if (filterCourt) {
    filterCourt.innerHTML = `<option value="">All courts</option>`;
  }
  if (calendarCourtSelect) {
    calendarCourtSelect.innerHTML = `<option value="">All courts</option>`;
  }

  SITE_CFG.courts.forEach((c) => {
    if (filterCourt) {
      const opt1 = document.createElement("option");
      opt1.value = c.id;
      opt1.textContent = c.label || c.id;
      filterCourt.appendChild(opt1);
    }
    if (calendarCourtSelect) {
      const opt2 = document.createElement("option");
      opt2.value = c.id;
      opt2.textContent = c.label || c.id;
      calendarCourtSelect.appendChild(opt2);
    }
  });
}

export async function loadSiteCfg() {
  try {
    const r = await fetch(SITE_JSON, { cache: "no-store" });
    SITE_CFG = await r.json();
    populateCourtsDropdown();
  } catch (e) {
    console.warn("Failed to load site.json", e);
    SITE_CFG = null;
  }
}

/* ---------- util ---------- */
export function fmtDateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function escapeHtml(s) {
  if (s === undefined || s === null) return "";
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function toast(msg, err = false) {
  const adminNotifs = $id("adminNotifs");
  const notifBadge = $id("notifBadge");

  if (adminNotifs) {
    const p = el("div", "text-xs sm:text-sm px-2 py-1 rounded-md border");
    p.textContent = msg;

    if (err) {
      p.classList.add("border-rose-700/70", "bg-rose-900/40", "text-rose-200");
    } else {
      p.classList.add("border-emerald-700/70", "bg-emerald-900/30", "text-emerald-200");
    }

    adminNotifs.prepend(p);
    if (notifBadge) notifBadge.classList.remove("hidden");
    setTimeout(() => p.remove(), 12000);
  } else {
    console.log(msg);
  }
}

/* ---------- Time helpers ---------- */
export function parseToDate(val) {
  if (val === undefined || val === null || val === "") return null;
  try {
    if (typeof val === "object" && typeof val.toDate === "function") return val.toDate();
    if (typeof val === "object" && val.seconds !== undefined) {
      const ms = Number(val.seconds) * 1000 + (Number(val.nanoseconds || 0) / 1e6);
      return new Date(ms);
    }
    if (typeof val === "number") {
      if (String(Math.trunc(val)).length <= 10) return new Date(val * 1000);
      return new Date(val);
    }
    if (typeof val === "string") {
      const d = new Date(val);
      if (!Number.isNaN(d.getTime())) return d;
    }
    if (val instanceof Date) return val;
  } catch (e) {}
  return null;
}

export function formatDateTo12Hour(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}

export function normalizeTimeToken(token) {
  if (!token) return null;
  token = String(token).trim();
  token = token.replace(/\s*(am|pm|AM|PM)\s*/g, (m, p) => p.toUpperCase());
  if (/^\d{1,2}:\d{2}(AM|PM)?$/i.test(token)) return token;
  if (/^\d{4}$/.test(token)) return `${token.slice(0, 2)}:${token.slice(2, 4)}`;
  if (/^\d{3}$/.test(token)) return `${token.slice(0, 1)}:${token.slice(1, 3)}`;
  if (/^\d{1,2}$/.test(token)) return `${String(token).padStart(2, "0")}:00`;
  const m = token.match(/^(\d{1,2})(AM|PM)$/i);
  if (m) return `${String(m[1]).padStart(2, "0")}${m[2].toUpperCase()}`;
  if (token.includes(":")) {
    const parts = token.split(":").map((s) => s.replace(/\D/g, ""));
    if (parts.length >= 2) return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
  }
  return null;
}

export function parseRangeFromLabel(label) {
  if (!label || typeof label !== "string") return null;
  const sepRegex = /(?:\s*(?:-|–|—|to|–|—)\s*)/i;
  const parts = label.split(sepRegex);
  if (parts.length < 2) return null;
  const left = parts[0].trim();
  const right = parts[1].trim();
  const ln = normalizeTimeToken(left) || left;
  const rn = normalizeTimeToken(right) || right;

  const sd = parseToDate(`2000-01-01T${ln}`) || parseToDate(left);
  const ed = parseToDate(`2000-01-01T${rn}`) || parseToDate(right);
  if (sd && ed) return `${formatDateTo12Hour(sd)} – ${formatDateTo12Hour(ed)}`;

  if (/[ap]m/i.test(left) && /[ap]m/i.test(right)) {
    const s = new Date(`2000-01-01 ${left}`);
    const e = new Date(`2000-01-01 ${right}`);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()))
      return `${formatDateTo12Hour(s)} – ${formatDateTo12Hour(e)}`;
  }
  return null;
}

export function deriveRangeFromSlotText(text) {
  if (!text) return null;
  const s = String(text).trim();

  if (/[ap]m|:|\bto\b/i.test(s)) {
    const pl = parseRangeFromLabel(s);
    if (pl) return pl;
  }

  const tokens = s.split(/[_\s|/]+/).filter(Boolean);
  for (const t of tokens) {
    if (t.includes("-")) {
      const [leftRaw, rightRaw] = t.split("-").map((x) => x.trim());
      const ln = normalizeTimeToken(leftRaw);
      const rn = normalizeTimeToken(rightRaw);
      if (ln && rn) {
        const sd = parseToDate(`2000-01-01T${ln}`);
        const ed = parseToDate(`2000-01-01T${rn}`);
        if (sd && ed) return `${formatDateTo12Hour(sd)} – ${formatDateTo12Hour(ed)}`;
        const sd2 = parseToDate(leftRaw) || parseToDate(`2000-01-01 ${leftRaw}`);
        const ed2 = parseToDate(rightRaw) || parseToDate(`2000-01-01 ${rightRaw}`);
        if (sd2 && ed2) return `${formatDateTo12Hour(sd2)} – ${formatDateTo12Hour(ed2)}`;
      }
    }
  }

  const timeRegex = /(\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm)?|\d{3,4})/g;
  const found = [...s.matchAll(timeRegex)].map((m) => m[0].trim());
  if (found.length >= 2) {
    const l = normalizeTimeToken(found[0]);
    const r = normalizeTimeToken(found[1]);
    if (l && r) {
      const sd = parseToDate(`2000-01-01T${l}`);
      const ed = parseToDate(`2000-01-01T${r}`);
      if (sd && ed) return `${formatDateTo12Hour(sd)} – ${formatDateTo12Hour(ed)}`;
    }
  }

  const digitsRegex = /(\d{3,4})/g;
  const digs = [...s.matchAll(digitsRegex)].map((m) => m[0]);
  if (digs.length >= 2) {
    const l = normalizeTimeToken(digs[0]);
    const r = normalizeTimeToken(digs[1]);
    if (l && r) {
      const sd = parseToDate(`2000-01-01T${l}`);
      const ed = parseToDate(`2000-01-01T${r}`);
      if (sd && ed) return `${formatDateTo12Hour(sd)} – ${formatDateTo12Hour(ed)}`;
    }
  }

  return null;
}

export function displayRangeForBooking(b) {
  const startCandidates = ["startISO", "start", "startAt", "start_time", "startTimestamp", "startAtISO"];
  const endCandidates = ["endISO", "end", "endAt", "end_time", "endTimestamp", "endAtISO"];

  let sd = null;
  let ed = null;
  for (const k of startCandidates) {
    if (b[k] !== undefined && b[k] !== null) {
      const p = parseToDate(b[k]);
      if (p) {
        sd = p;
        break;
      }
    }
  }
  for (const k of endCandidates) {
    if (b[k] !== undefined && b[k] !== null) {
      const p = parseToDate(b[k]);
      if (p) {
        ed = p;
        break;
      }
    }
  }
  if (sd && ed) return `${formatDateTo12Hour(sd)} – ${formatDateTo12Hour(ed)}`;
  if (sd && !ed) return `${formatDateTo12Hour(sd)}`;
  if (!sd && ed) return `${formatDateTo12Hour(ed)}`;

  const slotLabel = b.slotLabel || b.slot_label || b.label || "";
  if (slotLabel) {
    const p = deriveRangeFromSlotText(slotLabel);
    if (p) return p;
  }

  const slotFields = [b.slotId, b.slot, b.slot_id, b.slotIdString, b.slotLabel];
  for (const sf of slotFields) {
    if (!sf) continue;
    const p = deriveRangeFromSlotText(sf);
    if (p) return p;
  }

  console.warn("Time parse failed for booking:", {
    id: b._id,
    startISO: b.startISO,
    start: b.start,
    startAt: b.startAt,
    endISO: b.endISO,
    end: b.end,
    slotId: b.slotId,
    slot: b.slot,
    slotLabel: slotLabel
  });
  return "—";
}

/* ---------- Date helpers for calendar ---------- */
export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function startOfWeek(date) {
  const d = new Date(date);
  const js = d.getDay();
  const diff = (js + 6) % 7; // Monday=0
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfMonth(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfMonth(date) {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/* ---------- Court helpers ---------- */
export const COURT_LABEL_OVERRIDES = {
  "5A": "Half Ground (Left Half)",
  "5B": "Half Ground (Right Half)",
  "5A-B": "Half Ground Football",
  "7A": "Full Ground Football",
  CRK: "Full Ground (Cricket)",
  CRICKET: "Full Ground (Cricket)"
};

export function getCourtLabel(courtId) {
  if (!courtId && courtId !== 0) return "";
  const id = String(courtId).trim();

  if (SITE_CFG && Array.isArray(SITE_CFG.courts)) {
    const found = SITE_CFG.courts.find(
      (c) => String(c.id) === id || String(c.id).toLowerCase() === id.toLowerCase()
    );
    if (found) {
      if (found.label) return String(found.label);
      if (found.name) return String(found.name);
    }
  }

  if (COURT_LABEL_OVERRIDES[id]) return COURT_LABEL_OVERRIDES[id];

  const low = id.toLowerCase();
  if (low.includes("cricket") || low.includes("crk")) return "Full Ground (Cricket)";
  if (low.includes("full")) return "Full Ground Football";
  if (/^\d+[ab]$/i.test(id) || /^\d+[A-B]$/i.test(id)) return "Half Ground Football";
  if (/^\d+$/.test(id)) return "Full Ground Football";
  return id;
}

export function getCourtAmount(courtId) {
  if (SITE_CFG && Array.isArray(SITE_CFG.courts)) {
    const c = SITE_CFG.courts.find((x) => String(x.id) === String(courtId));
    if (c) return Number(c.basePrice ?? c.price ?? c.amount ?? 0) || 0;
  }
  const overrides = { "5A": 1500, "5B": 1500, "5A-B": 1500, "7A": 2500, CRK: 2500, CRICKET: 2500 };
  return Number(overrides[String(courtId)] || 0);
}

/* ---------- Firestore reads ---------- */
export async function fetchBookings({ date, court, status } = {}) {
  try {
    const constraints = [];
    if (date) constraints.push(where("date", "==", date));
    if (court) constraints.push(where("court", "==", court));
    if (status) constraints.push(where("status", "==", status));

    let qRef = collection(db, "bookings");
    if (constraints.length) qRef = query(collection(db, "bookings"), ...constraints);

    const snap = await getDocs(qRef);
    const items = [];
    snap.forEach((d) => {
      const data = d.data();
      data._id = d.id;
      items.push(data);
    });
    items.sort(
      (a, b) =>
        (a.slotId || "").localeCompare(b.slotId || "") ||
        (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
    );
    return items;
  } catch (err) {
    console.error("fetchBookings err", err);
    toast("Failed to fetch bookings", true);
    return [];
  }
}

export async function fetchWishlists({ date } = {}) {
  try {
    let qRef = collection(db, "wishlists");
    if (date) qRef = query(collection(db, "wishlists"), where("date", "==", date));
    const snap = await getDocs(qRef);
    const items = [];
    snap.forEach((d) => {
      const dt = d.data();
      dt._id = d.id;
      items.push(dt);
    });
    items.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    return items;
  } catch (err) {
    console.error("fetchWishlists err", err);
    toast("Failed to fetch waitlist", true);
    return [];
  }
}

export async function fetchBookingsRange(startISO, endISO, court) {
  try {
    const constraints = [
      where("date", ">=", startISO),
      where("date", "<=", endISO)
    ];
    if (court) constraints.push(where("court", "==", court));

    const qRef = query(collection(db, "bookings"), ...constraints);
    const snap = await getDocs(qRef);
    const items = [];
    snap.forEach((d) => {
      const data = d.data();
      data._id = d.id;
      items.push(data);
    });
    items.sort(
      (a, b) =>
        String(a.date || "").localeCompare(String(b.date || "")) ||
        (a.slotId || "").localeCompare(b.slotId || "") ||
        (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
    );
    return items;
  } catch (err) {
    console.error("fetchBookingsRange err", err);
    toast("Failed to load calendar bookings", true);
    return [];
  }
}

/* ---------- Firestore writes / actions ---------- */
export async function deleteBooking(id) {
  try {
    await deleteDoc(doc(db, "bookings", id));
    toast(`Deleted booking ${id}`);
  } catch (err) {
    console.error("deleteBooking err", err);
    toast("Delete failed", true);
  }
}

export async function cancelBooking(id) {
  try {
    const ref = doc(db, "bookings", id);
    await updateDoc(ref, { status: "cancelled", cancelledAt: serverTimestamp() });
    toast(`Cancelled booking ${id}`);
  } catch (err) {
    console.error(err);
    toast("Cancel failed", true);
  }
}

export async function confirmBooking(id) {
  try {
    const ref = doc(db, "bookings", id);
    await updateDoc(ref, { status: "confirmed", confirmedAt: serverTimestamp() });
    toast(`Confirmed booking ${id}`);
  } catch (err) {
    console.error(err);
    toast("Confirm failed", true);
  }
}

export async function deleteAllBookings(dateOnly) {
  if (!confirm("Delete ALL bookings? This is destructive. Proceed?")) return;
  try {
    let qRef = collection(db, "bookings");
    if (dateOnly) qRef = query(collection(db, "bookings"), where("date", "==", dateOnly));
    const snap = await getDocs(qRef);
    const batch = writeBatch(db);
    snap.forEach((s) => batch.delete(s.ref));
    await batch.commit();
    toast(`Deleted ${snap.size} bookings`);
  } catch (err) {
    console.error(err);
    toast("Delete all failed", true);
  }
}

export async function exportBookingsCsv(date) {
  try {
    let qRef = collection(db, "bookings");
    if (date) qRef = query(collection(db, "bookings"), where("date", "==", date));
    const snap = await getDocs(qRef);
    const rows = [];
    snap.forEach((d) => {
      const data = d.data();
      rows.push({
        id: d.id,
        status: data.status || "",
        court: getCourtLabel(data.court || data.courtId || ""),
        slotId: data.slotId || "",
        slotLabel: data.slotLabel || "",
        date: data.date || "",
        timeRange: (() => {
          try {
            return displayRangeForBooking(data);
          } catch (e) {
            return "";
          }
        })(),
        startISO: data.startISO || "",
        endISO: data.endISO || "",
        name: data.userName || data.name || "",
        phone: data.phone || "",
        amount: data.amount || data.price || "",
        notes: data.notes || ""
      });
    });
    const csvHead = Object.keys(rows[0] || { id: 1 }).join(",");
    const csvRows = rows.map((r) =>
      Object.values(r)
        .map((v) => `"${String(v || "").replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [csvHead].concat(csvRows).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = el("a");
    a.href = url;
    a.download = `bookings-${date || "all"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("CSV exported");
  } catch (err) {
    console.error(err);
    toast("Export failed", true);
  }
}

export async function convertWishlistToBooking(wishlistId) {
  if (functions) {
    try {
      const fn = httpsCallable(functions, "convertWishlistToBooking");
      const res = await fn({ wishlistId });
      toast("Converted wishlist → booking: " + (res.data?.bookingId || "ok"));
      return;
    } catch (fnErr) {
      console.warn("Callable convert function failed:", fnErr);
      toast("Cloud function unavailable — trying client-side conversion", true);
    }
  }

  try {
    const wlRef = doc(db, "wishlists", wishlistId);
    await runTransaction(db, async (t) => {
      const wlSnap = await t.get(wlRef);
      if (!wlSnap.exists()) throw new Error("Wishlist not found");
      const wl = wlSnap.data();
      const conflictQ = query(
        collection(db, "bookings"),
        where("date", "==", wl.date),
        where("slotId", "==", wl.slotId)
      );
      const conflictSnap = await getDocs(conflictQ);
      let conflictExists = false;
      conflictSnap.forEach((d) => {
        const dd = d.data();
        if (dd.status !== "cancelled") conflictExists = true;
      });
      if (conflictExists) throw new Error("Slot already booked");

      const derivedAmount =
        wl.amount && Number(wl.amount) ? Number(wl.amount) : getCourtAmount(wl.court);

      const bookingRef = doc(collection(db, "bookings"));
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
      t.update(wlRef, {
        status: "converted",
        convertedToBookingId: bookingRef.id,
        convertedAt: serverTimestamp()
      });
    });
    toast("Converted wishlist to booking (pending)");
  } catch (err) {
    console.error("convert fallback error", err);
    toast("Conversion failed: " + (err.message || err), true);
  }
}

export async function deleteWishlist(id) {
  try {
    await deleteDoc(doc(db, "wishlists", id));
    toast("Deleted waitlist item");
  } catch (err) {
    console.error(err);
    toast("Delete waitlist failed", true);
  }
}
