// scripts/admin.js
// Full admin script WITH WORKING NOTIFICATIONS

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
  runTransaction,
  orderBy,      // ← ADDED
  limit,        // ← ADDED
  onSnapshot,   // ← ADDED
  addDoc        // ← ADDED
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
const notifBell = $id("notifBell");           // ← ADDED
const notifBadge = $id("notifBadge");         // ← ADDED
const markAllReadBtn = $id("markAllRead");    // ← ADDED
const clearNotifsBtn = $id("clearNotifs");    // ← ADDED

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
  console.log(msg); // Always log to console
  if(adminNotifs){
    const p = el("div","p-1 text-sm");
    p.textContent = msg;
    p.style.color = err ? "#991b1b" : "#064e3b";
    adminNotifs.prepend(p);
    setTimeout(()=> p.remove(), 8000);
  }
}

/* ---------- ALL OTHER FUNCTIONS (time parsing, court labels, etc.) - SAME AS BEFORE ---------- */
// ... [Keep all your existing time parsing, court label, fetchBookings, render functions exactly as they are] ...

// [PASTE ALL YOUR EXISTING FUNCTIONS HERE - displayRangeForBooking, getCourtLabel, fetchBookings, etc.]

/* ---------- NOTIFICATIONS SYSTEM (IMPROVED) ---------- */
let unreadCount = 0;
let unsubscribeNotifs = null;

/* ---------- Fetch & render notifications ---------- */
async function fetchNotifications() {
  try {
    console.log("🔍 Fetching notifications...");
    const q = query(
      collection(db, "adminNotifications"), 
      orderBy("createdAt", "desc"), 
      limit(50)
    );
    const snap = await getDocs(q);
    const notifs = [];
    unreadCount = 0; // Reset counter
    
    snap.forEach(d => {
      const data = d.data();
      data._id = d.id;
      data.isRead = data.isRead || false;
      if (!data.isRead) unreadCount++;
      notifs.push(data);
    });
    
    console.log(`📬 Found ${notifs.length} notifications, ${unreadCount} unread`);
    return notifs;
  } catch (err) {
    console.error("❌ fetchNotifications err", err);
    return [];
  }
}

function renderNotifications(notifs) {
  console.log("🎨 Rendering notifications:", notifs.length);
  
  if (!adminNotifs) {
    console.warn("⚠️ adminNotifs element not found");
    return;
  }
  
  adminNotifs.innerHTML = "";
  if (!notifs.length) {
    adminNotifs.innerHTML = '<div class="text-gray-500 text-sm p-4 text-center">No notifications yet 🔔</div>';
    updateNotificationBadge(0);
    return;
  }

  notifs.forEach(n => {
    const div = el("div", "group bg-white p-4 rounded-xl border hover:shadow-md cursor-pointer transition-all flex gap-3");
    div.dataset.bookingId = n.bookingId || "";
    div.dataset.date = n.date || "";
    div.dataset.isRead = n.isRead ? "true" : "false";
    
    if (!n.isRead) {
      div.classList.add("ring-2", "ring-blue-200", "bg-blue-50");
    }
    
    const timeAgo = formatTimeAgo(n.createdAt);
    const icon = n.type === "booking" ? "📅" : n.type === "waitlist" ? "⏳" : "ℹ️";
    
    div.innerHTML = `
      <div class="flex-shrink-0 text-xl">${icon}</div>
      <div class="flex-1 min-w-0">
        <div class="font-medium text-sm mb-1 truncate">${escapeHtml(n.title || 'Notification')}</div>
        <div class="text-xs text-gray-500 mb-1">${escapeHtml(n.message || '')}</div>
        <div class="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
          <span>${escapeHtml(n.courtLabel || '')}</span>
          <span>${escapeHtml(n.date || '')} ${escapeHtml(n.timeRange || '')}</span>
          ${!n.isRead ? '<span class="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">New</span>' : ''}
        </div>
      </div>
      <div class="text-xs text-gray-400 flex items-center gap-1 flex-shrink-0">
        ${timeAgo}
      </div>
    `;
    
    div.addEventListener("click", () => handleNotificationClick(n));
    adminNotifs.appendChild(div);
  });
  
  updateNotificationBadge(unreadCount);
}

