/* ======================================================
   GOBACHI — UI LAYER
   Handles screens, rendering, interactions
   No persistence, no server authority (yet)
====================================================== */
"use strict";

import { getStarterPets, createPet } from "./pet.js";
import { connect, sendChat, onChat, onPresence, onStatus } from "./net.js";
import { createFeedingSession } from "./feedingcore.js";

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

// Chat UI state: closed | min | max
let chatState = "closed";
let chatHeaderBuilt = false;

// de-dupe to avoid showing your own message twice if the server echoes it
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

const actionRow = document.getElementById("action-row");

/* --------------------------------------
   UI STATE
-------------------------------------- */
let isFeeding = false;
let feedingTimer = null;
let joinedFeedSessionId = null;
let activeFeedKey = null;

let starterEmojis  = [];
let selectedIndex  = 0;
let currentPet     = null;

let chatOpen       = false;
let activeMeter    = null;

// TEMP: visual-only meters (no rules yet)
let fakeMeters = {
  health: 4,
  needs:  4,
  mood:   4
};

let decayInterval = null;
let decayStarted = false;

// TEMP: food resource (local-only testing)
let foodCount = 0;
const FOOD_MAX = 10;

/* --------------------------------------
   MICRO FEEDBACK HELPERS
-------------------------------------- */

function shakeElement(el) {
  if (!el) return;
  el.classList.add("shake");
  setTimeout(() => el.classList.remove("shake"), 180);
}

// Button feedback: always show something on click.
// kind: "neutral" | "ok" | "bad"
function flashButton(btn, kind = "neutral") {
  if (!btn) return;

  btn.classList.remove("btn-neutral", "btn-ok", "btn-bad");

  const cls = kind === "ok" ? "btn-ok" : kind === "bad" ? "btn-bad" : "btn-neutral";
  btn.classList.add(cls);

  // allow repeated taps to retrigger
  setTimeout(() => btn.classList.remove(cls), 140);
}

// Background flash for stronger failures (noticeable)
function flashPetCell(className) {
  const el = document.getElementById("pet-display");
  if (!el) return;

  el.classList.add(className);
  setTimeout(() => el.classList.remove(className), 220);
}


/* --------------------------------------
   CHAT
-------------------------------------- */

// Local system message (UI-only).
// Later, community-pet system messages can be broadcast via sendChat(...) as needed.
function systemChat(text, emoji = "⚙️") {
  renderChatEntry({
    emoji,
    text,
    system: true
  });
}



function setChatState(state) {
  chatState = state;
  if (!chatOverlay) return;

  chatOverlay.classList.remove("open", "min");
  document.body.classList.remove("chat-open", "chat-min");

  if (state === "closed") {
    chatOverlay.classList.add("hidden");
    return;
  }

  chatOverlay.classList.remove("hidden");

  if (state === "max") {
    chatOverlay.classList.add("open");
    document.body.classList.add("chat-open");
  } else {
    chatOverlay.classList.add("min");
    document.body.classList.add("chat-min");
  }
}

