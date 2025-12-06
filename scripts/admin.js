// scripts/admin.js
// Updated for new Outlook/Teams-style admin UI

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
try {
  functions = getFunctions(app);
} catch (e) {
  functions = null;
  console.warn("Functions not available", e);
}

/* ---------- DOM helpers ---------- */
const $id = (id) => document.getElementById(id);
function el(tag, cls = "") {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/* ---------- UI elements ---------- */
// Filters + actions
const filterDate = $id("filterDate");
const filterCourt = $id("filterCourt");
const filterStatus = $id("filterStatus");
const exportCsvBtn = $id("exportCsv");
const clearAllBtn = $id("clearAll");
const refreshBtn = $id("refreshBtn");

// Inbox list + detail
const bookingListEl = $id("bookingList");
const listTitleEl = $id("listTitle");
const listCountEl = $id("listCount");

const detailTitleEl = $id("detailTitle");
const detailSubtitleEl = $id("detailSubtitle");
const detailBodyEl = $id("detailBody");
const detailStatusPillEl = $id("detailStatusPill");
const detailApproveBtn = $id("detailApprove");
const detailCancelBtn = $id("detailCancel");

// Views + navigation
const viewTitleEl = $id("viewTitle");
const viewInboxEl = $id("viewInbox");
const viewCalendarEl = $id("viewCalendar");
const viewAnalyticsEl = $id("viewAnalytics");
const viewNotificationsEl = $id("viewNotifications");

const navInboxBtn = $id("navInbox");
const navCalendarBtn = $id("navCalendar");
const navAnalyticsBtn = $id("navAnalytics");
const navNotificationsBtn = $id("navNotifications");

// Inbox inner tabs
const tabBookingsBtn = $id("tabBookings");
const tabWaitlistBtn = $id("tabWaitlist");
const tabNotificationsInnerBtn = $id("tabNotificationsInner");

// Notifications
const adminNotifs = $id("adminNotifs");
const notifBell = $id("notifBell");
const notifBadge = $id("notifBadge");
const markAllReadBtn = $id("markAllRead");
const clearNotifsBtn = $id("clearNotifs");

// Misc
const bizNameEl = $id("bizName");
const calendarCourtSelect = $id("calendarCourt");

/* ---------- State ---------- */
let SITE_CFG = null;

let currentInboxTab = "bookings"; // "bookings" | "waitlist" | "notifications"
let currentBookings = [];
let currentWaitlist = [];
let selectedId = null;
let selectedType = null; // "booking" | "waitlist"

/* ---------- Site config runtime ---------- */
async function loadSiteCfg() {
  try {
    const r = await fetch(SITE_JSON, { cache: "no-store" });
    SITE_CFG = await r.json();
    populateCourtsDropdown();
  } catch (e) {
    console.warn("Failed to load site.json", e);
    SITE_CFG = null;
  }
}

function populateCourtsDropdown() {
  if (!SITE_CFG || !Array.isArray(SITE_CFG.courts)) return;

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

/* ---------- util ---------- */
function fmtDateISO(d = new Date()) {
  const y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, "0"),
    dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function escapeHtml(s) {
  if (s === undefined || s === null) return "";
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function toast(msg, err = false) {
  if (adminNotifs) {
    const p = el("div", "text-xs sm:text-sm px-2 py-1 rounded-md border");
    p.textContent = msg;
    p.classList.add(err ? "border-rose-700/70", "bg-rose-900/40", "text-rose-200" : "border-emerald-700/70", "bg-emerald-900/30", "text-emerald-200");

    adminNotifs.prepend(p);
    // show badge
    if (notifBadge) notifBadge.classList.remove("hidden");
    setTimeout(() => p.remove(), 12000);
  } else {
    console.log(msg);
  }
}

/* ---------- Time parsing/format helpers (robust) ---------- */
function parseToDate(val) {
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

function formatDateTo12Hour(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}

function normalizeTimeToken(token) {
  if (!token) return null;
  token = String(token).trim();
  token = token.replace(/\s*(am|pm|AM|PM)\s*/g, (m, p) => p.toUpperCase());
  if (/^\d{1,2}:\d{2}(AM|PM)?$/i.test(token)) return token;
  if (/^\d{4}$/.test(token)) return `${token.slice(0, 2)}:${token.slice(2, 4)}`;
  if (/^\d{3}$/.test(token)) return `${token.slice(0, 1)}:${token.slice(1, 3)}`;
  if (/^\d{1,2}$/.test(token)) return `${String(token).padStart(2, "0")}:00`;
  let m = token.match(/^(\d{1,2})(AM|PM)$/i);
  if (m) return `${String(m[1]).padStart(2, "0")}${m[2].toUpperCase()}`;
  if (token.includes(":")) {
    const parts = token.split(":").map((s) => s.replace(/\D/g, ""));
    if (parts.length >= 2) return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
  }
  return null;
}

function parseRangeFromLabel(label) {
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
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) return `${formatDateTo12Hour(s)} – ${formatDateTo12Hour(e)}`;
  }
  return null;
}

function deriveRangeFromSlotText(text) {
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

function displayRangeForBooking(b) {
  const startCandidates = ["startISO", "start", "startAt", "start_time", "startTimestamp", "startAtISO"];
  const endCandidates = ["endISO", "end", "endAt", "end_time", "endTimestamp", "endAtISO"];

  let sd = null,
    ed = null;
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

/* ---------- Court label overrides ---------- */
const COURT_LABEL_OVERRIDES = {
  "5A": "Half Ground (Left Half)",
  "5B": "Half Ground (Right Half)",
  "5A-B": "Half Ground Football",
  "7A": "Full Ground Football",
  CRK: "Full Ground (Cricket)",
  CRICKET: "Full Ground (Cricket)"
};

function getCourtLabel(courtId) {
  if (!courtId && courtId !== 0) return "";
  const id = String(courtId).trim();

  if (SITE_CFG && Array.isArray(SITE_CFG.courts)) {
    const found = SITE_CFG.courts.find((c) => String(c.id) === id || String(c.id).toLowerCase() === id.toLowerCase());
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

function getCourtAmount(courtId) {
  if (SITE_CFG && Array.isArray(SITE_CFG.courts)) {
    const c = SITE_CFG.courts.find((x) => String(x.id) === String(courtId));
    if (c) return Number(c.basePrice ?? c.price ?? c.amount ?? 0) || 0;
  }
  const overrides = { "5A": 1500, "5B": 1500, "5A-B": 1500, "7A": 2500, CRK: 2500, CRICKET: 2500 };
  return Number(overrides[String(courtId)] || 0);
}

/* ---------- Firestore reads ---------- */
async function fetchBookings({ date, court, status } = {}) {
  try {
    let qRef = collection(db, "bookings");
    const filters = [];
    if (date) filters.push(where("date", "==", date));
    if (court) filters.push(where("court", "==", court));
    if (status) filters.push(where("status", "==", status));
    if (filters.length) qRef = query(collection(db, "bookings"), ...filters);

    const snap = await getDocs(qRef);
    const items = [];
    snap.forEach((d) => {
      const data = d.data();
      data._id = d.id;
      items.push(data);
    });
    items.sort(
      (a, b) => (a.slotId || "").localeCompare(b.slotId || "") || (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
    );
    return items;
  } catch (err) {
    console.error("fetchBookings err", err);
    toast("Failed to fetch bookings", true);
    return [];
  }
}

async function fetchWishlists({ date } = {}) {
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

/* ---------- Renderers: list + detail ---------- */

function clearSelectionUI() {
  selectedId = null;
  selectedType = null;
  if (bookingListEl) {
    bookingListEl.querySelectorAll("[data-row-id]").forEach((n) => {
      n.classList.remove("bg-slate-800/80", "border-l-2", "border-emerald-400");
    });
  }
  if (detailTitleEl) detailTitleEl.textContent = "No booking selected";
  if (detailSubtitleEl)
    detailSubtitleEl.textContent = "Pick a booking from the left to view full details, approve or cancel.";
  if (detailBodyEl) detailBodyEl.innerHTML = "";
  if (detailStatusPillEl) {
    detailStatusPillEl.textContent = "—";
    detailStatusPillEl.className =
      "text-[11px] px-2 py-1 rounded-full border border-slate-700 text-slate-400";
  }
  if (detailApproveBtn) {
    detailApproveBtn.disabled = true;
    detailApproveBtn.textContent = "Confirm booking";
  }
  if (detailCancelBtn) {
    detailCancelBtn.disabled = true;
    detailCancelBtn.textContent = "Cancel booking";
  }
}

function renderBookingsList(bookings) {
  if (!bookingListEl) return;
  bookingListEl.innerHTML = "";
  currentBookings = bookings || [];

  listTitleEl && (listTitleEl.textContent = "Booking requests");
  listCountEl &&
    (listCountEl.textContent = `${bookings.length || 0} ${bookings.length === 1 ? "item" : "items"}`);

  if (!bookings.length) {
    const empty = el(
      "div",
      "text-xs sm:text-sm text-slate-500 px-3 py-4 text-center"
    );
    empty.textContent = "No bookings for this date.";
    bookingListEl.appendChild(empty);
    clearSelectionUI();
    return;
  }

  bookings.forEach((b) => {
    const status = b.status || "pending";
    const isConfirmed = status === "confirmed";
    const isCancelled = status === "cancelled";

    const row = el(
      "button",
      "w-full text-left px-3 py-2 sm:py-2.5 border-b border-slate-800 hover:bg-slate-800/60 flex flex-col gap-1 focus:outline-none"
    );
    row.dataset.rowId = b._id;
    row.dataset.type = "booking";

    const range = displayRangeForBooking(b);
    const courtLabel = getCourtLabel(b.court || b.courtId || b.court_id || "");
    const amount = Number(b.amount || b.price || getCourtAmount(b.court) || 0);

    const statusPillClass = isConfirmed
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
      : isCancelled
      ? "bg-rose-500/15 text-rose-300 border-rose-500/40"
      : "bg-amber-500/15 text-amber-200 border-amber-500/40";

    const statusLabel = isConfirmed
      ? "Confirmed"
      : isCancelled
      ? "Cancelled"
      : (status || "Pending").toUpperCase();

    row.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full border ${statusPillClass} text-[10px] font-medium">
            ${escapeHtml(statusLabel)}
          </span>
          <span class="text-xs sm:text-sm text-slate-100 font-medium">${escapeHtml(range || "—")}</span>
        </div>
        <div class="text-xs sm:text-sm text-slate-200 font-medium">
          ₹${amount.toLocaleString("en-IN")}
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-1 mt-1">
        <div class="text-[11px] sm:text-xs text-slate-300">
          ${escapeHtml(b.userName || b.name || "Guest")}
          ${
            b.phone
              ? `<span class="text-slate-500"> · ${escapeHtml(String(b.phone))}</span>`
              : ""
          }
        </div>
        <div class="text-[11px] sm:text-xs text-slate-500">
          ${escapeHtml(b.date || "")} · ${escapeHtml(courtLabel)}
        </div>
      </div>
    `;

    row.addEventListener("click", () => {
      selectedId = b._id;
      selectedType = "booking";

      bookingListEl.querySelectorAll("[data-row-id]").forEach((n) => {
        n.classList.remove("bg-slate-800/80", "border-l-2", "border-emerald-400");
      });
      row.classList.add("bg-slate-800/80", "border-l-2", "border-emerald-400");

      showBookingDetail(b);
    });

    bookingListEl.appendChild(row);
  });

  clearSelectionUI(); // reset detail
}

function renderWaitlistList(wls) {
  if (!bookingListEl) return;
  bookingListEl.innerHTML = "";
  currentWaitlist = wls || [];

  listTitleEl && (listTitleEl.textContent = "Waitlist");
  listCountEl &&
    (listCountEl.textContent = `${wls.length || 0} ${wls.length === 1 ? "entry" : "entries"}`);

  if (!wls.length) {
    const empty = el(
      "div",
      "text-xs sm:text-sm text-slate-500 px-3 py-4 text-center"
    );
    empty.textContent = "No waitlist entries for this date.";
    bookingListEl.appendChild(empty);
    clearSelectionUI();
    return;
  }

  wls.forEach((w) => {
    const row = el(
      "button",
      "w-full text-left px-3 py-2 sm:py-2.5 border-b border-slate-800 hover:bg-slate-800/60 flex flex-col gap-1 focus:outline-none"
    );
    row.dataset.rowId = w._id;
    row.dataset.type = "waitlist";

    const range = displayRangeForBooking(w);
    const courtLabel = getCourtLabel(w.court || w.courtId || w.court_id || "");

    row.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full border bg-slate-500/20 text-slate-100 border-slate-500/40 text-[10px] font-medium">
            WAITLIST
          </span>
          <span class="text-xs sm:text-sm text-slate-100 font-medium">${escapeHtml(range || "—")}</span>
        </div>
        <div class="text-[11px] sm:text-xs text-slate-400">
          ${escapeHtml(w.date || "")}
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-1 mt-1">
        <div class="text-[11px] sm:text-xs text-slate-300">
          ${escapeHtml(w.userName || w.name || "Guest")}
          ${
            w.phone
              ? `<span class="text-slate-500"> · ${escapeHtml(String(w.phone))}</span>`
              : ""
          }
        </div>
        <div class="text-[11px] sm:text-xs text-slate-500">
          ${escapeHtml(courtLabel)}
        </div>
      </div>
    `;

    row.addEventListener("click", () => {
      selectedId = w._id;
      selectedType = "waitlist";

      bookingListEl.querySelectorAll("[data-row-id]").forEach((n) => {
        n.classList.remove("bg-slate-800/80", "border-l-2", "border-emerald-400");
      });
      row.classList.add("bg-slate-800/80", "border-l-2", "border-emerald-400");

      showWaitlistDetail(w);
    });

    bookingListEl.appendChild(row);
  });

  clearSelectionUI(); // reset detail
}

/* ---------- Detail pane content ---------- */

function showBookingDetail(b) {
  if (!b) {
    clearSelectionUI();
    return;
  }

  const status = b.status || "pending";
  const isConfirmed = status === "confirmed";
  const isCancelled = status === "cancelled";
  const range = displayRangeForBooking(b);
  const courtLabel = getCourtLabel(b.court || b.courtId || b.court_id || "");
  const amount = Number(b.amount || b.price || getCourtAmount(b.court) || 0);
  const sourceName =
    (SITE_CFG && SITE_CFG.name) || (bizNameEl ? bizNameEl.textContent.trim() : "GODs Turf");

  if (detailTitleEl) {
    detailTitleEl.textContent = `${b.userName || b.name || "Booking"} · ${range || "—"}`;
  }
  if (detailSubtitleEl) {
    detailSubtitleEl.textContent = `${b.date || ""} · ${courtLabel} · ID ${b._id}`;
  }

  if (detailBodyEl) {
    const phoneStr = b.phone ? String(b.phone) : "";
    const notesStr = b.notes || "";
    const createdAtStr = b.createdAt ? parseToDate(b.createdAt)?.toLocaleString() : "";

    detailBodyEl.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[11px] sm:text-xs">
        <div>
          <p class="text-slate-400">Customer</p>
          <p class="text-slate-100">${escapeHtml(b.userName || b.name || "—")}</p>
        </div>
        <div>
          <p class="text-slate-400">Phone</p>
          <p class="text-slate-100">${escapeHtml(phoneStr || "—")}</p>
        </div>
        <div>
          <p class="text-slate-400">Date & Time</p>
          <p class="text-slate-100">${escapeHtml(b.date || "")} · ${escapeHtml(range || "—")}</p>
        </div>
        <div>
          <p class="text-slate-400">Court</p>
          <p class="text-slate-100">${escapeHtml(courtLabel || "—")}</p>
        </div>
        <div>
          <p class="text-slate-400">Amount</p>
          <p class="text-slate-100">₹${amount.toLocaleString("en-IN")}</p>
        </div>
        <div>
          <p class="text-slate-400">Status</p>
          <p class="text-slate-100">${escapeHtml(status)}</p>
        </div>
        <div>
          <p class="text-slate-400">Created at</p>
          <p class="text-slate-100">${escapeHtml(createdAtStr || "—")}</p>
        </div>
        <div>
          <p class="text-slate-400">Slot ID</p>
          <p class="text-slate-100">${escapeHtml(b.slotId || "—")}</p>
        </div>
      </div>
      <div class="mt-3">
        <p class="text-slate-400 mb-1 text-[11px] sm:text-xs">Notes</p>
        <p class="text-slate-100 text-xs sm:text-sm whitespace-pre-line">
          ${escapeHtml(notesStr || "No notes")}
        </p>
      </div>
      <div class="mt-3 pt-3 border-t border-slate-800 flex flex-wrap gap-2 text-[11px] sm:text-xs">
        <button
          id="detailWhatsappBtn"
          class="px-2.5 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-100 flex items-center gap-1"
        >
          <span>WhatsApp customer</span>
        </button>
      </div>
    `;

    const waBtn = detailBodyEl.querySelector("#detailWhatsappBtn");
    if (waBtn) {
      waBtn.addEventListener("click", () => {
        if (!b.phone) {
          toast("Phone not available", true);
          return;
        }
        const phonePlain = String(b.phone).replace(/^\+/, "");
        const msg = `Hi! This is ${sourceName}.
We are sending this message from ${sourceName} (automated notification).

Booking details:
Booking ID: ${b._id}
Date: ${b.date || ""}
Time: ${range}
Court: ${courtLabel}
Status: ${status}
Amount: ₹${amount.toLocaleString("en-IN")}

If you have any questions, reply to this message. Thank you!`;
        window.open(`https://wa.me/${phonePlain}?text=${encodeURIComponent(msg)}`, "_blank");
      });
    }
  }

  if (detailStatusPillEl) {
    let pillClass =
      "text-[11px] px-2 py-1 rounded-full border border-slate-700 text-slate-400";
    if (isConfirmed) pillClass = "text-[11px] px-2 py-1 rounded-full border border-emerald-500/60 bg-emerald-500/10 text-emerald-300";
    else if (isCancelled)
      pillClass = "text-[11px] px-2 py-1 rounded-full border border-rose-500/60 bg-rose-500/10 text-rose-300";
    else
      pillClass = "text-[11px] px-2 py-1 rounded-full border border-amber-500/60 bg-amber-500/10 text-amber-200";

    detailStatusPillEl.className = pillClass;
    detailStatusPillEl.textContent = status.toUpperCase();
  }

  if (detailApproveBtn) {
    detailApproveBtn.onclick = null;
    detailApproveBtn.disabled = false;

    if (isConfirmed) {
      detailApproveBtn.disabled = true;
      detailApproveBtn.textContent = "Already confirmed";
    } else if (isCancelled) {
      detailApproveBtn.disabled = true;
      detailApproveBtn.textContent = "Cannot confirm (cancelled)";
    } else {
      detailApproveBtn.textContent = "Confirm booking";
      detailApproveBtn.onclick = async () => {
        if (!confirm(`Confirm booking ${b._id}?`)) return;
        await confirmBooking(b._id);
        await refreshCurrentView();
      };
    }
  }

  if (detailCancelBtn) {
    detailCancelBtn.onclick = null;
    detailCancelBtn.disabled = false;

    if (isCancelled) {
      detailCancelBtn.textContent = "Delete booking";
      detailCancelBtn.onclick = async () => {
        if (!confirm(`Delete booking ${b._id}?`)) return;
        await deleteBooking(b._id);
        await refreshCurrentView();
      };
    } else {
      detailCancelBtn.textContent = "Cancel booking";
      detailCancelBtn.onclick = async () => {
        if (!confirm(`Mark booking ${b._id} as cancelled?`)) return;
        await cancelBooking(b._id);
        await refreshCurrentView();
      };
    }
  }
}

function showWaitlistDetail(w) {
  if (!w) {
    clearSelectionUI();
    return;
  }

  const range = displayRangeForBooking(w);
  const courtLabel = getCourtLabel(w.court || w.courtId || w.court_id || "");

  if (detailTitleEl) {
    detailTitleEl.textContent = `Waitlist · ${w.userName || w.name || "Guest"} · ${range || "—"}`;
  }
  if (detailSubtitleEl) {
    detailSubtitleEl.textContent = `${w.date || ""} · ${courtLabel} · ID ${w._id}`;
  }

  if (detailBodyEl) {
    const phoneStr = w.phone ? String(w.phone) : "";
    const notesStr = w.notes || "";
    const createdAtStr = w.createdAt ? parseToDate(w.createdAt)?.toLocaleString() : "";

    detailBodyEl.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[11px] sm:text-xs">
        <div>
          <p class="text-slate-400">Customer</p>
          <p class="text-slate-100">${escapeHtml(w.userName || w.name || "—")}</p>
        </div>
        <div>
          <p class="text-slate-400">Phone</p>
          <p class="text-slate-100">${escapeHtml(phoneStr || "—")}</p>
        </div>
        <div>
          <p class="text-slate-400">Date & Time</p>
          <p class="text-slate-100">${escapeHtml(w.date || "")} · ${escapeHtml(range || "—")}</p>
        </div>
        <div>
          <p class="text-slate-400">Court</p>
          <p class="text-slate-100">${escapeHtml(courtLabel || "—")}</p>
        </div>
        <div>
          <p class="text-slate-400">Slot ID</p>
          <p class="text-slate-100">${escapeHtml(w.slotId || "—")}</p>
        </div>
        <div>
          <p class="text-slate-400">Status</p>
          <p class="text-slate-100">${escapeHtml(w.status || "waitlist")}</p>
        </div>
        <div>
          <p class="text-slate-400">Created at</p>
          <p class="text-slate-100">${escapeHtml(createdAtStr || "—")}</p>
        </div>
      </div>
      <div class="mt-3">
        <p class="text-slate-400 mb-1 text-[11px] sm:text-xs">Notes</p>
        <p class="text-slate-100 text-xs sm:text-sm whitespace-pre-line">
          ${escapeHtml(notesStr || "No notes")}
        </p>
      </div>
      <div class="mt-3 pt-3 border-t border-slate-800 flex flex-wrap gap-2 text-[11px] sm:text-xs">
        <button
          id="wlWhatsappBtn"
          class="px-2.5 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-100 flex items-center gap-1"
        >
          WhatsApp customer
        </button>
      </div>
    `;

    const waBtn = detailBodyEl.querySelector("#wlWhatsappBtn");
    if (waBtn) {
      waBtn.addEventListener("click", () => {
        if (!w.phone) {
          toast("Phone not available", true);
          return;
        }
        const phonePlain = String(w.phone).replace(/^\+/, "");
        const msg = `Waitlist details:
Date: ${w.date}
Time: ${range}
Court: ${courtLabel}
Slot: ${w.slotLabel || w.slotId || ""}`;
        window.open(`https://wa.me/${phonePlain}?text=${encodeURIComponent(msg)}`, "_blank");
      });
    }
  }

  if (detailStatusPillEl) {
    detailStatusPillEl.className =
      "text-[11px] px-2 py-1 rounded-full border border-slate-500/60 bg-slate-500/20 text-slate-100";
    detailStatusPillEl.textContent = "WAITLIST";
  }

  if (detailApproveBtn) {
    detailApproveBtn.disabled = false;
    detailApproveBtn.textContent = "Convert → Booking (Pending)";
    detailApproveBtn.onclick = async () => {
      if (!confirm(`Convert waitlist ${w._id} to a pending booking?`)) return;
      await convertWishlistToBooking(w._id);
      await refreshCurrentView();
    };
  }

  if (detailCancelBtn) {
    detailCancelBtn.disabled = false;
    detailCancelBtn.textContent = "Delete waitlist entry";
    detailCancelBtn.onclick = async () => {
      if (!confirm(`Delete waitlist ${w._id}?`)) return;
      await deleteWishlist(w._id);
      await refreshCurrentView();
    };
  }
}

/* ---------- Actions (Firestore writes) ---------- */
async function deleteBooking(id) {
  try {
    await deleteDoc(doc(db, "bookings", id));
    toast(`Deleted booking ${id}`);
  } catch (err) {
    console.error("deleteBooking err", err);
    toast("Delete failed", true);
  }
}
async function cancelBooking(id) {
  try {
    const ref = doc(db, "bookings", id);
    await updateDoc(ref, { status: "cancelled", cancelledAt: serverTimestamp() });
    toast(`Cancelled booking ${id}`);
  } catch (err) {
    console.error(err);
    toast("Cancel failed", true);
  }
}
async function confirmBooking(id) {
  try {
    const ref = doc(db, "bookings", id);
    await updateDoc(ref, { status: "confirmed", confirmedAt: serverTimestamp() });
    toast(`Confirmed booking ${id}`);
  } catch (err) {
    console.error(err);
    toast("Confirm failed", true);
  }
}
async function deleteAllBookings(dateOnly) {
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
async function exportBookingsCsv(date) {
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

/* ---------- Convert wishlist -> booking ---------- */
async function convertWishlistToBooking(wishlistId) {
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
        (wl.amount && Number(wl.amount)) ? Number(wl.amount) : getCourtAmount(wl.court);

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

async function deleteWishlist(id) {
  try {
    await deleteDoc(doc(db, "wishlists", id));
    toast("Deleted waitlist item");
  } catch (err) {
    console.error(err);
    toast("Delete waitlist failed", true);
  }
}

/* ---------- Refresh & view wiring ---------- */

async function refreshCurrentView() {
  const date = filterDate?.value || fmtDateISO();
  const court = filterCourt?.value || "";
  const status = filterStatus?.value || "";

  const [bookings, wishlist] = await Promise.all([
    fetchBookings({ date, court: court || undefined, status: status || undefined }),
    fetchWishlists({ date })
  ]);

  currentBookings = bookings;
  currentWaitlist = wishlist;

  if (currentInboxTab === "bookings") {
    renderBookingsList(bookings);
  } else if (currentInboxTab === "waitlist") {
    renderWaitlistList(wishlist);
  } else if (currentInboxTab === "notifications") {
    // For now, just show a message in the list
    if (bookingListEl) {
      bookingListEl.innerHTML = "";
      const info = el(
        "div",
        "text-xs sm:text-sm text-slate-400 px-3 py-4"
      );
      info.textContent =
        "Use the Notifications view from the left sidebar to see full notification history.";
      bookingListEl.appendChild(info);
    }
    clearSelectionUI();
    listTitleEl && (listTitleEl.textContent = "Notifications");
    listCountEl && (listCountEl.textContent = "");
  }
}

/* ---------- Navigation helpers ---------- */
function setActiveView(view) {
  const map = {
    inbox: { el: viewInboxEl, btn: navInboxBtn, title: "Requests" },
    calendar: { el: viewCalendarEl, btn: navCalendarBtn, title: "Calendar" },
    analytics: { el: viewAnalyticsEl, btn: navAnalyticsBtn, title: "Analytics" },
    notifications: { el: viewNotificationsEl, btn: navNotificationsBtn, title: "Notifications" }
  };

  Object.entries(map).forEach(([k, { el, btn, title }]) => {
    if (!el || !btn) return;
    if (k === view) {
      el.classList.remove("hidden");
      btn.classList.add("bg-slate-800", "text-slate-50");
      if (viewTitleEl) viewTitleEl.textContent = title;
    } else {
      el.classList.add("hidden");
      btn.classList.remove("bg-slate-800", "text-slate-50");
    }
  });
}

/* ---------- Event wiring ---------- */
function wireUI() {
  if (filterDate && !filterDate.value) filterDate.value = fmtDateISO();

  filterDate && filterDate.addEventListener("change", refreshCurrentView);
  filterCourt && filterCourt.addEventListener("change", refreshCurrentView);
  filterStatus && filterStatus.addEventListener("change", refreshCurrentView);

  exportCsvBtn && exportCsvBtn.addEventListener("click", () => exportBookingsCsv(filterDate?.value || undefined));
  clearAllBtn &&
    clearAllBtn.addEventListener("click", () => {
      if (!confirm("Delete ALL bookings (for selected date if date chosen)? This is irreversible.")) return;
      deleteAllBookings(filterDate?.value || undefined).then(() => refreshCurrentView());
    });
  refreshBtn && refreshBtn.addEventListener("click", refreshCurrentView);

  // Sidebar views
  navInboxBtn && navInboxBtn.addEventListener("click", () => setActiveView("inbox"));
  navCalendarBtn && navCalendarBtn.addEventListener("click", () => setActiveView("calendar"));
  navAnalyticsBtn && navAnalyticsBtn.addEventListener("click", () => setActiveView("analytics"));
  navNotificationsBtn &&
    navNotificationsBtn.addEventListener("click", () => {
      setActiveView("notifications");
      if (notifBadge) notifBadge.classList.add("hidden");
    });

  // Inbox inner tabs
  function setInboxTab(tab) {
    currentInboxTab = tab;
    if (!tabBookingsBtn || !tabWaitlistBtn || !tabNotificationsInnerBtn) return;

    tabBookingsBtn.classList.remove("bg-slate-100", "text-slate-900", "font-medium", "shadow-sm");
    tabBookingsBtn.classList.add("bg-slate-800", "text-slate-200");
    tabWaitlistBtn.classList.remove("bg-slate-100", "text-slate-900", "font-medium", "shadow-sm");
    tabWaitlistBtn.classList.add("bg-slate-800", "text-slate-200");
    tabNotificationsInnerBtn.classList.remove("bg-slate-100", "text-slate-900", "font-medium", "shadow-sm");
    tabNotificationsInnerBtn.classList.add("bg-slate-800", "text-slate-200");

    if (tab === "bookings") {
      tabBookingsBtn.classList.add("bg-slate-100", "text-slate-900", "font-medium", "shadow-sm");
      tabBookingsBtn.classList.remove("bg-slate-800", "text-slate-200");
    } else if (tab === "waitlist") {
      tabWaitlistBtn.classList.add("bg-slate-100", "text-slate-900", "font-medium", "shadow-sm");
      tabWaitlistBtn.classList.remove("bg-slate-800", "text-slate-200");
    } else if (tab === "notifications") {
      tabNotificationsInnerBtn.classList.add("bg-slate-100", "text-slate-900", "font-medium", "shadow-sm");
      tabNotificationsInnerBtn.classList.remove("bg-slate-800", "text-slate-200");
    }

    refreshCurrentView();
  }

  tabBookingsBtn && tabBookingsBtn.addEventListener("click", () => setInboxTab("bookings"));
  tabWaitlistBtn && tabWaitlistBtn.addEventListener("click", () => setInboxTab("waitlist"));
  tabNotificationsInnerBtn &&
    tabNotificationsInnerBtn.addEventListener("click", () => setInboxTab("notifications"));

  // Notification bell → open notifications view
  notifBell &&
    notifBell.addEventListener("click", () => {
      setActiveView("notifications");
      if (notifBadge) notifBadge.classList.add("hidden");
    });

  // Notification actions
  markAllReadBtn &&
    markAllReadBtn.addEventListener("click", () => {
      if (!adminNotifs) return;
      adminNotifs.querySelectorAll("div").forEach((d) => {
        d.classList.add("opacity-70");
      });
      notifBadge && notifBadge.classList.add("hidden");
    });
  clearNotifsBtn &&
    clearNotifsBtn.addEventListener("click", () => {
      if (!adminNotifs) return;
      adminNotifs.innerHTML = "";
      notifBadge && notifBadge.classList.add("hidden");
    });

  // Default view
  setActiveView("inbox");
}

/* ---------- boot ---------- */
async function boot() {
  await loadSiteCfg();
  wireUI();
  await refreshCurrentView();
  toast("Admin panel loaded");
}

window.addEventListener("load", boot);
