/* ======================================================
   GOBACHI — UI LAYER
   Handles screens, rendering, interactions
   No persistence, no server, no rules
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
chatOverlay.addEventListener("click", (e) => {
  e.stopPropagation();
});

/* --------------------------------------
   UI STATE
-------------------------------------- */

let starterEmojis  = [];
let selectedIndex  = 0;
let currentPet     = null;
let chatOpen       = false;

// TEMP: visual-only meter state
let fakeMeters = {
  health: 4,
  needs:  4,
  mood:   4
};

/* --------------------------------------
   METERS
-------------------------------------- */

function setMeter(name, level) {
  const el = document.querySelector(`.meter[data-meter="${name}"]`);
  if (!el) return;
  el.setAttribute("data-level", level);
}
const actionRow = document.getElementById("action-row");
let activeMeter = null;

const ACTIONS_BY_METER = {
  needs: [
    { id: "feed", label: "🍖 Feed" },
    { id: "drink", label: "💧 Drink" },
    { id: "buy", label: "🛒 Buy" }
  ],
  mood: [
    { id: "play", label: "🎾 Play" },
    { id: "visit", label: "🫂 Visit" }
  ],
  health: [
    { id: "clean", label: "🛁 Clean" },
    { id: "rest", label: "😴 Rest" }
  ]
};
function bindMeterActions() {
  document.querySelectorAll(".meter").forEach(meter => {
    meter.onclick = (e) => {
      e.stopPropagation();
      showActionsFor(meter.dataset.meter);
    };
  });

  // clicking anywhere else closes the action row
  document.addEventListener("click", hideActionRow);
  actionRow.addEventListener("click", e => e.stopPropagation());
}

function showActionsFor(meterName) {
  // toggle off if same meter tapped
  if (activeMeter === meterName) {
    hideActionRow();
    return;
  }

  activeMeter = meterName;
  actionRow.innerHTML = "";

  const actions = ACTIONS_BY_METER[meterName] || [];
  for (const a of actions) {
    const btn = document.createElement("button");
    btn.textContent = a.label;
    btn.onclick = () => {
      // stub only — no logic yet
      console.log(`action: ${a.id}`);
      hideActionRow();
    };
    actionRow.appendChild(btn);
  }

  actionRow.classList.remove("hidden");
}

function hideActionRow() {
  activeMeter = null;
  actionRow.classList.add("hidden");
}

/* --------------------------------------
   CHAT
-------------------------------------- */

function renderChatEntry(msg) {
  const line = document.createElement("div");
  line.className = "chat-line";

  line.innerHTML = `
    <span class="chat-emoji">${msg.emoji}</span>
    <span>${msg.text}</span>
  `;

  if (msg.emoji === "🐣") line.style.opacity = "0.8";

  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function toggleChat(open) {
  chatOpen = open;

  if (open) {
    document.body.classList.add("chat-open");
    chatOverlay.classList.remove("hidden");
    requestAnimationFrame(() => chatText.focus());
  } else {
    document.body.classList.remove("chat-open");
    chatOverlay.classList.add("hidden");
  }
}

/* --------------------------------------
   FAKE DECAY (TESTING ONLY)
-------------------------------------- */

function startFakeDecay() {
  setInterval(() => {
    if (fakeMeters.needs > 0) {
      fakeMeters.needs -= 1;
      setMeter("needs", fakeMeters.needs);
    }
  }, 15000); // slow + gentle
}

/* --------------------------------------
   SCREEN CONTROL
-------------------------------------- */

function hideAllScreens() {
  Object.values(screens).forEach(s => s.classList.add("hidden"));
}

function showScreen(name) {
  hideAllScreens();
  screens[name].classList.remove("hidden");
}

/* --------------------------------------
   CRADLE
-------------------------------------- */

function renderDots(total, active) {
  cradle.dots.innerHTML = "";
  for (let i = 0; i < total; i++) {
    cradle.dots.appendChild(
      document.createTextNode(i === active ? "●" : "○")
    );
  }
}

function renderCradle() {
  const total = starterEmojis.length;

  cradle.left.textContent   = starterEmojis[(selectedIndex - 1 + total) % total];
  cradle.center.textContent = starterEmojis[selectedIndex];
  cradle.right.textContent  = starterEmojis[(selectedIndex + 1) % total];

  renderDots(total, selectedIndex);
}

function moveSelection(dir) {
  selectedIndex = (selectedIndex + dir + starterEmojis.length) % starterEmojis.length;
  renderCradle();
}

/* --------------------------------------
   AUTH OVERLAY
-------------------------------------- */

function showAuthOverlay(emoji) {
  overlayAuth.classList.remove("hidden");
  overlayAuth.innerHTML = `
    <div class="overlay-content">
      <div style="font-size:64px;margin-bottom:12px">${emoji}</div>
      <input id="pet-name" placeholder="name (4+ letters)" />
      <input id="pet-pass" type="password" placeholder="password (6+ chars)" />
      <button id="auth-confirm">✔</button>
    </div>
  `;

  document.getElementById("auth-confirm").onclick = () => {
    const name = document.getElementById("pet-name").value.trim();
    const pass = document.getElementById("pet-pass").value;

    if (!/^[A-Za-z]{4,}$/.test(name)) return;
    if (pass.length < 6) return;

    currentPet = createPet({
      emoji,
      name: name.toUpperCase(),
      password: pass
    });

    sendChat({ emoji: "🐣", text: "a new pet was born" });

    overlayAuth.classList.add("hidden");
    showPetView();
  };
}

/* --------------------------------------
   PET VIEW
-------------------------------------- */

function showPetView() {
  showScreen("pet");
  petDisplay.textContent = currentPet.emoji;

  setMeter("health", fakeMeters.health);
  setMeter("needs",  fakeMeters.needs);
  setMeter("mood",   fakeMeters.mood);

  bindMeterActions();
}


/* --------------------------------------
   INPUT
-------------------------------------- */

function bindInput() {
  cradle.left.onclick  = () => moveSelection(-1);
  cradle.right.onclick = () => moveSelection(1);
}

/* --------------------------------------
   ENTRY POINT
-------------------------------------- */

export function startUI() {
  starterEmojis = getStarterPets();
  selectedIndex = 0;

  connect();
  startFakeDecay();

  onChat(renderChatEntry);

  onPresence(count => {
    const el = document.getElementById("presence");
    if (el) el.textContent = `👤 ${count}`;
  });

  showScreen("select");
  renderCradle();
  bindInput();

  if (createBtn) {
    createBtn.classList.remove("hidden");
    createBtn.onclick = () => showAuthOverlay(starterEmojis[selectedIndex]);
  }


chatToggle.onclick = (e) => {
  e.stopPropagation();
  toggleChat(!chatOpen);
};

   chatOverlay.addEventListener("click", (e) => {
  e.stopPropagation();
});


  chatSend.onclick = () => {
    if (!chatText.value.trim()) return;

    sendChat({
      emoji: currentPet ? currentPet.emoji : "👻",
      text: chatText.value.trim()
    });

    chatText.value = "";
  };

  chatText.addEventListener("keydown", e => {
    if (e.key === "Enter") chatSend.click();
  });
}
