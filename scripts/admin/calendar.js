// scripts/admin/calendar.js
// Handles Teams-style Calendar view

import {
  $id,
  fmtDateISO,
  escapeHtml,
  addDays,
  startOfWeek,
  startOfMonth,
  endOfMonth,
  sameDay,
  displayRangeForBooking,
  getCourtLabel,
  getCourtAmount,
  fetchBookingsRange
} from "./shared.js";

let calendarCourtSelect, calendarViewDayBtn, calendarViewWeekBtn, calendarViewMonthBtn;
let calendarPrevBtn, calendarNextBtn, calendarTodayBtn, calendarGridEl;

let calendarView = "week";          // "day" | "week" | "month"
let calendarBaseDate = new Date();  // anchor date
let calendarBookings = [];

function cacheDom() {
  calendarCourtSelect = $id("calendarCourt");
  calendarViewDayBtn = $id("calendarViewDay");
  calendarViewWeekBtn = $id("calendarViewWeek");
  calendarViewMonthBtn = $id("calendarViewMonth");
  calendarPrevBtn = $id("calendarPrev");
  calendarNextBtn = $id("calendarNext");
  calendarTodayBtn = $id("calendarToday");
  calendarGridEl = $id("calendarGrid");
}

function updateCalendarViewButtons() {
  if (!calendarViewDayBtn || !calendarViewWeekBtn || !calendarViewMonthBtn) return;

  const buttons = [calendarViewDayBtn, calendarViewWeekBtn, calendarViewMonthBtn];
  buttons.forEach((btn) => {
    btn.classList.remove("bg-slate-800", "text-slate-100");
    btn.classList.add("text-slate-300");
  });

  if (calendarView === "day") {
    calendarViewDayBtn.classList.add("bg-slate-800", "text-slate-100");
  } else if (calendarView === "week") {
    calendarViewWeekBtn.classList.add("bg-slate-800", "text-slate-100");
  } else if (calendarView === "month") {
    calendarViewMonthBtn.classList.add("bg-slate-800", "text-slate-100");
  }
}