function cycleChatState() {
  if (chatState === "closed") return setChatState("min");
  if (chatState === "min") return setChatState("max");
  return setChatState("closed");
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
  btnMin.type = "button";
  btnMin.className = "chat-hbtn";
  btnMin.title = "Minimize";
  btnMin.textContent = "—";
  btnMin.onclick = () => setChatState("min");

  const btnMax = document.createElement("button");
  btnMax.type = "button";
  btnMax.className = "chat-hbtn";
  btnMax.title = "Maximize";
  btnMax.textContent = "▢";
  btnMax.onclick = () => setChatState("max");

  const btnClose = document.createElement("button");
  btnClose.type = "button";
  btnClose.className = "chat-hbtn";
  btnClose.title = "Close";
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

function isSystemEmoji(emoji) {
  // style these as "system-like" messages
  return emoji === "⚙️" || emoji === "🐣" || emoji === "🍖";
}

function renderChatEntry(msg = {}) {
  if (!chatMessages) return;

  // Normalize incoming message
  const emoji =
    msg.emoji ??
    msg.senderEmoji ??
    "👻";

  const text =
    msg.text ??
    msg.message ??
    msg.msg ??
    "";

  if (!text) return;

  const line = document.createElement("div");
  line.className = "chat-line";

  if (msg.system) {
    line.classList.add("system");
  }

  line.innerHTML = `
    <span class="chat-emoji">${emoji}</span>
    <span class="chat-text">${text}</span>
  `;

  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}



// --------------------------------------
// FEED COOP SIGNALS (chat-driven)
// --------------------------------------
// Messages we broadcast:
//  __feed_start__:KEY:ENDS_AT_MS:HOST_EMOJI
//  __feed_join__:KEY
//  __feed_begin__:KEY
function feedingOnPhase(phase, meta) {
   console.log(
  "[feedingOnPhase]",
  phase,
  "key:",
  meta?.snapshot?.key,
  "isFeeding:",
  isFeeding
);

  if (phase === "joining") {
    renderJoiners(meta.snapshot.caretakers);
    showPressPrompt(secondsFromEndsAt(meta.snapshot.joinEndsAt));
    return;
  }

  if (phase === "active") {
      feedingTotalDrops = FEEDING_TOTAL_DROPS;
 feedingDropsRemaining = feedingTotalDrops;
 feedingHits = 0;
 feedingFinished = 0;
    hidePressPrompt();
    disableAllFeedJoinButtons();
    showBowl();
    startBowlMovement();
    startFuse();

    if (pointerHeld) startDropping();
    return;
  }

  if (phase === "results") {
    return;
  }

  if (phase === "idle") {
    hideResultsOverlay();
    if (isFeeding) exitFeedingMode();
    feedingSession = null;
  }
}

function handleFeedSignals(msg) {
  console.log(
    "[feed signal]",
    msg.text,
    "hasSession:",
    !!feedingSession,
    "phase:",
    feedingSession?.snapshot()?.phase,
    "isFeeding:",
    isFeeding
  );

  const text = String(msg?.text || "");
  if (!text.startsWith("__feed_")) return false;

  // ----------------------------------
  // FEED START (invite only)
  // ----------------------------------
  if (text.startsWith("__feed_start__")) {
    const parts = text.split(":");
    const key = parts[1];
    const endsAt = Number(parts[2]);
    const hostEmoji = parts[3] || "👻";
    if (!key || !Number.isFinite(endsAt)) return true;

    showFeedJoinInvite({ key, endsAt, hostEmoji });
    return true;
  }

  // ----------------------------------
  // FEED JOIN
  // ----------------------------------
  if (text.startsWith("__feed_join__")) {
    const parts = text.split(":");
    const key = parts[1];
    if (!key) return true;

    if (feedingSession && feedingSession.key === key) {
      feedingSession.join({
        id: msg.id || msg.emoji,
        emoji: msg.emoji || "👻"
      });
      renderJoiners(feedingSession.snapshot().caretakers);
    }

    return true;
  }
   if (text.startsWith("__feed_drop__")) {
  const [, key, x, y, emoji] = text.split(":");

  if (!feedingSession || feedingSession.key !== key) return true;
  if (msg.emoji === currentPet?.emoji) return true;


  spawnGhostDrop({
    x: Number(x),
    y: Number(y),
    emoji
  });

  return true;
}


  // ----------------------------------
  // FEED BEGIN (host started)
  // ----------------------------------
  if (text.startsWith("__feed_begin__")) {
    const key = text.split(":")[1];
    if (
      feedingSession &&
      feedingSession.key === key &&
      feedingSession.snapshot().phase === "joining"
    ) {
      feedingSession.forceStart({ by: "host" });
    }
    return true;
  }

  return false;
}

const feedingJoinHandlers = {
  onPhase: feedingOnPhase,
  onJoinTick(t) {
    showPressPrompt(t.seconds);
    renderJoiners(t.snapshot.caretakers);
  },
  onResultsTick(t) {
    updateResultsCountdown(t.seconds);
  }
};

function spawnGhostDrop({ x, y, emoji }) {
  const el = document.createElement("div");
  el.className = "ghost-drop";
  el.textContent = emoji;

  el.style.position = "absolute";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.opacity = "0.75";
  el.style.pointerEvents = "none";
  el.style.zIndex = "5";

  feedingField.appendChild(el);

  // TEMP: no animation yet
  setTimeout(() => {
    el.remove();
  }, 1000);
}




function showFeedJoinInvite({ key, endsAt, hostEmoji }) {
  if (!chatMessages) return;

  const line = document.createElement("div");
  line.className = "chat-line system";
  line.dataset.feedKey = key;

  const title = document.createElement("span");
  title.className = "chat-text";
  title.textContent = `${hostEmoji} started feeding — `;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "join-link";
  btn.textContent = "Join";
btn.onclick = () => {
   isFeedHost = false;
  if (btn.disabled) return;

  // Prevent re-joining or hosting while a session is active
  if (feedingSession && feedingSession.key === key) return;

   if (feedingSession && feedingSession.key === key && isFeeding) {
  btn.style.display = "none";
}


  const remainingJoinMs = Math.max(1000, endsAt - Date.now());

  // 1️⃣ Create the local session with full handlers
  feedingSession = createFeedingSession({
    joinMs: remainingJoinMs,
    resultMs: FEED_RESULTS_MS,
    totalDrops: FEEDING_TOTAL_DROPS,
    coopBonusPerPlayer: COOP_BONUS_PER_PLAYER,
    coopBonusCap: COOP_BONUS_CAP,
    ...feedingJoinHandlers
  });

  if (!feedingSession) {
    console.error("❌ Failed to create joiner feeding session");
    return;
  }

  // 2️⃣ Sync the host's session key (Crucial for signal matching)
  feedingSession.key = key;


   feedingTotalDrops = FEEDING_TOTAL_DROPS;
feedingDropsRemaining = feedingTotalDrops;
feedingHits = 0;
feedingFinished = 0;

   feedingSession.join({
  id: "local",
  emoji: currentPet ? currentPet.emoji : "👻"
});

  console.log(
    "[JOIN CLICK]",
    "created session",
    feedingSession.key,
    "phase:",
    feedingSession.snapshot().phase
  );

  // 3️⃣ Initialize local UI and start the joining phase
  enterFeedingMode();
  bindFeedingInputOnce();
  feedingSession.startJoining();

  // 4️⃣ Notify the host and network
  sendChat({
    emoji: currentPet ? currentPet.emoji : "👻",
    text: `__feed_join__:${key}`
  });

  btn.disabled = true;
  btn.textContent = "Joined";
};



  const timer = document.createElement("span");
  timer.className = "chat-text";
  timer.style.opacity = "0.8";
  timer.style.marginLeft = "6px";

  line.appendChild(document.createElement("span")); // keeps spacing consistent
  line.appendChild(title);
  line.appendChild(btn);
  line.appendChild(timer);
  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  feedJoinButtons.set(key, btn);

  // countdown
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    timer.textContent = `(${seconds})`;
    if (seconds <= 0) {
      disableFeedJoinButton(key);
      clearInterval(iv);
    }
  };
  tick();
  let iv;
iv = setInterval(tick, 1000);
}

