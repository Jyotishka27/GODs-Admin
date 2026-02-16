// scripts/admin/analytics.js
// Analytics tab: weekly/monthly stats + charts using Firestore bookings

import {
  fmtDateISO,
  parseToDate,
  escapeHtml,
  addDays,
  startOfWeek,
  fetchBookingsRange,
  getCourtAmount,
  getCourtLabel,
  displayRangeForBooking,
  $id,
  toast
} from "./shared.js";

let revChartInstance = null;
let occChartInstance = null;
let courtChartInstance = null;
let weekdayChartInstance = null;

function destroyIfExists(chartInstance) {
  if (chartInstance && typeof chartInstance.destroy === "function") {
    chartInstance.destroy();
  }
}

/* ---------- Helpers for date ranges ---------- */

function getLastNDaysStart(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (n - 1));
  return d;
}

function isBetween(date, start, end) {
  return date >= start && date <= end;
}

/* ---------- Load + compute analytics ---------- */

async function loadAnalyticsData() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // We’ll look at last 90 days for analytics
  const startDate = getLastNDaysStart(90);
  const startISO = fmtDateISO(startDate);
  const endISO = fmtDateISO(today);

  const bookings = await fetchBookingsRange(startISO, endISO, undefined);

  const stats = {
    totalBookings: 0,
    totalRevenue: 0,
    monthBookings: 0,
    monthRevenue: 0,
    weekBookings: 0,
    weekRevenue: 0
  };

  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);

  // For charts
  const byDate = {}; // dateISO -> { revenue, count }
  const byHour = Array.from({ length: 24 }, () => 0);
  const byCourt = {}; // label -> count
  const byWeekday = Array.from({ length: 7 }, () => 0); // 0=Sun..6=Sat

  bookings.forEach((b) => {
    const amount = Number(b.amount || b.price || getCourtAmount(b.court)) || 0;

    // Parse booking date
    const dateStr = b.date || b.dateISO || "";
    const dateObj =
      parseToDate(dateStr) ||
      (dateStr ? new Date(`${dateStr}T00:00:00`) : null);

    if (!dateObj || Number.isNaN(dateObj.getTime())) {
      return;
    }

    const dateISO = fmtDateISO(dateObj);

    // Global totals
    stats.totalBookings += 1;
    stats.totalRevenue += amount;

    // Month stats
    if (dateObj.getFullYear() === currentYear && dateObj.getMonth() === currentMonth) {
      stats.monthBookings += 1;
      stats.monthRevenue += amount;
    }

    // Week stats (Mon–Sun)
    if (isBetween(dateObj, weekStart, weekEnd)) {
      stats.weekBookings += 1;
      stats.weekRevenue += amount;
    }

    // By date (for revenue line)
    if (!byDate[dateISO]) {
      byDate[dateISO] = { revenue: 0, count: 0 };
    }
    byDate[dateISO].revenue += amount;
    byDate[dateISO].count += 1;

    // By hour (for occupancy chart)
    let hour = null;
    const startCandidate =
      b.startISO || b.startAt || b.start || b.start_time || null;

    let startDateObj = startCandidate ? parseToDate(startCandidate) : null;

    if (!startDateObj) {
      // fallback: derive from displayRangeForBooking (e.g. "8:00 PM – 9:00 PM")
      const rangeLabel = displayRangeForBooking(b);
      if (rangeLabel && typeof rangeLabel === "string" && rangeLabel.includes("–")) {
        const firstPart = rangeLabel.split("–")[0].trim();
        const testDate = new Date(`2000-01-01 ${firstPart}`);
        if (!Number.isNaN(testDate.getTime())) {
          startDateObj = testDate;
        }
      }
    }

    if (startDateObj && !Number.isNaN(startDateObj.getTime())) {
      hour = startDateObj.getHours();
      if (hour >= 0 && hour <= 23) {
        byHour[hour] += 1;
      }
    }

    // Courts (by label)
    const courtLabel = getCourtLabel(b.court || b.courtId || b.court_id || "");
    const key = courtLabel || "Unknown";
    byCourt[key] = (byCourt[key] || 0) + 1;

    // Weekday distribution
    const weekday = dateObj.getDay(); // 0=Sun..6=Sat
    byWeekday[weekday] += 1;
  });

  return {
    stats,
    bookings,
    byDate,
    byHour,
    byCourt,
    byWeekday
  };
}

/* ---------- Render summary cards ---------- */

