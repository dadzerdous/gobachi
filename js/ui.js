/* ======================================================
   GOBACHI — UI LAYER
   Handles screens, rendering, interactions
====================================================== */
"use strict";

import { getStarterPets, createPet } from "./pet.js";
import { connect, sendChat, onChat, onPresence, onStatus } from "./net.js";
import { createFeedingSession } from "./feedingcore.js";

// New Extraction Import
import { 
  startBowlMovement, 
  stopBowlMovement, 
  spawnFoodPiece, 
  bowlPop,
  spawnGhostDrop, // <--- Add this
  spawnSpark      // <--- Add this
} from "./feedinggame.js";

/* --------------------------------------
   DOM REFERENCES
-------------------------------------- */
const petEmojiEl = document.getElementById("pet-emoji");
const feedingField = document.getElementById("feeding-field");
const createBtn    = document.getElementById("create-pet");
const chatOverlay  = document.getElementById("chat-overlay");
const chatToggle   = document.getElementById("chat-toggle");
const chatMessages = document.getElementById("chat-messages");
const chatText     = document.getElementById("chat-text");
const chatSend     = document.getElementById("chat-send");

const screens = {
  select: document.getElementById("pet-select"),
  pet:    document.getElementById("pet-view"),
  grave:  document.getElementById("grave-view")
};

const cradle = {
  left:   document.querySelector(".pet-left"),
  center: document.querySelector(".pet-center"),
  right:  document.querySelector(".pet-right"),
  dots:   document.querySelector(".cradle-dots")
};

const petDisplay   = document.getElementById("pet-display");
const graveDisplay = document.getElementById("grave-display");
const overlayAuth  = document.getElementById("overlay-auth");
const actionRow    = document.getElementById("action-row");

/* --------------------------------------
   UI STATE
-------------------------------------- */
let isFeeding = false;
let isFeedHost = false;
let feedingTimer = null;
let feedingSession = null;

let starterEmojis  = [];
let selectedIndex  = 0;
let currentPet     = null;

let chatState      = "min";
let chatHeaderBuilt = false;
let activeMeter    = null;

let feedingTotalDrops = 0;
let feedingDropsRemaining = 0;
let feedingHits = 0;
let feedingFinished = 0;

let lastLocalChat = { emoji: "", text: "", t: 0 };
let fakeMeters = { health: 4, needs: 4, mood: 4 };
let foodCount = 0;
const FOOD_MAX = 10;

let pointerHeld = false;
let lastDropClientX = null;
let dropInterval = null;
let feedingInputBound = false;
let fuseRAF = null;
let fuseStartTime = 0;

const feedJoinButtons = new Map();
const FEED_JOIN_MS = 15000;
const FEED_RESULTS_MS = 15000;
const FEEDING_TOTAL_DROPS = 50;
const DROP_INTERVAL_MS = 180;
const FEEDING_SESSION_MS = 8000;
const COOP_BONUS_PER_PLAYER = 5;
const COOP_BONUS_CAP = 15;

/* --------------------------------------
   HELPERS & FEEDBACK
-------------------------------------- */
function systemChat(text, emoji = "⚙️") {
  renderChatEntry({ emoji, text, system: true });
}

function flashButton(btn, kind = "neutral") {
  if (!btn) return;
  btn.classList.remove("btn-neutral", "btn-ok", "btn-bad");
  const cls = kind === "ok" ? "btn-ok" : kind === "bad" ? "btn-bad" : "btn-neutral";
  btn.classList.add(cls);
  setTimeout(() => btn.classList.remove(cls), 140);
}

function shakeElement(el) {
  if (!el) return;
  el.classList.add("shake");
  setTimeout(() => el.classList.remove("shake"), 180);
}

function flashPetCell(className) {
  const el = document.getElementById("pet-display");
  if (!el) return;
  el.classList.add(className);
  setTimeout(() => el.classList.remove(className), 220);
}