function disableFeedJoinButton(key) {
  const btn = feedJoinButtons.get(key);
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add("disabled");
  btn.textContent = "Closed";
  feedJoinButtons.delete(key);
}

function toggleChat(open) {
  chatOpen = open;
  if (!chatOverlay) return;

  if (open) {
    document.body.classList.add("chat-open");
    chatOverlay.classList.remove("hidden");
    chatOverlay.classList.add("open"); // ADD THIS LINE
    requestAnimationFrame(() => chatText && chatText.focus());
  } else {
    document.body.classList.remove("chat-open");
    chatOverlay.classList.add("hidden");
    chatOverlay.classList.remove("open"); // ADD THIS LINE
  }
}

/* --------------------------------------
   METERS
-------------------------------------- */

function setMeter(name, level) {
  const el = document.querySelector(`.meter[data-meter="${name}"]`);
  if (!el) return;
  el.setAttribute("data-level", String(level));
}
function updateFoodUI() {
  // Update food count wherever it appears
  const resource = document.querySelector(".resource-count");
  if (resource) {
    resource.textContent = `🍖 x${foodCount}`;
  }
}
function setFeedButtonDisabled(disabled) {
  const btn = document.querySelector('.action-row button[data-action="feed"]');
  if (!btn) return;

  btn.disabled = disabled;
  btn.classList.toggle("disabled", disabled);
}
function showBowl() {
  const game = document.getElementById("pet-game");
  if (!game) return;

  game.innerHTML = `
    <div class="bowl-area">
      <div class="bowl">🥣</div>
    </div>
  `;
}
function bowlPop(success = true) {
  const bowl = document.querySelector(".bowl");
  if (!bowl) return;

  bowl.animate(
    [
      { transform: "scale(1)" },
      { transform: success ? "scale(1.25)" : "scale(0.9)" },
      { transform: "scale(1)" }
    ],
    {
      duration: 180,
      easing: "ease-out"
    }
  );

  if (success) spawnSpark();
}
let fuseRAF = null;
let fuseStartTime = 0;

function startFuse() {
  const game = document.getElementById("pet-game");
  if (!game) return;

  let fuse = document.getElementById("fuse-bar");
  if (!fuse) {
    fuse = document.createElement("div");
    fuse.id = "fuse-bar";
    game.appendChild(fuse);
  }

  fuseStartTime = performance.now();

  function tick(now) {
    const elapsed = now - fuseStartTime;
    const pct = Math.max(0, 1 - elapsed / FEEDING_SESSION_MS);

    fuse.style.transform = `scaleX(${pct})`;

    if (pct > 0 && isFeeding) {
      fuseRAF = requestAnimationFrame(tick);
    } else {
      endFeedingFromTimer();
    }
  }

  cancelAnimationFrame(fuseRAF);
  fuseRAF = requestAnimationFrame(tick);
}

function endFeedingFromTimer() {
  if (!isFeeding) return;

  resolveFeeding({ skipped: false });
}

function showPressPrompt(seconds = null) {
  // Render on feedingField so it survives bowl/game DOM wipes.
  if (!feedingField) return;

  let prompt = document.getElementById("press-prompt");
  if (!prompt) {
    prompt = document.createElement("div");
    prompt.id = "press-prompt";

    Object.assign(prompt.style, {
      position: "absolute",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "32px",
      fontWeight: "800",
      letterSpacing: "2px",
      color: "#fff",
      background: "rgba(0,0,0,0.35)",
      animation: "pulse 0.6s ease-in-out infinite",
      pointerEvents: "none",
      zIndex: 5
    });

    feedingField.appendChild(prompt);
  }

  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : null;
  prompt.textContent = s === null ? "PRESS" : `PRESS ${s}`;
}
function spawnSpark() {
  const game = document.getElementById("pet-game");
  const bowlArea = document.querySelector(".bowl-area");
  if (!game || !bowlArea) return;

  const spark = document.createElement("div");
  spark.textContent = "✨";
  spark.style.position = "absolute";
  spark.style.left = bowlArea.style.left || "50%";
  spark.style.bottom = "48px";
  spark.style.transform = "translateX(-50%)";
  spark.style.pointerEvents = "none";
  spark.style.fontSize = "18px";

  game.appendChild(spark);

  spark.animate(
    [
      { opacity: 1, transform: "translate(-50%, 0) scale(1)" },
      { opacity: 0, transform: "translate(-50%, -20px) scale(1.4)" }
    ],
    { duration: 300, easing: "ease-out" }
  );

  setTimeout(() => spark.remove(), 300);
}

function hidePressPrompt() {
  const prompt = document.getElementById("press-prompt");
  if (prompt) prompt.remove();
}

