// scripts/admin/main.js
// Entry point: boot, view switching, notifications view

import { $id, loadSiteCfg, toast } from "./shared.js";
import { initRequests } from "./requests.js";
import { initCalendar, showCalendar } from "./calendar.js";
import { initAnalytics } from "./analytics.js";

function setActiveView(view) {
  const viewTitleEl = $id("viewTitle");

  const sections = {
    inbox: $id("viewInbox"),
    calendar: $id("viewCalendar"),
    analytics: $id("viewAnalytics"),
    notifications: $id("viewNotifications")
  };

  const titles = {
    inbox: "Requests",
    calendar: "Calendar",
    analytics: "Analytics",
    notifications: "Notifications"
  };

  // Show/hide sections
  Object.entries(sections).forEach(([key, el]) => {
    if (!el) return;
    if (key === view) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });

  // Update heading
  if (viewTitleEl && titles[view]) {
    viewTitleEl.textContent = titles[view];
  }

  // Update nav buttons (sidebar + mobile) based on data-view
  const navButtons = document.querySelectorAll("[data-view]");
  navButtons.forEach((btn) => {
    const isActive = btn.dataset.view === view;
    if (isActive) {
      btn.classList.add("bg-brand-soft", "text-slate-900", "font-medium");
      btn.classList.remove("bg-transparent", "text-slate-700");
    } else {
      btn.classList.remove("bg-brand-soft", "text-slate-900", "font-medium");
      btn.classList.add("bg-transparent", "text-slate-700");
    }
  });

  // Calendar needs refresh when we land on it
  if (view === "calendar") {
    showCalendar();
  }
}

function initNav() {
  const notifBell = $id("notifBell");
  const notifBadge = $id("notifBadge");
  const adminNotifs = $id("adminNotifs");
  const markAllReadBtn = $id("markAllRead");
  const clearNotifsBtn = $id("clearNotifs");

  // All nav buttons (desktop sidebar + mobile tabs)
  const navButtons = document.querySelectorAll("[data-view]");
  navButtons.forEach((btn) => {
    const view = btn.dataset.view;
    if (!view) return;
    btn.addEventListener("click", () => setActiveView(view));
  });

  // Bell jumps to notifications
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
