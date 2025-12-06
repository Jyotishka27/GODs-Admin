// scripts/admin/main.js
// Entry point: boot, view switching, notifications view

import { $id, loadSiteCfg, toast } from "./shared.js";
import { initRequests } from "./requests.js";
import { initCalendar, showCalendar } from "./calendar.js";
import { initAnalytics } from "./analytics.js";

function setActiveView(view) {
  const viewTitleEl = $id("viewTitle");
  const viewInboxEl = $id("viewInbox");
  const viewCalendarEl = $id("viewCalendar");
  const viewAnalyticsEl = $id("viewAnalytics");
  const viewNotificationsEl = $id("viewNotifications");

  const navInboxBtn = $id("navInbox");
  const navCalendarBtn = $id("navCalendar");
  const navAnalyticsBtn = $id("navAnalytics");
  const navNotificationsBtn = $id("navNotifications");

  const map = {
    inbox: { el: viewInboxEl, btn: navInboxBtn, title: "Requests" },
    calendar: { el: viewCalendarEl, btn: navCalendarBtn, title: "Calendar" },
    analytics: { el: viewAnalyticsEl, btn: navAnalyticsBtn, title: "Analytics" },
    notifications: { el: viewNotificationsEl, btn: navNotificationsBtn, title: "Notifications" }
  };

  Object.entries(map).forEach(([k, obj]) => {
    const { el, btn, title } = obj;
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

  if (view === "calendar") {
    showCalendar();
  }
}

function initNav() {
  const navInboxBtn = $id("navInbox");
  const navCalendarBtn = $id("navCalendar");
  const navAnalyticsBtn = $id("navAnalytics");
  const navNotificationsBtn = $id("navNotifications");

  const notifBell = $id("notifBell");
  const notifBadge = $id("notifBadge");
  const adminNotifs = $id("adminNotifs");
  const markAllReadBtn = $id("markAllRead");
  const clearNotifsBtn = $id("clearNotifs");

  navInboxBtn && navInboxBtn.addEventListener("click", () => setActiveView("inbox"));
  navCalendarBtn && navCalendarBtn.addEventListener("click", () => setActiveView("calendar"));
  navAnalyticsBtn && navAnalyticsBtn.addEventListener("click", () => setActiveView("analytics"));
  navNotificationsBtn &&
    navNotificationsBtn.addEventListener("click", () => {
      setActiveView("notifications");
      if (notifBadge) notifBadge.classList.add("hidden");
    });

  notifBell &&
    notifBell.addEventListener("click", () => {
      setActiveView("notifications");
      if (notifBadge) notifBadge.classList.add("hidden");
    });

  // Notifications view controls
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
}

async function boot() {
  await loadSiteCfg();
  initRequests();
  initCalendar();
  initAnalytics();
  initNav();
  setActiveView("inbox");
  toast("Admin panel loaded");
}

window.addEventListener("load", boot);