function hideBowl() {
  const game = document.getElementById("pet-game");
  if (!game) return;

  game.innerHTML = "";
}


function spawnFoodPiece(onResult) {
  const game = document.getElementById("pet-game");
  if (!game) return;

  const piece = document.createElement("div");
  piece.className = "food-piece";
  piece.textContent = "🍖";
// ---------------------------------------
// COOP: broadcast drop (visual-only)
// ---------------------------------------
if (
  feedingSession &&
  feedingSession.snapshot().phase === "active"
) {
const pieceRect = piece.getBoundingClientRect();
const fieldRect = feedingField.getBoundingClientRect();

const x = pieceRect.left - fieldRect.left;
const y = pieceRect.top - fieldRect.top;

sendChat({
  emoji: currentPet?.emoji || "👻",
  text: `__feed_drop__:${feedingSession.key}:${x}:${y}:${currentPet?.emoji || "👻"}`
});


}

if (lastDropClientX != null) {
  piece.style.left = getDropXFromClient(lastDropClientX);
  piece.style.transform = "translateX(-50%)";
} else {
  piece.style.left = "50%";
  piece.style.transform = "translateX(-50%)";
}


  game.appendChild(piece);
   const bowlArea = document.querySelector(".bowl-area");
let resolved = false;

function checkCollision() {
  if (!isFeeding || resolved) return;

  const foodRect = piece.getBoundingClientRect();
  const bowlRect = bowlArea.getBoundingClientRect();

  const overlap =
    foodRect.bottom >= bowlRect.top &&
    foodRect.top <= bowlRect.bottom &&
    foodRect.right >= bowlRect.left &&
    foodRect.left <= bowlRect.right;

  if (overlap) {
    resolved = true;
    onResult(true);
    piece.remove();
  } else {
    requestAnimationFrame(checkCollision);
  }
}

requestAnimationFrame(checkCollision);


  let caught = false;

  // auto-fail when it reaches bottom
setTimeout(() => {
  if (resolved) return;
  resolved = true;
  onResult(false);
  piece.remove();
}, 2200);
}

function showFeedingFoodCount() {
  if (!feedingField) return;

  let counter = document.getElementById("feeding-food-count");
  if (!counter) {
    counter = document.createElement("div");
    counter.id = "feeding-food-count";
    feedingField.appendChild(counter);
  }

  counter.textContent = `🍖 ${feedingDropsRemaining}`;
}

function hideFeedingFoodCount() {
  const counter = document.getElementById("feeding-food-count");
  if (counter) counter.remove();
}

function renderJoiners(caretakers) {
  if (!feedingField) return;

  let box = document.getElementById("feeding-joiners");
  if (!box) {
    box = document.createElement("div");
    box.id = "feeding-joiners";
    feedingField.appendChild(box);
  }

  const list = Array.isArray(caretakers) ? caretakers : [];
  // show up to 6, then +N
  const emojis = list.map(x => x.emoji).filter(Boolean);
  const show = emojis.slice(0, 6);
  const extra = Math.max(0, emojis.length - show.length);
  box.textContent = extra > 0 ? `${show.join(" ")} +${extra}` : show.join(" ");
}

function clearJoiners() {
  const box = document.getElementById("feeding-joiners");
  if (box) box.remove();
}

function disableAllFeedJoinButtons() {
  for (const btn of feedJoinButtons.values()) {
    if (!btn) continue;
    btn.disabled = true;
    btn.classList.add("disabled");
    btn.textContent = "Joined closed";
  }
  feedJoinButtons.clear();
}

// Results overlay helpers (15s, click-to-skip)
let resultsOverlay = null;

function showResultsOverlay({ rating, lines }) {
  if (!feedingField) return;

  if (!resultsOverlay) {
    resultsOverlay = document.createElement("div");
    resultsOverlay.id = "feeding-results";
    resultsOverlay.className = "feeding-stats show";
    resultsOverlay.innerHTML = `
      <div class="feeding-rating" id="feeding-rating"></div>
      <div class="feeding-lines" id="feeding-lines"></div>
      <div class="feeding-lines" id="feeding-results-timer" style="opacity:0.8"></div>
    `;
    feedingField.appendChild(resultsOverlay);
  }

  const ratingEl = document.getElementById("feeding-rating");
  const linesEl = document.getElementById("feeding-lines");
  if (ratingEl) ratingEl.textContent = rating;
  if (linesEl) linesEl.textContent = lines.join("\n");
}

function updateResultsCountdown(seconds) {
  const el = document.getElementById("feeding-results-timer");
  if (el) el.textContent = `tap to close (${seconds})`;
}

function hideResultsOverlay() {
  if (resultsOverlay) {
    resultsOverlay.remove();
    resultsOverlay = null;
  }
}
function getDropXFromClient(clientX) {
  const game = document.getElementById("pet-game");
  if (!game) return "50%";

  const rect = game.getBoundingClientRect();
  const x = clientX - rect.left;

  const clamped = Math.max(0, Math.min(rect.width, x));
  return `${clamped}px`;
}

/* --------------------------------------
   ACTION ROW (meter → actions)
-------------------------------------- */

