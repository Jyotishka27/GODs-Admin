// scripts/login.js
// Firebase v12 modular syntax — works with your CDN setup in index.html

import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import { getApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";

// Get Firebase App instance (initialized in index.html)
const app = getApp();
const auth = getAuth(app);

const loginForm = document.getElementById("loginForm");
const errorMsg = document.getElementById("errorMsg");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  // Hide any previous error
  errorMsg.classList.add("hidden");

  try {
    // Firebase sign-in
    await signInWithEmailAndPassword(auth, email, password);
    // Redirect to admin panel
    window.location.href = "./admin.html";
  } catch (error) {
    console.error("Login failed:", error.code, error.message);
    errorMsg.textContent = "Invalid credentials or user not found.";
    errorMsg.classList.remove("hidden");
  }
});
