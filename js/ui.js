/* ======================================================
   GOBACHI — UI LAYER
   Handles screens, rendering, interactions
   No persistence, no server authority (yet)
====================================================== */

import { getStarterPets, createPet } from "./pet.js";
import { connect, sendChat, onChat, onPresence } from "./net.js";

/* --------------------------------------
   DOM REFERENCES
-------------------------------------- */

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
const overlayGrave = document.getElementById("overlay-grave");

const actionRow = document.getElementById("action-row");

/* --------------------------------------
   UI STATE
-------------------------------------- */
let isFeeding = false;
let feedingTimer = null;

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


function isSystemEmoji(emoji) {
  // style these as "system-like" messages
  return emoji === "⚙️" || emoji === "🐣" || emoji === "🍖";
}

function renderChatEntry(msg) {
  if (!chatMessages) return;

  const line = document.createElement("div");
  line.className = "chat-line";

  if (msg.system || isSystemEmoji(msg.emoji)) {
    line.classList.add("system");
  }

  line.innerHTML = `
    <span class="chat-emoji">${msg.emoji}</span>
    <span class="chat-text">${msg.text}</span>
  `;

  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
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
  setInterval(() => {
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
    petDisplay.textContent = currentPet.emoji;
  }

  // initialize meters (visual)
  setMeter("health", fakeMeters.health);
  setMeter("needs",  fakeMeters.needs);
  setMeter("mood",   fakeMeters.mood);

  // ensure action row is hidden when entering pet view
  hideActionRow();
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

  starterEmojis = getStarterPets();
  selectedIndex = 0;

  // Networking
  connect();

  onChat(renderChatEntry);

  onPresence(count => {
    const el = document.getElementById("presence");
    if (el) el.textContent = `👤 ${count}`;
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
      console.log("Chat button actually clicked!"); // <--- ADD THIS
      toggleChat(!chatOpen);
    };
  }

  if (chatSend) {
    chatSend.onclick = () => {
      if (!chatText || !chatText.value.trim()) return;

      // Player chat: send to server (broadcast)
      sendChat({
        emoji: currentPet ? currentPet.emoji : "👻",
        text: chatText.value.trim()
      });

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

  // Visual-only decay
  startFakeDecay();
}
// feeding

function startFeeding({ skip = false, isCommunity = false } = {}) {
  if (isFeeding) return;

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
  updateFoodUI();

  isFeeding = true;
setFeedButtonDisabled(true);


  systemChat(
    isCommunity
      ? "feeding has begun for the community pet"
      : "you place food in the bowl"
  );

  // TEMP: fake feeding session (3 seconds)
  feedingTimer = setTimeout(() => {
    if (skip) {
      resolveFeeding({
        percent: 30,
        players: 1,
        skipped: true
      });
    } else {
      // TEMP: random result until minigame exists
      const roll = Math.random();
      let result = "fail";
      if (roll > 0.9) result = "perfect";
      else if (roll > 0.6) result = "success";
      else if (roll > 0.3) result = "partial";

      resolveFeeding({
        percent: FEED_RESULTS[result],
        players: 1,
        skipped: false
      });
    }
  }, 3000);
}
function resolveFeeding({ percent, players, skipped }) {
  clearTimeout(feedingTimer);
  isFeeding = false;
   setFeedButtonDisabled(false);

  const coopBonus = Math.min(players * COOP_BONUS_PER_PLAYER, COOP_BONUS_CAP);
  const finalPercent = percent + coopBonus;

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

  // chat feedback
  if (skipped) {
    systemChat("feeding skipped — the pet eats a little");
  } else if (percent === 0) {
    systemChat("feeding failed — the pet turns away");
  } else {
    systemChat(
      `feeding complete — ${players} caretaker${players > 1 ? "s" : ""} helped (+${coopBonus}%)`
    );
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