const ACTIONS_BY_METER = {
  needs: [
    { id: "feed",  label: "🍖 Feed" },
    { id: "drink", label: "💧 Drink" },
    { id: "buy",   label: "🛒 Buy" }
  ],
  mood: [
    { id: "play",  label: "🎾 Play" },
    { id: "visit", label: "🫂 Visit" }
  ],
  health: [
    { id: "clean", label: "🛁 Clean" },
    { id: "rest",  label: "😴 Rest" }
  ]
};
const FEED_RESULTS = {
  fail: 0,
  partial: 40,
  success: 75,
  perfect: 100
};

const COOP_BONUS_PER_PLAYER = 5;
const COOP_BONUS_CAP = 15;


function updateNeedsResourceDisplay() {
  if (!actionRow) return;
  const el = actionRow.querySelector(".resource-count");
  if (!el) return;

  el.textContent = `🍖 x${foodCount}`;
}

function hideActionRow() {
  activeMeter = null;
  if (actionRow) actionRow.classList.add("hidden");
}

function showActionsFor(meterName) {
  if (!actionRow) return;
   if (isFeeding) return;


  // tap same meter toggles off
  if (activeMeter === meterName) {
    hideActionRow();
    return;
  }

  activeMeter = meterName;
  actionRow.innerHTML = "";

  // resource header (needs only)
  if (meterName === "needs") {
    const food = document.createElement("div");
    food.className = "resource-count";
    food.textContent = `🍖 x${foodCount}`;
    actionRow.appendChild(food);
  }

  const actions = ACTIONS_BY_METER[meterName] || [];

  for (const a of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = a.label;
     btn.dataset.action = a.id;

    btn.onclick = (e) => {
      // never let clicks bubble to "click-away close"
      e.stopPropagation();

      // ALWAYS show tactile feedback so buttons don't feel dead
      flashButton(btn, "neutral");
if (a.id === "feed") {
  if (isFeeding) return;
  startFeeding({ skip: false, isCommunity: false });
  return;
}



      // v0 behavior: only implement BUY success/failure
      if (a.id === "buy") {
        if (foodCount >= FOOD_MAX) {
          // fail: maxed out
          flashButton(btn, "bad");
          shakeElement(btn);
          flashPetCell("flash-bad");
          systemChat("you're at your current limit", "🍖");
          // action row stays open (by design)
          updateNeedsResourceDisplay();
          return;
        }

        // success
        foodCount += 1;
        flashButton(btn, "ok");
        systemChat("🍖 +1 food added", "🍖");
        updateNeedsResourceDisplay();
        return;
      }

      // stub: other actions not implemented yet
      systemChat(`(${a.id}) not wired yet`, "⚙️");
    };

    actionRow.appendChild(btn);
  }

  actionRow.classList.remove("hidden");
}

function bindMeterActions() {
  // meter click → show its action row
  document.querySelectorAll(".meter").forEach(meter => {
    meter.onclick = (e) => {
      e.stopPropagation();
      showActionsFor(meter.dataset.meter);
    };
  });

  // keep clicks inside action row from closing it
  if (actionRow) {
    actionRow.addEventListener("click", e => e.stopPropagation());
  }

  // click-away closes action row (but NOT when using the chat panel)
  document.addEventListener("click", (e) => {
    const clickedInside =
      e.target.closest(".meters") ||
      e.target.closest(".action-row") ||
      e.target.closest(".chat-panel"); // don't close when interacting with chat

    if (!clickedInside) hideActionRow();
  });
}

/* --------------------------------------
   FAKE DECAY (TESTING ONLY)
-------------------------------------- */

function startFakeDecay() {
  if (decayStarted) return;
  decayStarted = true;

  decayInterval = setInterval(() => {
    // gentle decay on needs (visual testing)
    if (fakeMeters.needs > 0) {
      fakeMeters.needs -= 1;
      setMeter("needs", fakeMeters.needs);
    }
  }, 15000);
}

/* --------------------------------------
   SCREEN CONTROL
-------------------------------------- */

function hideAllScreens() {
  Object.values(screens).forEach(s => s && s.classList.add("hidden"));
}

function showScreen(name) {
  hideAllScreens();
  if (screens[name]) screens[name].classList.remove("hidden");
}

/* --------------------------------------
   CRADLE (pet picker)
-------------------------------------- */

function renderDots(total, active) {
  cradle.dots.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const dot = document.createElement("div");
    dot.textContent = i === active ? "●" : "○";
    cradle.dots.appendChild(dot);
  }
}

function renderCradle() {
  const total = starterEmojis.length;
  if (!total) return;

  const leftIndex  = (selectedIndex - 1 + total) % total;
  const rightIndex = (selectedIndex + 1) % total;

  cradle.left.textContent   = starterEmojis[leftIndex];
  cradle.center.textContent = starterEmojis[selectedIndex];
  cradle.right.textContent  = starterEmojis[rightIndex];

  renderDots(total, selectedIndex);
}

function moveSelection(dir) {
  if (!starterEmojis.length) return;
  selectedIndex = (selectedIndex + dir + starterEmojis.length) % starterEmojis.length;
  renderCradle();
}

/* --------------------------------------
   AUTH OVERLAY (name + pass)
-------------------------------------- */

