/* ======================================================
   GOBACHI — PET MODEL
   Pure logic. No DOM. No UI.
====================================================== */

/* --------------------------------------
   PET EMOJI POOL
   "Anything that feels like a pet"
-------------------------------------- */

const PET_EMOJI_POOL = [
  // animals
  "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯",
  "🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🐤","🦆",
  "🦉","🦇","🐺","🦄","🐴","🐝","🦋","🐌","🐞","🐢",
  "🐍","🦎","🐙","🦑","🦀","🐠","🐟","🐡","🐬","🐳",

  // mythical / fantasy
  "🐉","🐲","🦄","🧚","🧞","🧜","👻","💀","🎃",

  // odd but pet-like
  "🌱","🍄","🌸","🔥","💧","🪨","⭐","🌙"
];

/* --------------------------------------
   UTILITIES
-------------------------------------- */

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function pickRandomUnique(source, count) {
  const pool = [...source];
  const picks = [];

  while (picks.length < count && pool.length > 0) {
    const idx = randomInt(pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }

  return picks;
}

/* --------------------------------------
   PET FACTORY
-------------------------------------- */

export function createPet({ emoji, name, password }) {
  return {
    id: crypto.randomUUID(),
    emoji,
    name,
    password,        // per-pet credential (server later)
    state: "alive",  // alive | dead | dismissed
    mood: "neutral", // happy | tired | neglect | dead
    bornAt: Date.now(),
    diedAt: null,

    /* ----------------------------
       State changes
    ---------------------------- */

    die() {
      this.state = "dead";
      this.mood = "dead";
      this.diedAt = Date.now();
    },

    dismiss() {
      this.state = "dismissed";
    }
  };
}

/* --------------------------------------
   STARTER SELECTION
-------------------------------------- */

export function getStarterPets() {
  // randomly pick 3 distinct pet emojis
  return pickRandomUnique(PET_EMOJI_POOL, 3);
}

/* --------------------------------------
   PET SERIALIZATION
-------------------------------------- */

export function serializePet(pet) {
  return JSON.stringify(pet);
}

export function deserializePet(json) {
  try {
    const data = JSON.parse(json);
    return data;
  } catch {
    return null;
  }
}