function renderSummary(stats) {
  const {
    totalBookings,
    totalRevenue,
    monthBookings,
    monthRevenue,
    weekBookings,
    weekRevenue
  } = stats;

  const totalBookingsEl = $id("analyticsTotalBookings");
  const totalRevenueEl = $id("analyticsTotalRevenue");
  const monthBookingsEl = $id("analyticsMonthBookings");
  const monthRevenueEl = $id("analyticsMonthRevenue");
  const weekBookingsEl = $id("analyticsWeekBookings");
  const weekRevenueEl = $id("analyticsWeekRevenue");

  if (totalBookingsEl) totalBookingsEl.textContent = totalBookings.toLocaleString("en-IN");
  if (totalRevenueEl) totalRevenueEl.textContent = `₹${totalRevenue.toLocaleString("en-IN")}`;

  if (monthBookingsEl) monthBookingsEl.textContent = monthBookings.toLocaleString("en-IN");
  if (monthRevenueEl) monthRevenueEl.textContent = `₹${monthRevenue.toLocaleString("en-IN")}`;

  if (weekBookingsEl) weekBookingsEl.textContent = weekBookings.toLocaleString("en-IN");
  if (weekRevenueEl) weekRevenueEl.textContent = `₹${weekRevenue.toLocaleString("en-IN")}`;
}

/* ---------- Render charts (Chart.js) ---------- */

function ensureChartJs() {
  if (typeof Chart === "undefined") {
    console.warn("Chart.js not found. Analytics charts will not render.");
    return false;
  }
  return true;
}

// Shared light-theme axis styling
const lightAxisOptions = {
  grid: {
    color: "#e5e7eb" // gray-200
  },
  ticks: {
    color: "#6b7280" // gray-500
  }
};

function renderRevenueLine(byDate) {
  if (!ensureChartJs()) return;

  const canvas = document.getElementById("revChart");
  if (!canvas) return;

  destroyIfExists(revChartInstance);

  // Last 30 days series
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = getLastNDaysStart(30);

  const labels = [];
  const values = [];

  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const iso = fmtDateISO(d);
    labels.push(iso);
    values.push(byDate[iso]?.revenue || 0);
  }

  const ctx = canvas.getContext("2d");
  revChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Revenue (₹)",
          data: values,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: false,
          labels: {
            color: "#4b5563" // gray-600
          }
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              if (!items.length) return "";
              const iso = items[0].label;
              const d = new Date(iso);
              if (Number.isNaN(d.getTime())) return iso;
              return d.toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short"
              });
            }
          }
        }
      },
      scales: {
        x: {
          ...lightAxisOptions,
          ticks: {
            ...lightAxisOptions.ticks,
            callback: function (val, idx) {
              // Show fewer labels for readability
              if (labels.length > 15 && idx % 2 !== 0) return "";
              const iso = labels[idx];
              const d = new Date(iso);
              if (Number.isNaN(d.getTime())) return iso.slice(5); // Fallback "MM-DD"
              return d.toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short"
              });
            }
          }
        },
        y: {
          ...lightAxisOptions
        }
      }
    }
  });
}

function renderHourlyOccupancy(byHour) {
  if (!ensureChartJs()) return;

  const canvas = document.getElementById("occChart");
  if (!canvas) return;

  destroyIfExists(occChartInstance);

  const labels = Array.from({ length: 24 }, (_, h) =>
    String(h).padStart(2, "0") + ":00"
  );

  const ctx = canvas.getContext("2d");
  occChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Bookings",
          data: byHour
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: false,
          labels: {
            color: "#4b5563"
          }
        }
      },
      scales: {
        x: {
          ...lightAxisOptions
        },
        y: {
          ...lightAxisOptions
        }
      }
    }
  });
}

function renderCourtShare(byCourt) {
  if (!ensureChartJs()) return;

  const canvas = document.getElementById("courtChart");
  if (!canvas) return;

  destroyIfExists(courtChartInstance);

  const labels = Object.keys(byCourt);
  const values = Object.values(byCourt);

  if (!labels.length) return;

  const ctx = canvas.getContext("2d");
  courtChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#4b5563",
            boxWidth: 10
          }
        }
      }
    }
  });
}

function renderWeekdayDistribution(byWeekday) {
  if (!ensureChartJs()) return;

  const canvas = document.getElementById("weekdayChart");
  if (!canvas) return;

  destroyIfExists(weekdayChartInstance);

  // 0=Sun..6=Sat
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const ctx = canvas.getContext("2d");
  weekdayChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Bookings",
          data: byWeekday
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: false,
          labels: {
            color: "#4b5563"
          }
        }
      },
      scales: {
        x: {
          ...lightAxisOptions
        },
        y: {
          ...lightAxisOptions
        }
      }
    }
  });
}

/* ---------- Public API ---------- */

export async function refreshAnalytics() {
  try {
    const { stats, byDate, byHour, byCourt, byWeekday } = await loadAnalyticsData();
    renderSummary(stats);
    renderRevenueLine(byDate);
    renderHourlyOccupancy(byHour);
    renderCourtShare(byCourt);
    renderWeekdayDistribution(byWeekday);
  } catch (e) {
    console.error("Analytics refresh failed", e);
    toast("Failed to load analytics", true);
  }
}

import { exportBookingsExcel } from "./shared.js";

export async function initAnalytics() {
  await refreshAnalytics();

  const downloadBtn = document.getElementById("downloadExcelBtn");

  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      exportBookingsExcel();
    });
  }
}