/* ---------- Real-time notifications listener ---------- */
function setupRealtimeNotifications() {
  if (unsubscribeNotifs) unsubscribeNotifs();
  
  console.log("🔔 Setting up real-time notifications...");
  unsubscribeNotifs = onSnapshot(
    collection(db, "adminNotifications"),
    (snap) => {
      console.log("🔥 Real-time notification update");
      fetchNotifications().then(renderNotifications);
    },
    (error) => {
      console.error("❌ Realtime listener error:", error);
    }
  );
}

/* ---------- Notification actions ---------- */
async function markNotificationRead(notifId) {
  try {
    await updateDoc(doc(db, "adminNotifications", notifId), { 
      isRead: true,
      readAt: serverTimestamp()
    });
    console.log("✅ Marked notification as read:", notifId);
  } catch (err) {
    console.error("❌ mark read failed", err);
  }
}

async function markAllRead() {
  try {
    const q = query(collection(db, "adminNotifications"), where("isRead", "==", false));
    const snap = await getDocs(q);
    if (snap.empty) {
      toast("No unread notifications");
      return;
    }
    
    const batch = writeBatch(db);
    snap.forEach(s => batch.update(s.ref, { 
      isRead: true, 
      readAt: serverTimestamp() 
    }));
    await batch.commit();
    unreadCount = 0;
    toast("Marked all as read");
  } catch (err) {
    console.error("❌ mark all read failed", err);
    toast("Failed to mark all read", true);
  }
}

async function clearAllNotifications() {
  if (!confirm("Delete ALL notifications?")) return;
  try {
    const q = collection(db, "adminNotifications");
    const snap = await getDocs(q);
    if (snap.empty) {
      toast("No notifications to clear");
      return;
    }
    
    const batch = writeBatch(db);
    snap.forEach(s => batch.delete(s.ref));
    await batch.commit();
    unreadCount = 0;
    toast(`Cleared ${snap.size} notifications`);
  } catch (err) {
    console.error("❌ clear notifications failed", err);
    toast("Failed to clear notifications", true);
  }
}

function updateNotificationBadge(count) {
  if (notifBadge) {
    notifBadge.classList.toggle("hidden", count === 0);
    notifBadge.textContent = count > 99 ? '99+' : count;
  }
  if (notifBell) {
    notifBell.title = count ? `View ${count} unread notifications` : "No new notifications";
  }
}

function formatTimeAgo(timestamp) {
  const now = new Date();
  const then = parseToDate(timestamp);
  if (!then) return "Unknown";
  
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  return `${diffDays}d`;
}

function handleNotificationClick(notif) {
  console.log("🖱️ Notification clicked:", notif);
  if (!notif.isRead) {
    markNotificationRead(notif._id);
  }
  
  if (notif.bookingId || notif.date) {
    document.getElementById("tabBookings").click();
    if (filterDate && notif.date) {
      filterDate.value = notif.date;
    }
    setTimeout(() => refreshCurrentView(), 100);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

/* ---------- TEST NOTIFICATION (run in console) ---------- */
window.createTestNotification = async function() {
  try {
    console.log("🧪 Creating test notification...");
    await addDoc(collection(db, "adminNotifications"), {
      type: "booking",
      title: "🆕 TEST - New Booking",
      message: "Test booking just created",
      bookingId: "TEST-" + Date.now(),
      date: fmtDateISO(),
      courtLabel: "Full Ground Football",
      timeRange: "6:00 PM – 7:00 PM",
      customerName: "Test User",
      amount: 2500,
      createdAt: serverTimestamp(),
      isRead: false
    });
    console.log("✅ Test notification created!");
  } catch (err) {
    console.error("❌ Test notification failed:", err);
  }
};

/* ---------- boot ---------- */
async function boot(){
  console.log("🚀 Booting admin panel...");
  
  await loadSiteCfg();
  wireUI();
  await refreshCurrentView();
  
  // Setup notifications
  await fetchNotifications().then(renderNotifications);
  setupRealtimeNotifications();
  
  // Notification UI wiring
  if (notifBell) notifBell.addEventListener("click", () => {
    console.log("🔔 Bell clicked");
    document.getElementById("tabNotifications").click();
  });
  if (markAllReadBtn) markAllReadBtn.addEventListener("click", markAllRead);
  if (clearNotifsBtn) clearNotifsBtn.addEventListener("click", clearAllNotifications);
  
  toast("✅ Admin loaded with notifications 🔔");
  console.log("🎉 Admin fully loaded. Run `createTestNotification()` in console to test!");
}

// Auto-boot
window.addEventListener("load", boot);