/* --------------------------------------
   CHAT UI
-------------------------------------- */
function setChatState(state) {
  chatState = state;
  if (!chatOverlay) return;
  chatOverlay.classList.remove("open", "min", "hidden");
  document.body.classList.remove("chat-open", "chat-min");

  if (state === "closed") {
    chatOverlay.classList.add("hidden");
  } else if (state === "max") {
    chatOverlay.classList.add("open");
    document.body.classList.add("chat-open");
  } else {
    chatOverlay.classList.add("min");
    document.body.classList.add("chat-min");
  }
}

function renderChatEntry(msg = {}) {
  if (!chatMessages) return;
  const emoji = msg.emoji ?? "👻";
  const text = msg.text ?? "";
  if (!text) return;

  const line = document.createElement("div");
  line.className = "chat-line" + (msg.system ? " system" : "");
  line.innerHTML = `<span class="chat-emoji">${emoji}</span><span class="chat-text">${text}</span>`;
  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/* --------------------------------------
   FEEDING SESSION LOGIC (NETWORKING)
-------------------------------------- */
function feedingOnPhase(phase, meta) {
  if (phase === "joining") {
    renderJoiners(meta.snapshot.caretakers);
    showPressPrompt(Math.max(0, Math.ceil((meta.snapshot.joinEndsAt - Date.now()) / 1000)));
    return;
  }
  if (phase === "active") {
    hidePressPrompt();
    disableAllFeedJoinButtons();
    showBowl();
    startBowlMovement(); // From feedinggame.js
    startFuse();
    if (pointerHeld) startDropping();
    return;
  }
  if (phase === "idle") {
    hideResultsOverlay();
    if (isFeeding) exitFeedingMode();
    feedingSession = null;
  }
}

function handleFeedSignals(msg) {
  const text = String(msg?.text || "");
  if (!text.startsWith("__feed_")) return false;

  if (text.startsWith("__feed_start__")) {
    const parts = text.split(":");
    showFeedJoinInvite({ key: parts[1], endsAt: Number(parts[2]), hostEmoji: parts[3] || "👻" });
    return true;
  }

  if (text.startsWith("__feed_join__")) {
    const key = text.split(":")[1];
    if (feedingSession && feedingSession.key === key) {
      feedingSession.join({ id: msg.id || msg.emoji, emoji: msg.emoji || "👻" });
      renderJoiners(feedingSession.snapshot().caretakers);
    }
    return true;
  }

  if (text.startsWith("__feed_drop__")) {
    const [, key, x, y, emoji] = text.split(":");
    if (!feedingSession || feedingSession.key !== key) return true;
    if (emoji !== (currentPet?.emoji || "👻")) {
      spawnGhostDrop({ x: Number(x), y: Number(y), emoji });
    }
    return true;
  }

  if (text.startsWith("__feed_begin__")) {
    const key = text.split(":")[1];
    if (feedingSession && feedingSession.key === key && feedingSession.snapshot().phase === "joining") {
      feedingSession.forceStart({ by: "host" });
    }
    return true;
  }
  return false;
}

/* --------------------------------------
   FEEDING GAMEPLAY (UI BINDING)
-------------------------------------- */
function dropOne() {
  if (!isFeeding || !feedingSession || feedingSession.snapshot().phase !== "active") return;
  if (feedingDropsRemaining <= 0) {
    stopDropping();
    return;
  }

  feedingDropsRemaining--;
  showFeedingFoodCount();

  // Call the Extracted Spawning Logic
  spawnFoodPiece({
    container: document.getElementById("pet-game"),
    clientX: lastDropClientX,
    onResult: (success) => {
      feedingSession.registerDrop({ success });
      feedingFinished++;
      if (success) {
        feedingHits++;
        bowlPop(true); // From feedinggame.js
        spawnSpark();
      } else {
        bowlPop(false);
      }
      if (feedingSession.isComplete()) resolveFeeding({ skipped: false });
    },
    onBroadcast: (x, y) => {
      sendChat({
        emoji: currentPet?.emoji || "👻",
        text: `__feed_drop__:${feedingSession.key}:${x}:${y}:${currentPet?.emoji || "👻"}`
      });
    }
  });
}

function startDropping() {
  if (!isFeeding || !feedingSession || feedingSession.snapshot().phase !== "active" || dropInterval) return;
  dropOne();
  dropInterval = setInterval(() => {
    if (!pointerHeld) { stopDropping(); return; }
    dropOne();
  }, DROP_INTERVAL_MS);
}

function stopDropping() {
  if (dropInterval) { clearInterval(dropInterval); dropInterval = null; }
}

function setupFeedingSession() {
  feedingTotalDrops = FEEDING_TOTAL_DROPS;
  feedingDropsRemaining = feedingTotalDrops;
  feedingHits = 0;
  feedingFinished = 0;

  feedingSession = createFeedingSession({
    joinMs: FEED_JOIN_MS,
    resultMs: FEED_RESULTS_MS,
    totalDrops: FEEDING_TOTAL_DROPS,
    coopBonusPerPlayer: COOP_BONUS_PER_PLAYER,
    coopBonusCap: COOP_BONUS_CAP,
    onPhase: feedingOnPhase,
    onJoinTick: (t) => { showPressPrompt(t.seconds); renderJoiners(t.snapshot.caretakers); },
    onResultsTick: (t) => updateResultsCountdown(t.seconds)
  });

  const hostEmoji = currentPet ? currentPet.emoji : "👻";
  feedingSession.startJoining({ hostId: "local", hostEmoji });
  sendChat({ emoji: "⚙️", text: `__feed_start__:${feedingSession.key}:${Date.now() + FEED_JOIN_MS}:${hostEmoji}` });
}

function resolveFeeding({ skipped }) {
  clearTimeout(feedingTimer);
  stopDropping();
  stopBowlMovement(); // From feedinggame.js
  
  if (!feedingSession) { exitFeedingMode(); return; }

  const results = feedingSession.getResults();
  const finalPercent = results.finalPercent;

  // Update visual meters
  const hungerGain = Math.round(finalPercent / 25);
  fakeMeters.needs = Math.min(4, fakeMeters.needs + hungerGain);
  setMeter("needs", fakeMeters.needs);

  showResultsOverlay({
    rating: finalPercent >= 100 ? "PERFECT" : finalPercent >= 75 ? "SUCCESS" : finalPercent >= 40 ? "NEUTRAL" : "FAIL",
    lines: [
      `caught ${results.hits}/${results.drops}`,
      `${results.players} caretakers (+${results.coopBonus}%)`
    ]
  });

  feedingSession.startResults();
  feedingField.addEventListener("pointerdown", () => {
    if (feedingSession?.snapshot().phase === "results") {
      feedingSession.end();
      exitFeedingMode();
    }
  }, { once: true });
}

/* --------------------------------------
   UI COMPONENT RENDERING
-------------------------------------- */
function showBowl() {
  const game = document.getElementById("pet-game");
  if (game) game.innerHTML = `<div class="bowl-area"><div class="bowl">🥣</div></div>`;
}

function startFuse() {
  const fuse = document.getElementById("fuse-bar") || document.createElement("div");
  fuse.id = "fuse-bar";
  document.getElementById("pet-game")?.appendChild(fuse);
  fuseStartTime = performance.now();
  const tick = (now) => {
    const pct = Math.max(0, 1 - (now - fuseStartTime) / FEEDING_SESSION_MS);
    fuse.style.transform = `scaleX(${pct})`;
    if (pct > 0 && isFeeding) fuseRAF = requestAnimationFrame(tick);
    else if (isFeeding) resolveFeeding({ skipped: false });
  };
  cancelAnimationFrame(fuseRAF);
  fuseRAF = requestAnimationFrame(tick);
}

function showPressPrompt(seconds) {
  let prompt = document.getElementById("press-prompt") || document.createElement("div");
  prompt.id = "press-prompt";
  if (!prompt.parentElement) feedingField.appendChild(prompt);
  prompt.textContent = seconds === null ? "PRESS" : `PRESS ${seconds}`;
}

function hidePressPrompt() { document.getElementById("press-prompt")?.remove(); }

function showFeedingFoodCount() {
  let counter = document.getElementById("feeding-food-count") || document.createElement("div");
  counter.id = "feeding-food-count";
  if (!counter.parentElement) feedingField.appendChild(counter);
  counter.textContent = `🍖 ${feedingDropsRemaining}`;
}

function enterFeedingMode() {
  isFeeding = true;
  petEmojiEl.style.display = "none";
  feedingField.classList.remove("hidden");
  showFeedingFoodCount();
  bindFeedingInputOnce();
}

function exitFeedingMode() {
  stopDropping();
  stopBowlMovement();
  isFeeding = false;
  petEmojiEl.style.display = "";
  feedingField.classList.add("hidden");
  document.getElementById("pet-game").innerHTML = "";
  hideResultsOverlay();
}

function bindFeedingInputOnce() {
  if (feedingInputBound) return;
  feedingInputBound = true;
  feedingField.addEventListener("pointerdown", (e) => {
    pointerHeld = true;
    lastDropClientX = e.clientX;
    if (isFeeding && feedingSession?.snapshot().phase === "joining" && isFeedHost) {
      feedingSession.forceStart({ by: "host" });
    }
    startDropping();
  });
  feedingField.addEventListener("pointermove", (e) => { if (pointerHeld) lastDropClientX = e.clientX; });
  feedingField.addEventListener("pointerup", () => { pointerHeld = false; stopDropping(); });
}

/* --------------------------------------
   INITIALIZATION & CORE UI
-------------------------------------- */
export function startUI() {
  connect();
  onChat((msg) => { if (!handleFeedSignals(msg)) renderChatEntry(msg); });
  onPresence((count) => { 
    const el = document.getElementById("presence");
    if (el) el.textContent = `👤 ${count}`;
  });

  starterEmojis = getStarterPets();
  renderCradle();
  
  if (createBtn) createBtn.onclick = () => showAuthOverlay(starterEmojis[selectedIndex]);
  if (chatToggle) chatToggle.onclick = () => setChatState(chatState === "min" ? "max" : "min");
  if (chatSend) chatSend.onclick = () => {
    const text = chatText.value.trim();
    if (!text) return;
    const emoji = currentPet ? currentPet.emoji : "👻";
    sendChat({ emoji, text });
    renderChatEntry({ emoji, text });
    chatText.value = "";
  };

  bindInput();
  bindMeterActions();
  showScreen("select");
}

// ... rest of boilerplate like renderCradle, showAuthOverlay, etc stays same ...
// Use existing implementations for showResultsOverlay, renderJoiners, etc.

function showScreen(name) {
  Object.values(screens).forEach(s => s?.classList.add("hidden"));
  screens[name]?.classList.remove("hidden");
}

function renderCradle() {
  const total = starterEmojis.length;
  const left = (selectedIndex - 1 + total) % total;
  const right = (selectedIndex + 1) % total;
  cradle.left.textContent = starterEmojis[left];
  cradle.center.textContent = starterEmojis[selectedIndex];
  cradle.right.textContent = starterEmojis[right];
}

function bindInput() {
  cradle.left.onclick = () => { selectedIndex = (selectedIndex - 1 + starterEmojis.length) % starterEmojis.length; renderCradle(); };
  cradle.right.onclick = () => { selectedIndex = (selectedIndex + 1) % starterEmojis.length; renderCradle(); };
}

function bindMeterActions() {
  document.querySelectorAll(".meter").forEach(m => {
    m.onclick = () => showActionsFor(m.dataset.meter);
  });
}

function showActionsFor(meter) {
  activeMeter = meter;
  actionRow.innerHTML = "";
  if (meter === "needs") {
    const btn = document.createElement("button");
    btn.textContent = "🍖 Feed";
    btn.onclick = () => {
      if (foodCount > 0) {
        foodCount--;
        isFeedHost = true;
        enterFeedingMode();
        setupFeedingSession();
      } else {
        systemChat("Bowl is empty");
      }
    };
    actionRow.appendChild(btn);
  }
  actionRow.classList.remove("hidden");
}

function setMeter(name, val) {
  const el = document.querySelector(`.meter[data-meter="${name}"]`);
  if (el) el.setAttribute("data-level", val);
}
