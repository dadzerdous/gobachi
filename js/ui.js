/* ======================================================
   GOBACHI — UI LAYER
   Handles screens, rendering, interactions
====================================================== */
"use strict";

import { getStarterPets, createPet } from "./pet.js";
import { connect, sendChat, onChat, onPresence, onStatus } from "./net.js";
import { createFeedingSession } from "./feedingcore.js";

// ✅ Import visual game logic
import { 
  startBowlMovement, 
  stopBowlMovement, 
  spawnFoodPiece, 
  bowlPop,
  spawnGhostDrop,
  spawnSpark
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

let isFeedHost = false;

// Chat UI state
let chatState = "closed";
let chatHeaderBuilt = false;

let lastLocalChat = { emoji: "", text: "", t: 0 };
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
const overlayGrave = document.getElementById("overlay-grave");
const actionRow    = document.getElementById("action-row");

/* --------------------------------------
   UI STATE
-------------------------------------- */
let isFeeding = false;
let feedingTimer = null;
let feedingSession = null;

let starterEmojis  = [];
let selectedIndex  = 0;
let currentPet     = null;

let activeMeter    = null;

// Feeding State
let feedingTotalDrops = 0;
let feedingDropsRemaining = 0;
let feedingHits = 0;
let feedingFinished = 0;

let pointerHeld = false;
let lastDropClientX = null;
let dropInterval = null;
let feedingInputBound = false;
let fuseRAF = null;
let fuseStartTime = 0;

const feedJoinButtons = new Map();

// Constants
let fakeMeters = { health: 4, needs: 4, mood: 4 };
let foodCount = 0;
const FOOD_MAX = 10;
const FEED_JOIN_MS = 15000;
const FEED_RESULTS_MS = 15000;
const FEEDING_TOTAL_DROPS = 50;
const DROP_INTERVAL_MS = 180;
const FEEDING_SESSION_MS = 8000;
const COOP_BONUS_PER_PLAYER = 5;
const COOP_BONUS_CAP = 15;

/* --------------------------------------
   MICRO FEEDBACK HELPERS
-------------------------------------- */

function shakeElement(el) {
  if (!el) return;
  el.classList.add("shake");
  setTimeout(() => el.classList.remove("shake"), 180);
}

function flashButton(btn, kind = "neutral") {
  if (!btn) return;
  btn.classList.remove("btn-neutral", "btn-ok", "btn-bad");
  const cls = kind === "ok" ? "btn-ok" : kind === "bad" ? "btn-bad" : "btn-neutral";
  btn.classList.add(cls);
  setTimeout(() => btn.classList.remove(cls), 140);
}

function flashPetCell(className) {
  const el = document.getElementById("pet-display");
  if (!el) return;
  el.classList.add(className);
  setTimeout(() => el.classList.remove(className), 220);
}

/* --------------------------------------
   CHAT
-------------------------------------- */

function systemChat(text, emoji = "⚙️") {
  renderChatEntry({ emoji, text, system: true });
}

function ensureChatHeader() {
  if (chatHeaderBuilt) return;
  if (!chatOverlay) return;

  const panel = chatOverlay.querySelector(".chat-panel");
  if (!panel) return;

  const header = document.createElement("div");
  header.className = "chat-header";

  const left = document.createElement("div");
  left.className = "chat-header-left";
  left.textContent = "Chat";

  const right = document.createElement("div");
  right.className = "chat-header-right";

  const btnMin = document.createElement("button");
  btnMin.className = "chat-hbtn";
  btnMin.textContent = "—";
  btnMin.onclick = () => setChatState("min");

  const btnMax = document.createElement("button");
  btnMax.className = "chat-hbtn";
  btnMax.textContent = "▢";
  btnMax.onclick = () => setChatState("max");

  const btnClose = document.createElement("button");
  btnClose.className = "chat-hbtn";
  btnClose.textContent = "✕";
  btnClose.onclick = () => setChatState("closed");

  right.appendChild(btnMin);
  right.appendChild(btnMax);
  right.appendChild(btnClose);

  header.appendChild(left);
  header.appendChild(right);
  panel.insertBefore(header, panel.firstChild);
  chatHeaderBuilt = true;
}

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
   FEEDING SIGNALS & LOGIC
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
    startBowlMovement(); // ✅ From feedinggame.js
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
      spawnGhostDrop({ 
        x: Number(x), 
        y: Number(y), 
        emoji, 
        container: feedingField // ✅ Pass container
      });
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
   FEEDING GAMEPLAY LOOP
-------------------------------------- */

function dropOne() {
  if (!isFeeding || !feedingSession || feedingSession.snapshot().phase !== "active") return;
  if (feedingDropsRemaining <= 0) {
    stopDropping();
    return;
  }

  feedingDropsRemaining--;
  showFeedingFoodCount();

  spawnFoodPiece({
    container: document.getElementById("pet-game"),
    clientX: lastDropClientX,
    onResult: (success) => {
      feedingSession.registerDrop({ success });
      feedingFinished++;
      if (success) {
        feedingHits++;
        bowlPop(true);
        spawnSpark(document.getElementById("pet-game")); // ✅ Add spark back
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
  stopBowlMovement();
  
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
   FEEDING VISUALS (DOM)
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

function renderJoiners(caretakers) {
  let box = document.getElementById("feeding-joiners") || document.createElement("div");
  box.id = "feeding-joiners";
  if (!box.parentElement) feedingField.appendChild(box);

  const list = Array.isArray(caretakers) ? caretakers : [];
  const emojis = list.map(x => x.emoji).filter(Boolean);
  const show = emojis.slice(0, 6);
  const extra = Math.max(0, emojis.length - show.length);
  box.textContent = extra > 0 ? `${show.join(" ")} +${extra}` : show.join(" ");
}

function disableAllFeedJoinButtons() {
  for (const btn of feedJoinButtons.values()) {
    if (!btn) continue;
    btn.disabled = true;
    btn.textContent = "Closed";
  }
  feedJoinButtons.clear();
}

function showFeedJoinInvite({ key, endsAt, hostEmoji }) {
  const line = document.createElement("div");
  line.className = "chat-line system";
  const btn = document.createElement("button");
  btn.textContent = "Join";
  btn.className = "join-link";
  btn.onclick = () => {
    if (btn.disabled || (feedingSession && feedingSession.key === key)) return;
    
    isFeedHost = false;
    feedingSession = createFeedingSession({
      key, 
      joinMs: Math.max(1000, endsAt - Date.now()),
      resultMs: FEED_RESULTS_MS,
      totalDrops: FEEDING_TOTAL_DROPS,
      coopBonusPerPlayer: COOP_BONUS_PER_PLAYER,
      coopBonusCap: COOP_BONUS_CAP,
      onPhase: feedingOnPhase,
      onJoinTick: (t) => { showPressPrompt(t.seconds); renderJoiners(t.snapshot.caretakers); },
      onResultsTick: (t) => updateResultsCountdown(t.seconds)
    });

    const myEmoji = currentPet ? currentPet.emoji : "👻";
    feedingSession.startJoining({ hostId: hostEmoji, hostEmoji });
    feedingSession.join({ id: "local", emoji: myEmoji });
    enterFeedingMode();
    bindFeedingInputOnce();
    sendChat({ emoji: myEmoji, text: `__feed_join__:${key}` });

    btn.disabled = true;
    btn.textContent = "Joined";
  };
  
  line.innerHTML = `<span class="chat-text">${hostEmoji} started feeding — </span>`;
  line.appendChild(btn);
  chatMessages.appendChild(line);
  feedJoinButtons.set(key, btn);
}

function showResultsOverlay({ rating, lines }) {
  let overlay = document.getElementById("feeding-results") || document.createElement("div");
  overlay.id = "feeding-results";
  overlay.className = "feeding-stats show";
  overlay.innerHTML = `
    <div class="feeding-rating">${rating}</div>
    <div class="feeding-lines">${lines.join("<br>")}</div>
    <div id="feeding-results-timer" style="opacity:0.8; margin-top:8px"></div>
  `;
  if (!overlay.parentElement) feedingField.appendChild(overlay);
}

function updateResultsCountdown(seconds) {
  const el = document.getElementById("feeding-results-timer");
  if (el) el.textContent = `tap to close (${seconds})`;
}

function hideResultsOverlay() { document.getElementById("feeding-results")?.remove(); }

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
   SCREENS & INITIALIZATION
-------------------------------------- */

function showScreen(name) {
  Object.values(screens).forEach(s => s?.classList.add("hidden"));
  screens[name]?.classList.remove("hidden");
}

function renderCradle() {
  const total = starterEmojis.length;
  if (!total) return;
  const left = (selectedIndex - 1 + total) % total;
  const right = (selectedIndex + 1) % total;
  cradle.left.textContent = starterEmojis[left];
  cradle.center.textContent = starterEmojis[selectedIndex];
  cradle.right.textContent = starterEmojis[right];
  
  cradle.dots.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const dot = document.createElement("div");
    dot.textContent = i === selectedIndex ? "●" : "○";
    cradle.dots.appendChild(dot);
  }
}

function bindInput() {
  cradle.left.onclick = () => { selectedIndex = (selectedIndex - 1 + starterEmojis.length) % starterEmojis.length; renderCradle(); };
  cradle.right.onclick = () => { selectedIndex = (selectedIndex + 1) % starterEmojis.length; renderCradle(); };
}

function showAuthOverlay(emoji) {
  overlayAuth.classList.remove("hidden");
  overlayAuth.innerHTML = `
    <div class="overlay-content">
      <div style="font-size:64px;margin-bottom:12px">${emoji}</div>
      <input id="pet-name" placeholder="name (4+ letters)" />
      <input id="pet-pass" type="password" placeholder="password (6+ chars)" />
      <button id="auth-confirm" class="create-btn" type="button">✔ Confirm</button>
    </div>
  `;

  document.getElementById("auth-confirm").onclick = () => {
    const name = (document.getElementById("pet-name")?.value || "").trim();
    const pass = (document.getElementById("pet-pass")?.value || "");

    if (!/^[A-Za-z]{4,}$/.test(name)) { systemChat("name must be 4+ letters"); return; }
    if (pass.length < 6) { systemChat("password must be 6+ chars"); return; }

    currentPet = createPet({ emoji, name: name.toUpperCase(), password: pass });
    systemChat("🐣 a new pet was born", "🐣");
    overlayAuth.classList.add("hidden");
    
    // Switch to pet view
    showScreen("pet");
    if (petDisplay) document.getElementById("pet-emoji").textContent = currentPet.emoji;
    setMeter("health", fakeMeters.health);
    setMeter("needs", fakeMeters.needs);
    setMeter("mood", fakeMeters.mood);
  };
}

export function startUI() {
  ensureChatHeader(); // ✅ Restore chat header
  setChatState("min");

  starterEmojis = getStarterPets();
  selectedIndex = 0;
  
  connect();
  onChat((msg) => { if (!handleFeedSignals(msg)) renderChatEntry(msg); });
  onPresence((count) => { 
    const el = document.getElementById("presence");
    if (el) el.textContent = `👤 ${count}`;
  });

  // ✅ Make Create button visible
  if (createBtn) {
    createBtn.classList.remove("hidden");
    createBtn.onclick = () => showAuthOverlay(starterEmojis[selectedIndex]);
  }

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
  renderCradle(); // ✅ Ensure emojis render on load
}

function bindMeterActions() {
  document.querySelectorAll(".meter").forEach(m => {
    m.onclick = (e) => { e.stopPropagation(); showActionsFor(m.dataset.meter); };
  });
  document.addEventListener("click", () => actionRow.classList.add("hidden"));
}

function showActionsFor(meter) {
  activeMeter = meter;
  actionRow.innerHTML = "";
  actionRow.classList.remove("hidden");

  if (meter === "needs") {
    const res = document.createElement("div");
    res.className = "resource-count";
    res.textContent = `🍖 x${foodCount}`;
    actionRow.appendChild(res);

    const btn = document.createElement("button");
    btn.textContent = "Feed";
    btn.onclick = (e) => {
      e.stopPropagation();
      if (foodCount > 0) {
        foodCount--;
        isFeedHost = true;
        enterFeedingMode();
        setupFeedingSession();
      } else {
        shakeElement(btn);
        systemChat("Bowl is empty");
      }
    };
    actionRow.appendChild(btn);
    
    const buy = document.createElement("button");
    buy.textContent = "Buy (+1)";
    buy.onclick = (e) => {
      e.stopPropagation();
      if (foodCount < FOOD_MAX) {
        foodCount++;
        res.textContent = `🍖 x${foodCount}`;
        flashButton(buy, "ok");
      } else {
        flashButton(buy, "bad");
      }
    };
    actionRow.appendChild(buy);
  }
}

function setMeter(name, val) {
  const el = document.querySelector(`.meter[data-meter="${name}"]`);
  if (el) el.setAttribute("data-level", val);
}