function showAuthOverlay(emoji) {
  if (!overlayAuth) return;

  overlayAuth.classList.remove("hidden");
  overlayAuth.innerHTML = `
    <div class="overlay-content">
      <div style="font-size:64px;margin-bottom:12px">${emoji}</div>
      <input id="pet-name" placeholder="name (4+ letters)" />
      <input id="pet-pass" type="password" placeholder="password (6+ chars)" />
      <button id="auth-confirm" type="button">✔</button>
    </div>
  `;

  const confirm = document.getElementById("auth-confirm");
  if (!confirm) return;

  confirm.onclick = () => {
    const name = (document.getElementById("pet-name")?.value || "").trim();
    const pass = (document.getElementById("pet-pass")?.value || "");

    // name: letters only, at least 4
    if (!/^[A-Za-z]{4,}$/.test(name)) {
      systemChat("name must be 4+ letters", "⚙️");
      return;
    }

    // pass: at least 6 characters
    if (pass.length < 6) {
      systemChat("password must be 6+ chars", "⚙️");
      return;
    }

    currentPet = createPet({
      emoji,
      name: name.toUpperCase(),
      password: pass
    });

    // local system msg for now
    systemChat("🐣 a new pet was born", "🐣");

    overlayAuth.classList.add("hidden");
    showPetView();
  };
}

/* --------------------------------------
   PET VIEW
-------------------------------------- */

function showPetView() {
  showScreen("pet");

  if (petDisplay && currentPet) {
    document.getElementById("pet-emoji").textContent = currentPet.emoji;

  }

  // initialize meters (visual)
  setMeter("health", fakeMeters.health);
  setMeter("needs",  fakeMeters.needs);
  setMeter("mood",   fakeMeters.mood);

  // ensure action row is hidden when entering pet view
  hideActionRow();

  // Start decay only after a pet exists / pet view is entered
  startFakeDecay();
}

/* --------------------------------------
   GRAVE VIEW (stub)
-------------------------------------- */

function showGrave(pet) {
  showScreen("grave");
  if (!graveDisplay) return;

  graveDisplay.textContent = "🪦";
  graveDisplay.onclick = () => {
    if (!overlayGrave) return;
    overlayGrave.classList.remove("hidden");
    overlayGrave.innerHTML = `
      <div class="overlay-content">
        <div style="font-size:48px;">🪦</div>
        <div style="margin-top:8px;">${pet?.name || "UNKNOWN"}</div>
      </div>
    `;
  };
}

/* --------------------------------------
   INPUT (mobile-first)
-------------------------------------- */

function bindInput() {
  if (cradle.left)  cradle.left.onclick  = () => moveSelection(-1);
  if (cradle.right) cradle.right.onclick = () => moveSelection(1);
}

/* --------------------------------------
   ENTRY POINT
-------------------------------------- */

export function startUI() {
   console.log("chatToggle:", chatToggle);
  ensureChatHeader();
  setChatState("min");

  starterEmojis = getStarterPets();
  selectedIndex = 0;

  // Networking
  connect();

  onChat((msg) => {
    const skip = handleFeedSignals(msg);
    if (!skip) {
      const now = Date.now();
      if (msg && msg.emoji === lastLocalChat.emoji && msg.text === lastLocalChat.text && (now - lastLocalChat.t) < 1200) {
        // ignore local echo duplicate
      } else {
        renderChatEntry(msg);
      }
    }
  });

  onStatus((st) => {
    console.log("[net status]", st);
  });

onPresence((payload) => {
  const el = document.getElementById("presence");
  if (!el) return;

const count =
  typeof payload === "number"
    ? payload
    : payload?.count ?? payload?.users ?? payload?.online;


  if (Number.isFinite(count)) {
    el.textContent = `👤 ${count}`;
  }
});



  // Screens
  showScreen("select");
  renderCradle();
  bindInput();

  // Click behaviors
  bindMeterActions();

  if (createBtn) {
    createBtn.classList.remove("hidden");
    createBtn.onclick = () => showAuthOverlay(starterEmojis[selectedIndex]);
  }
if (chatToggle) {
    chatToggle.onclick = () => {
      cycleChatState();
    };
  }

  if (chatSend) {
    chatSend.onclick = () => {
      if (!chatText || !chatText.value.trim()) return;

      // Player chat: send to server (broadcast)
      const emoji = currentPet ? currentPet.emoji : "👻";
      const text = chatText.value.trim();
      lastLocalChat = { emoji, text, t: Date.now() };
      renderChatEntry({ emoji, text });
      if (chatState === "closed") setChatState("min");
      sendChat({ emoji, text });
chatText.value = "";
    };
  }

  if (chatText) {
    chatText.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (chatSend) chatSend.click();
      }
    });
  }

}

// feeding
let bowlX = 50; // percent
let bowlDir = 1;
let bowlSpeed = 0.5; // tweak this
let bowlRAF = null;

// ----------------------------
// FEEDING SESSION (EXTRACTED)
// ----------------------------
let feedingSession = null;

let feedingTotalDrops = 0;
let feedingDropsRemaining = 0;
let feedingHits = 0;
let feedingFinished = 0;

let dropInterval = null;
let feedingInputBound = false;

let pointerHeld = false;
let lastDropClientX = null;
let activeCaretakers = new Set();

// invite/join UI in chat
const feedJoinButtons = new Map(); // key -> button element

const FEED_JOIN_MS = 15000;        // "PRESS" window / join window
const FEED_RESULTS_MS = 15000;     // results screen time
const FEEDING_TOTAL_DROPS = 50;
const DROP_INTERVAL_MS = 180;
const FEEDING_SESSION_MS = 8000;

