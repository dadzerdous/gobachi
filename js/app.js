
/* ======================================================
   GOBACHI — APPLICATION BOOTSTRAP
   Owns startup, global state, screen flow
====================================================== */

import { startUI } from "./ui.js";

/* --------------------------------------
   GLOBAL APP STATE (minimal for now)
-------------------------------------- */

const AppState = {
  started: false
};

/* --------------------------------------
   BOOT
-------------------------------------- */

function boot() {
  if (AppState.started) return;
  AppState.started = true;

  // Initial visual state
  document.body.className = "state-neutral";

  // Start UI layer
  startUI();

  // Debug (remove later if you want)
  console.log("🐣 Gobachi booted");
}

/* --------------------------------------
   DOM READY
-------------------------------------- */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
