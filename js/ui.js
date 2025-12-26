
/* ======================================================
   GOBACHI — UI LAYER
   Handles screens, rendering, interactions
   No persistence, no server, no rules
====================================================== */

import { getStarterPets, createPet } from "./pet.js";
import { connect, sendChat, onChat, onPresence } from "./net.js";
const createBtn = document.getElementById("create-pet");
const chatOverlay  = document.getElementById("chat-overlay");
const chatToggle   = document.getElementById("chat-toggle");
const chatMessages = document.getElementById("chat-messages");
const chatText     = document.getElementById("chat-text");
const chatSend     = document.getElementById("chat-send");



function setMeter(meterName, level) {
  const el = document.querySelector(`.meter[data-meter="${meterName}"]`);
  if (!el) return;

  el.setAttribute("data-level", level);
}




function renderChatEntry(msg) {
  const line = document.createElement("div");
  line.className = "chat-line";

  line.innerHTML = `
    <span class="chat-emoji">${msg.emoji}</span>
    <span>${msg.text}</span>
  `;
   if (msg.emoji === "🐣") {
  line.style.opacity = "0.8";
}


  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}



function toggleChat(open) {
  if (open) {
    document.body.classList.add("chat-open");
    chatOverlay.classList.remove("hidden");
    chatOverlay.classList.add("open");
    requestAnimationFrame(() => chatText.focus());
  } else {
    document.body.classList.remove("chat-open");
    chatOverlay.classList.remove("open");
    chatOverlay.classList.add("hidden");
  }
}



// TEMP: fake decay loop (testing only)
function startFakeDecay() {
  setInterval(() => {
    // decay needs only, very slowly
    if (fakeMeters.needs > 0) {
      fakeMeters.needs -= 1;
      setMeter("needs", fakeMeters.needs);
    }
  }, 15000); // 15 seconds per step (slow on purpose)
}

/* --------------------------------------
   DOM REFERENCES
-------------------------------------- */

const screens = {
  select: document.getElementById("pet-select"),
  pet: document.getElementById("pet-view"),
  grave: document.getElementById("grave-view")
};

const cradle = {
  left: document.querySelector(".pet-left"),
  center: document.querySelector(".pet-center"),
  right: document.querySelector(".pet-right"),
  dots: document.querySelector(".cradle-dots")
};

const petDisplay = document.getElementById("pet-display");
const graveDisplay = document.getElementById("grave-display");

const overlayAuth = document.getElementById("overlay-auth");
const overlayGrave = document.getElementById("overlay-grave");

/* --------------------------------------
   UI STATE
-------------------------------------- */

let starterEmojis = [];
let selectedIndex = 0;
let currentPet = null;
// TEMP: fake meter state (visual testing only)
let fakeMeters = {
  health: 4,
  needs: 4,
  mood: 4
};


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
   CRADLE RENDERING
-------------------------------------- */

function renderCradle() {
  const total = starterEmojis.length;

  const leftIndex = (selectedIndex - 1 + total) % total;
  const rightIndex = (selectedIndex + 1) % total;

  cradle.left.textContent = starterEmojis[leftIndex];
  cradle.center.textContent = starterEmojis[selectedIndex];
  cradle.right.textContent = starterEmojis[rightIndex];

  renderDots(total, selectedIndex);
}

function renderDots(total, activeIndex) {
  cradle.dots.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const dot = document.createElement("div");
    dot.textContent = i === activeIndex ? "●" : "○";
    cradle.dots.appendChild(dot);
  }
}

/* --------------------------------------
   CRADLE INTERACTION
-------------------------------------- */

function moveSelection(dir) {
  const total = starterEmojis.length;
  selectedIndex = (selectedIndex + dir + total) % total;
  renderCradle();
}

function selectPet() {
  const emoji = starterEmojis[selectedIndex];
  showAuthOverlay(emoji);
}

/* --------------------------------------
   AUTH OVERLAY (NAME + PASS)
-------------------------------------- */

function showAuthOverlay(emoji) {
  overlayAuth.classList.remove("hidden");
  overlayAuth.innerHTML = `
    <div class="overlay-content">
      <div style="font-size:64px; margin-bottom:12px;">${emoji}</div>

      <input id="pet-name" placeholder="name (4 letters)" />
      <input id="pet-pass" type="password" placeholder="password (6 chars)" />

      <div style="margin-top:12px;">
        <button id="auth-confirm">✔</button>
      </div>
    </div>
  `;

  document.getElementById("auth-confirm").onclick = () => {
    const name = document.getElementById("pet-name").value.trim();
    const pass = document.getElementById("pet-pass").value;

// name: letters only, at least 4
if (!/^[A-Za-z]{4,}$/.test(name)) return;

// password: at least 6 characters
if (pass.length < 6) return;


currentPet = createPet({
  emoji,
  name: name.toUpperCase(),
  password: pass
});

sendChat({
  emoji: "🐣",
  text: "a new pet was born"
});

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
  document.body.className = "state-happy";

  setMeter("health", fakeMeters.health);
  setMeter("needs", fakeMeters.needs);
  setMeter("mood", fakeMeters.mood);
}


/* --------------------------------------
   GRAVE VIEW
-------------------------------------- */

function showGrave(pet) {
  showScreen("grave");
  graveDisplay.textContent = "🪦";

  graveDisplay.onclick = () => {
    overlayGrave.classList.remove("hidden");
    overlayGrave.innerHTML = `
      <div class="overlay-content">
        <div style="font-size:48px;">🪦</div>
        <div style="margin-top:8px;">${pet.name}</div>
      </div>
    `;
  };
}

/* --------------------------------------
   INPUT (MOBILE-FIRST)
-------------------------------------- */

function bindInput() {
  cradle.left.onclick = () => moveSelection(-1);
  cradle.right.onclick = () => moveSelection(1);
  cradle.center.onclick = null;

}

/* --------------------------------------
   PUBLIC ENTRY POINT
-------------------------------------- */

export function startUI() {
  starterEmojis = getStarterPets();
  selectedIndex = 0;

  connect();
startFakeDecay();

onChat(entry => {
  renderChatEntry(entry);
});

onPresence(count => {
  const presenceEl = document.getElementById("presence");
  if (presenceEl) {
    presenceEl.textContent = `👤 ${count}`;
  }
});

   
   showScreen("select");
  renderCradle();
  bindInput();
   

if (createBtn) {
  createBtn.classList.remove("hidden");
  createBtn.onclick = () => selectPet();
}

let chatOpen = false;

chatToggle.onclick = () => {
  chatOpen = !chatOpen;
  toggleChat(chatOpen);
};



chatText.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    chatSend.click();
  }
});

chatSend.onclick = () => {
  if (!chatText.value.trim()) return;

  sendChat({
    emoji: currentPet ? currentPet.emoji : "👻",
    text: chatText.value.trim()
  });

  chatText.value = "";
  chatText.blur();
};



}
