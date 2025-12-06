// scripts/admin/requests.js
// Handles Inbox/Requests + Waitlist view & detail pane

import {
  $id,
  el,
  fmtDateISO,
  escapeHtml,
  toast,
  parseToDate,
  displayRangeForBooking,
  getCourtLabel,
  getCourtAmount,
  fetchBookings,
  fetchWishlists,
  convertWishlistToBooking,
  deleteWishlist,
  deleteBooking,
  cancelBooking,
  confirmBooking,
  deleteAllBookings,
  exportBookingsCsv,
  SITE_CFG
} from "./shared.js";

let currentInboxTab = "bookings"; // "bookings" | "waitlist" | "notifications"
let currentBookings = [];
let currentWaitlist = [];
let selectedId = null;
let selectedType = null;

// Cached DOM
let filterDate, filterCourt, filterStatus, exportCsvBtn, clearAllBtn, refreshBtn;
let bookingListEl, listTitleEl, listCountEl;
let detailTitleEl, detailSubtitleEl, detailBodyEl, detailStatusPillEl, detailApproveBtn, detailCancelBtn;
let tabBookingsBtn, tabWaitlistBtn, tabNotificationsInnerBtn;
let bizNameEl;

function cacheDom() {
  filterDate = $id("filterDate");
  filterCourt = $id("filterCourt");
  filterStatus = $id("filterStatus");
  exportCsvBtn = $id("exportCsv");
  clearAllBtn = $id("clearAll");
  refreshBtn = $id("refreshBtn");

  bookingListEl = $id("bookingList");
  listTitleEl = $id("listTitle");
  listCountEl = $id("listCount");

  detailTitleEl = $id("detailTitle");
  detailSubtitleEl = $id("detailSubtitle");
  detailBodyEl = $id("detailBody");
  detailStatusPillEl = $id("detailStatusPill");
  detailApproveBtn = $id("detailApprove");
  detailCancelBtn = $id("detailCancel");

  tabBookingsBtn = $id("tabBookings");
  tabWaitlistBtn = $id("tabWaitlist");
  tabNotificationsInnerBtn = $id("tabNotificationsInner");

  bizNameEl = $id("bizName");
}

/* ---------- Selection + detail helpers ---------- */

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
    detailApproveBtn.onclick = null;
  }
  if (detailCancelBtn) {
    detailCancelBtn.disabled = true;
    detailCancelBtn.textContent = "Cancel booking";
    detailCancelBtn.onclick = null;
  }
}

/* ---------- List renderers ---------- */

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

  clearSelectionUI(); // reset detail; click will re-select
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

  clearSelectionUI();
}

/* ---------- Detail pane ---------- */

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
    if (isConfirmed)
      pillClass =
        "text-[11px] px-2 py-1 rounded-full border border-emerald-500/60 bg-emerald-500/10 text-emerald-300";
    else if (isCancelled)
      pillClass =
        "text-[11px] px-2 py-1 rounded-full border border-rose-500/60 bg-rose-500/10 text-rose-300";
    else
      pillClass =
        "text-[11px] px-2 py-1 rounded-full border border-amber-500/60 bg-amber-500/10 text-amber-200";

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

/* ---------- Refresh Requests view ---------- */

export async function refreshCurrentView() {
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

/* ---------- UI wiring for Requests view ---------- */

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

export function initRequests() {
  cacheDom();

  if (filterDate && !filterDate.value) filterDate.value = fmtDateISO();

  filterDate && filterDate.addEventListener("change", refreshCurrentView);
  filterCourt && filterCourt.addEventListener("change", refreshCurrentView);
  filterStatus && filterStatus.addEventListener("change", refreshCurrentView);

  exportCsvBtn &&
    exportCsvBtn.addEventListener("click", () => exportBookingsCsv(filterDate?.value || undefined));
  clearAllBtn &&
    clearAllBtn.addEventListener("click", () => {
      if (!confirm("Delete ALL bookings (for selected date if date chosen)? This is irreversible.")) return;
      deleteAllBookings(filterDate?.value || undefined).then(() => refreshCurrentView());
    });
  refreshBtn && refreshBtn.addEventListener("click", refreshCurrentView);

  tabBookingsBtn && tabBookingsBtn.addEventListener("click", () => setInboxTab("bookings"));
  tabWaitlistBtn && tabWaitlistBtn.addEventListener("click", () => setInboxTab("waitlist"));
  tabNotificationsInnerBtn &&
    tabNotificationsInnerBtn.addEventListener("click", () => setInboxTab("notifications"));

  // default tab
  setInboxTab("bookings");
}