function bindFeedingInputOnce() {
  if (feedingInputBound) return;
  feedingInputBound = true;

  // We bind to the feeding layer so mobile presses always register
  if (!feedingField) return;

  feedingField.addEventListener("pointerdown", (e) => {
    pointerHeld = true;
    lastDropClientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);


    // mobile reliability
    try { feedingField.setPointerCapture(e.pointerId); } catch {}

    // If we're still in join/press window, host click can force-start.
const snap = feedingSession.snapshot();

// Only the HOST may force-start
if (
  isFeeding &&
  feedingSession &&
  snap.phase === "joining" &&
  isFeedHost === true
) {
  feedingSession.forceStart({ by: "host" });
  return;
}



    startDropping();
  });

feedingField.addEventListener("pointermove", (e) => {
  if (!pointerHeld) return;
  lastDropClientX = e.clientX;

  // 👇 safety: ensure dropping continues while sliding
  if (!dropInterval) startDropping();
});

  feedingField.addEventListener("pointerup", (e) => {
    pointerHeld = false;
    try { feedingField.releasePointerCapture(e.pointerId); } catch {}
    stopDropping();
  });

  feedingField.addEventListener("pointerleave", () => {
    pointerHeld = false;
    stopDropping();
  });

  feedingField.addEventListener("pointercancel", () => {
    pointerHeld = false;
    stopDropping();
  });
}

function setupFeedingSession() {
  feedingTotalDrops = FEEDING_TOTAL_DROPS;
  feedingDropsRemaining = feedingTotalDrops;
  feedingHits = 0;
  feedingFinished = 0;

  activeCaretakers.clear();
  activeCaretakers.add("local");

  hideBowl();
  stopBowlMovement();

  // (re)create extracted session
  feedingSession = createFeedingSession({
    joinMs: FEED_JOIN_MS,
    resultMs: FEED_RESULTS_MS,
    totalDrops: FEEDING_TOTAL_DROPS,
    coopBonusPerPlayer: COOP_BONUS_PER_PLAYER,
    coopBonusCap: COOP_BONUS_CAP,

    onPhase(phase, meta) {
      if (phase === "joining") {
        // render press/join countdown
        renderJoiners(meta.snapshot.caretakers);
        showPressPrompt(secondsFromEndsAt(meta.snapshot.joinEndsAt));
        return;
      }

      if (phase === "active") {
        hidePressPrompt();
        disableAllFeedJoinButtons();

        // If host started early, broadcast the "started" system message.
        if (meta.startedEarly) {
          sendChat({
            emoji: "⚙️",
            text: `${meta.snapshot.host.emoji} started their feeding session`
          });
        }

        // tell others: joining is now closed
        sendChat({
          emoji: "⚙️",
          text: `__feed_begin__:${feedingSession.key}`
        });

        showBowl();
        startBowlMovement();
        startFuse();

        // If the pointer was already held during PRESS, begin dropping immediately.
        if (pointerHeld) startDropping();

        // hard stop timer (in addition to fuse)
        clearTimeout(feedingTimer);
        feedingTimer = setTimeout(() => {
          if (!isFeeding) return;
          resolveFeeding({ skipped: false });
        }, FEEDING_SESSION_MS);

        return;
      }

      if (phase === "results") {
        // countdown shown by onResultsTick
        return;
      }

      if (phase === "idle") {
        // Session ended (usually after results timeout)
        hideResultsOverlay();
        setFeedButtonDisabled(false);
        // If we're still in feeding UI, close it cleanly
        if (isFeeding) exitFeedingMode();
        feedingSession = null;
      }
    },

    onJoinTick(t) {
      showPressPrompt(t.seconds);
      renderJoiners(t.snapshot.caretakers);
    },

    onResultsTick(t) {
      updateResultsCountdown(t.seconds);
    }
  });

  // start join phase locally
  const hostEmoji = currentPet ? currentPet.emoji : "👻";
  feedingSession.startJoining({ hostId: "local", hostEmoji });

  // broadcast invite to others
  sendChat({
    emoji: "⚙️",
    text: `__feed_start__:${feedingSession.key}:${Date.now() + FEED_JOIN_MS}:${hostEmoji}`
  });
}

function secondsFromEndsAt(endsAt) {
  const ms = (endsAt || 0) - Date.now();
  return Math.max(0, Math.ceil(ms / 1000));
}



function dropOne() {
  if (!isFeeding || !feedingSession) return;
  if (feedingSession.snapshot().phase !== "active") return;

  if (feedingDropsRemaining <= 0) {
    stopDropping();
    return;
  }

  feedingDropsRemaining--;
  showFeedingFoodCount();

  spawnFoodPiece(success => {
    feedingSession.registerDrop({ success });

    feedingFinished++;
    if (success) feedingHits++;

    bowlPop(success);

    if (feedingSession.isComplete()) {
      resolveFeeding({ skipped: false });
    }
  });
}

function startDropping() {
  if (!isFeeding || !feedingSession) return;
  if (feedingSession.snapshot().phase !== "active") return;

  if (dropInterval) return;

  dropOne();
  dropInterval = setInterval(() => {
    if (!pointerHeld) {
      stopDropping();
      return;
    }
    dropOne();
  }, DROP_INTERVAL_MS);
}