function renderCalendarGrid(view, baseDate, startDate, endDate, bookings) {
  if (!calendarGridEl) return;

  calendarGridEl.className =
    "flex-1 min-h-0 rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden text-xs sm:text-sm text-slate-100 flex flex-col";

  const byDate = {};
  bookings.forEach((b) => {
    const key = b.date || "";
    if (!key) return;
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(b);
  });
  Object.values(byDate).forEach((arr) => {
    arr.sort(
      (a, b) =>
        (a.slotId || "").localeCompare(b.slotId || "") ||
        (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
    );
  });

  const today = new Date();
  let headerHtml = "";
  let bodyHtml = "";

  if (view === "day") {
    const iso = fmtDateISO(baseDate);
    const dayBookings = byDate[iso] || [];
    const label = baseDate.toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric"
    });

    headerHtml = `
      <div class="px-3 sm:px-4 py-2 border-b border-slate-800 flex items-center justify-between">
        <div class="flex flex-col">
          <span class="text-xs text-slate-400 uppercase tracking-wide">Day view</span>
          <span class="text-sm sm:text-base font-semibold">${label}</span>
        </div>
        <span class="text-[11px] text-slate-500">${dayBookings.length} bookings</span>
      </div>
    `;

    const cardsHtml = dayBookings
      .map((b) => {
        const range = displayRangeForBooking(b);
        const courtLabel = getCourtLabel(b.court || b.courtId || b.court_id || "");
        const status = b.status || "pending";
        const isConfirmed = status === "confirmed";
        const isCancelled = status === "cancelled";
        const amount = Number(b.amount || b.price || getCourtAmount(b.court) || 0);

        const statusClass = isConfirmed
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
          : isCancelled
          ? "bg-rose-500/15 text-rose-300 border-rose-500/40"
          : "bg-amber-500/15 text-amber-200 border-amber-500/40";

        return `
          <div class="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 flex flex-col gap-1">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="inline-flex items-center px-2 py-0.5 rounded-full border ${statusClass} text-[10px] font-medium">
                  ${escapeHtml(status.toUpperCase())}
                </span>
                <span class="text-xs sm:text-sm font-medium">${escapeHtml(range || "—")}</span>
              </div>
              <span class="text-xs sm:text-sm font-medium">₹${amount.toLocaleString("en-IN")}</span>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-1">
              <div class="text-[11px] sm:text-xs text-slate-300">
                ${escapeHtml(b.userName || b.name || "Guest")}
                ${
                  b.phone
                    ? `<span class="text-slate-500"> · ${escapeHtml(String(b.phone))}</span>`
                    : ""
                }
              </div>
              <div class="text-[11px] sm:text-xs text-slate-500">
                ${escapeHtml(courtLabel)} · ${escapeHtml(b.slotId || "")}
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    bodyHtml = `
      <div class="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-2">
        ${
          dayBookings.length
            ? cardsHtml
            : `<p class="text-xs sm:text-sm text-slate-500 text-center mt-6">No bookings for this day.</p>`
        }
      </div>
    `;

    calendarGridEl.innerHTML = headerHtml + bodyHtml;
    return;
  }

  const weekDaysRow = `
    <div class="grid grid-cols-7 border-b border-slate-800 bg-slate-900/80 text-[11px] sm:text-xs">
      ${Array.from({ length: 7 }).map((_, i) => {
        const d = addDays(startDate, i);
        const isToday = sameDay(d, today);
        const shortName = d.toLocaleDateString("en-IN", { weekday: "short" });
        const num = d.getDate();
        return `
          <div class="px-2 sm:px-3 py-2 border-r border-slate-800 last:border-r-0">
            <div class="flex flex-col items-start gap-0.5">
              <span class="uppercase tracking-wide ${isToday ? "text-emerald-300" : "text-slate-400"}">
                ${shortName}
              </span>
              <span class="text-xs sm:text-sm ${isToday ? "font-semibold text-emerald-200" : "text-slate-100"}">
                ${num}
              </span>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  if (view === "week") {
    headerHtml = `
      <div class="px-3 sm:px-4 py-2 border-b border-slate-800 flex items-center justify-between">
        <div class="flex flex-col">
          <span class="text-xs text-slate-400 uppercase tracking-wide">Week view</span>
          <span class="text-xs sm:text-sm text-slate-300">
            ${startDate.toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short"
            })} – ${endDate.toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: startDate.getFullYear() === endDate.getFullYear() ? undefined : "numeric"
            })}
          </span>
        </div>
        <span class="text-[11px] text-slate-500">${bookings.length} bookings</span>
      </div>
      ${weekDaysRow}
    `;

    const colsHtml = Array.from({ length: 7 })
      .map((_, i) => {
        const d = addDays(startDate, i);
        const iso = fmtDateISO(d);
        const dayBookings = byDate[iso] || [];

        const cards = dayBookings
          .map((b) => {
            const range = displayRangeForBooking(b);
            const courtLabel = getCourtLabel(b.court || b.courtId || b.court_id || "");
            const status = b.status || "pending";
            const isConfirmed = status === "confirmed";
            const isCancelled = status === "cancelled";
            const amount = Number(b.amount || b.price || getCourtAmount(b.court) || 0);

            const statusClass = isConfirmed
              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
              : isCancelled
              ? "bg-rose-500/15 text-rose-300 border-rose-500/40"
              : "bg-amber-500/15 text-amber-200 border-amber-500/40";

            return `
              <div class="mb-1.5 rounded-md border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
                <div class="flex items-center justify-between gap-1">
                  <span class="text-[11px] font-medium">${escapeHtml(range || "—")}</span>
                  <span class="inline-flex items-center px-1.5 py-0.5 rounded-full border ${statusClass} text-[9px]">
                    ${escapeHtml(status.toUpperCase())}
                  </span>
                </div>
                <div class="mt-0.5 text-[10px] text-slate-300 truncate">
                  ${escapeHtml(b.userName || b.name || "Guest")}
                </div>
                <div class="text-[10px] text-slate-500 truncate">
                  ${escapeHtml(courtLabel)} · ₹${amount.toLocaleString("en-IN")}
                </div>
              </div>
            `;
          })
          .join("");

        return `
          <div class="border-r border-slate-800 last:border-r-0 overflow-y-auto p-1.5 sm:p-2">
            ${
              dayBookings.length
                ? cards
                : `<p class="text-[10px] text-slate-600 mt-4 text-center">No bookings</p>`
            }
          </div>
        `;
      })
      .join("");

    bodyHtml = `
      <div class="flex-1 min-h-0 grid grid-cols-7 auto-rows-fr">
        ${colsHtml}
      </div>
    `;

    calendarGridEl.innerHTML = headerHtml + bodyHtml;
    return;
  }

  // Month view
  const firstOfMonth = startOfMonth(baseDate);
  const firstWeekStart = startOfWeek(firstOfMonth);
  const cells = Array.from({ length: 42 }).map((_, i) => addDays(firstWeekStart, i));

  headerHtml = `
    <div class="px-3 sm:px-4 py-2 border-b border-slate-800 flex items-center justify-between">
      <div class="flex flex-col">
        <span class="text-xs text-slate-400 uppercase tracking-wide">Month view</span>
        <span class="text-sm sm:text-base font-semibold">
          ${baseDate.toLocaleDateString("en-IN", {
            month: "long",
            year: "numeric"
          })}
        </span>
      </div>
      <span class="text-[11px] text-slate-500">${bookings.length} bookings</span>
    </div>
    ${weekDaysRow}
  `;

  const bodyCells = cells
    .map((d) => {
      const iso = fmtDateISO(d);
      const dayBookings = byDate[iso] || [];
      const isThisMonth = d.getMonth() === baseDate.getMonth();
      const isToday = sameDay(d, today);

      const dayLabelClasses = isThisMonth
        ? isToday
          ? "bg-emerald-500/20 text-emerald-100 border border-emerald-500/60"
          : "text-slate-100"
        : "text-slate-500";

      const cards = dayBookings
        .map((b) => {
          const range = displayRangeForBooking(b);
          const courtLabel = getCourtLabel(b.court || b.courtId || b.court_id || "");
          const status = b.status || "pending";
          const isConfirmed = status === "confirmed";
          const isCancelled = status === "cancelled";

          const statusDot = isConfirmed ? "bg-emerald-400" : isCancelled ? "bg-rose-400" : "bg-amber-300";

          return `
            <div class="flex items-center gap-1 mb-0.5">
              <span class="inline-block h-1.5 w-1.5 rounded-full ${statusDot}"></span>
              <span class="truncate text-[10px]">
                ${escapeHtml(range || "—")} · ${escapeHtml(courtLabel)}
              </span>
            </div>
          `;
        })
        .join("");

      return `
        <div class="border-b border-r border-slate-800 last:border-r-0 p-1.5 sm:p-2 flex flex-col min-h-0">
          <div class="flex items-center justify-between gap-1 mb-1">
            <span class="inline-flex items-center justify-center h-5 w-5 rounded-md text-[10px] sm:text-xs ${dayLabelClasses}">
              ${d.getDate()}
            </span>
            ${
              dayBookings.length
                ? `<span class="text-[10px] text-slate-500">${dayBookings.length}</span>`
                : ""
            }
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto">
            ${cards || `<p class="text-[10px] text-slate-700">—</p>`}
          </div>
        </div>
      `;
    })
    .join("");

  bodyHtml = `
    <div class="flex-1 min-h-0 grid grid-cols-7 auto-rows-fr">
      ${bodyCells}
    </div>
  `;

  calendarGridEl.innerHTML = headerHtml + bodyHtml;
}

export async function refreshCalendarView() {
  if (!calendarGridEl) return;

  let startDate, endDate;

  if (calendarView === "day") {
    startDate = new Date(calendarBaseDate);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(startDate);
  } else if (calendarView === "week") {
    startDate = startOfWeek(calendarBaseDate);
    endDate = addDays(startDate, 6);
  } else {
    startDate = startOfMonth(calendarBaseDate);
    endDate = endOfMonth(calendarBaseDate);
  }

  const startISO = fmtDateISO(startDate);
  const endISO = fmtDateISO(endDate);
  const court = calendarCourtSelect?.value || "";

  const bookings = await fetchBookingsRange(startISO, endISO, court || undefined);
  calendarBookings = bookings;

  renderCalendarGrid(calendarView, calendarBaseDate, startDate, endDate, bookings);
}

export function showCalendar() {
  updateCalendarViewButtons();
  refreshCalendarView();
}

export function initCalendar() {
  cacheDom();
  updateCalendarViewButtons();

  calendarCourtSelect &&
    calendarCourtSelect.addEventListener("change", () => {
      refreshCalendarView();
    });

  calendarViewDayBtn &&
    calendarViewDayBtn.addEventListener("click", () => {
      calendarView = "day";
      updateCalendarViewButtons();
      refreshCalendarView();
    });
  calendarViewWeekBtn &&
    calendarViewWeekBtn.addEventListener("click", () => {
      calendarView = "week";
      updateCalendarViewButtons();
      refreshCalendarView();
    });
  calendarViewMonthBtn &&
    calendarViewMonthBtn.addEventListener("click", () => {
      calendarView = "month";
      updateCalendarViewButtons();
      refreshCalendarView();
    });

  calendarTodayBtn &&
    calendarTodayBtn.addEventListener("click", () => {
      calendarBaseDate = new Date();
      refreshCalendarView();
    });

  calendarPrevBtn &&
    calendarPrevBtn.addEventListener("click", () => {
      if (calendarView === "day") {
        calendarBaseDate = addDays(calendarBaseDate, -1);
      } else if (calendarView === "week") {
        calendarBaseDate = addDays(calendarBaseDate, -7);
      } else if (calendarView === "month") {
        const d = new Date(calendarBaseDate);
        d.setMonth(d.getMonth() - 1);
        calendarBaseDate = d;
      }
      refreshCalendarView();
    });

  calendarNextBtn &&
    calendarNextBtn.addEventListener("click", () => {
      if (calendarView === "day") {
        calendarBaseDate = addDays(calendarBaseDate, 1);
      } else if (calendarView === "week") {
        calendarBaseDate = addDays(calendarBaseDate, 7);
      } else if (calendarView === "month") {
        const d = new Date(calendarBaseDate);
        d.setMonth(d.getMonth() + 1);
        calendarBaseDate = d;
      }
      refreshCalendarView();
    });
}