function stopDropping() {
  if (dropInterval) {
    clearInterval(dropInterval);
    dropInterval = null;
  }
}

function enterFeedingMode() {
  isFeeding = true;

  // hide pet emoji
  petEmojiEl.style.display = "none";

  // show feeding layer
  feedingField.classList.remove("hidden");

  // ensure HUD bits exist immediately
  showFeedingFoodCount();
  renderJoiners([]);

  // disable action row (visible but inert)
  actionRow?.querySelectorAll("button").forEach(btn => {
    btn.disabled = true;
    btn.classList.add("disabled");
  });

}


function exitFeedingMode() {
  stopDropping();
  hidePressPrompt();
  hideFeedingFoodCount();
  clearJoiners();
  hideResultsOverlay();
  clearTimeout(feedingTimer);

  isFeeding = false;

  petEmojiEl.style.display = "";
  feedingField.classList.add("hidden");

  actionRow?.querySelectorAll("button").forEach(btn => {
    btn.disabled = false;
    btn.classList.remove("disabled");
  });

  stopBowlMovement();
  hideBowl();
}



function startBowlMovement() {
  const bowlArea = document.querySelector(".bowl-area");
  if (!bowlArea) return;

  function tick() {
    bowlX += bowlDir * bowlSpeed;

    if (bowlX >= 85) bowlDir = -1;
    if (bowlX <= 15) bowlDir = 1;

    bowlArea.style.left = bowlX + "%";
    bowlRAF = requestAnimationFrame(tick);
  }

  tick();
}



function stopBowlMovement() {
  cancelAnimationFrame(bowlRAF);
  bowlRAF = null;
}

function startFeeding({ skip = false, isCommunity = false } = {}) {
  if (isFeeding) return;
     isFeedHost = true; 

  if (foodCount <= 0) {
    systemChat("the bowl is empty");
    flashPetFail();
    return;
  }

  if (skip && isCommunity) {
    systemChat("this pet needs care — skipping is not allowed");
    return;
  }

  // consume food immediately
  foodCount--;
   isFeedHost = true;

  updateFoodUI();
enterFeedingMode();
bindFeedingInputOnce();
setupFeedingSession();

systemChat(
  isCommunity
    ? "feeding session opened for the community pet (15s)"
    : "feeding session opened (15s) — press to start"
);

}

function resolveFeeding({ skipped }) {
  clearTimeout(feedingTimer);
  stopDropping();

  // If we somehow end during join phase, just bail cleanly.
  if (!feedingSession) {
    setFeedButtonDisabled(false);
    exitFeedingMode();
    return;
  }

  // stop visuals before showing results
  stopBowlMovement();
  hideBowl();
  hidePressPrompt();
  hideFeedingFoodCount();
  clearJoiners();

  const results = feedingSession.getResults();
  const percent = results.basePercent;
  const finalPercent = results.finalPercent;
  const players = results.players;
  const coopBonus = results.coopBonus;
   const myScore = results.percent;

const avgScore = results.finalPercent;

  // hunger gain (simple scale for now)
  const hungerGain = Math.round(finalPercent / 25); // 0–4
  fakeMeters.needs = Math.min(4, fakeMeters.needs + hungerGain);
  setMeter("needs", fakeMeters.needs);

  // mood effects
  if (!skipped && percent === 0) {
    fakeMeters.mood = Math.max(0, fakeMeters.mood - 1);
    setMeter("mood", fakeMeters.mood);
    flashPetFail();
  } else {
    flashPetSuccess();
  }

  // On-screen rating (15s, tap to close)
  const rating = finalPercent >= FEED_RESULTS.perfect ? "PERFECT" :
                 finalPercent >= FEED_RESULTS.success ? "SUCCESS" :
                 finalPercent >= FEED_RESULTS.partial ? "NEUTRAL" :
                 "FAIL";

  const lines = [
  `you: ${myScore}%`,
  `average: ${avgScore}%`,
  `caught ${results.hits}/${results.drops}`,
  `${players} caretaker${players > 1 ? "s" : ""} (+${coopBonus}%)`
  ];

  showResultsOverlay({ rating, lines });

  // chat feedback
  if (skipped) {
    systemChat("feeding skipped — the pet eats a little");
  } else if (finalPercent === 0) {
    systemChat("feeding failed — the pet turns away");
  } else {
    systemChat(
      `feeding complete — ${players} caretaker${players > 1 ? "s" : ""} helped (+${coopBonus}%)`
    );
  }

  // Start results countdown; tap to skip.
  feedingSession.startResults();
  updateResultsCountdown(Math.ceil(FEED_RESULTS_MS / 1000));

  const clickToClose = () => {
    if (!feedingSession) return;
    if (feedingSession.snapshot().phase !== "results") return;
    feedingSession.end();
    cleanupAfterResults();
  };

  feedingField.addEventListener("pointerdown", clickToClose, { once: true });

  function cleanupAfterResults() {
    hideResultsOverlay();
    setFeedButtonDisabled(false);
    exitFeedingMode();
  }
}
function flashPetFail() {
  document.body.classList.add("pet-flash-fail");
  setTimeout(() => {
    document.body.classList.remove("pet-flash-fail");
  }, 300);
}

function flashPetSuccess() {
  document.body.classList.add("pet-flash-success");
  setTimeout(() => {
    document.body.classList.remove("pet-flash-success");
  }, 300);
}
