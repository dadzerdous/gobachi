// ===============================================
// feedingcore.js — FEEDING SESSION STATE MACHINE
// Owns: phases, countdowns, caretakers, scoring
// UI should render based on callbacks + snapshots.
// ===============================================

"use strict";

function clampInt(n, min, max) {
  const x = Number.isFinite(n) ? Math.floor(n) : min;
  return Math.max(min, Math.min(max, x));
}

function makeKey() {
  // short enough to paste, unique enough for alpha
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

// phases: idle → joining → active → results → idle
export function createFeedingSession(opts = {}) {
  const joinMs = clampInt(opts.joinMs ?? 15000, 1000, 60000);
  const resultMs = clampInt(opts.resultMs ?? 15000, 1000, 60000);
  const totalDrops = clampInt(opts.totalDrops ?? 50, 1, 9999);
  const coopBonusPerPlayer = clampInt(opts.coopBonusPerPlayer ?? 5, 0, 50);
  const coopBonusCap = clampInt(opts.coopBonusCap ?? 15, 0, 300);

  const onPhase = typeof opts.onPhase === "function" ? opts.onPhase : null;
  const onJoinTick = typeof opts.onJoinTick === "function" ? opts.onJoinTick : null;
  const onResultsTick = typeof opts.onResultsTick === "function" ? opts.onResultsTick : null;

  const key = opts.key || makeKey();

  let phase = "idle";
  let host = { id: "local", emoji: "👻" };
  const caretakers = new Map(); // id -> { emoji }

  let hits = 0;
  let finished = 0;

  let joinEndsAt = 0;
  let resultsEndsAt = 0;
  let joinTimer = null;
  let resultsTimer = null;

  function snapshot() {
    return {
      key,
      phase,
      host: { ...host },
      caretakers: Array.from(caretakers.entries()).map(([id, v]) => ({ id, emoji: v.emoji })),
      caretakerCount: caretakers.size,
      totalDrops,
      hits,
      finished,
      dropsRemaining: Math.max(0, totalDrops - finished),
      joinEndsAt,
      resultsEndsAt
    };
  }

  function clearTimers() {
    if (joinTimer) {
      clearInterval(joinTimer);
      joinTimer = null;
    }
    if (resultsTimer) {
      clearInterval(resultsTimer);
      resultsTimer = null;
    }
  }

  function setPhase(next, meta = {}) {
    phase = next;
    if (onPhase) onPhase(next, { ...meta, snapshot: snapshot() });
  }

  function secondsLeft(msLeft) {
    return Math.max(0, Math.ceil(msLeft / 1000));
  }

  function startJoining({ hostId = "local", hostEmoji = "👻" } = {}) {
    clearTimers();

    host = { id: String(hostId || "local"), emoji: String(hostEmoji || "👻") };
    caretakers.clear();
    caretakers.set(host.id, { emoji: host.emoji });

    hits = 0;
    finished = 0;

    joinEndsAt = Date.now() + joinMs;
    resultsEndsAt = 0;

    setPhase("joining", { startedEarly: false });

    // tick every ~250ms for smooth countdown
    joinTimer = setInterval(() => {
      if (phase !== "joining") return;

      const msLeft = joinEndsAt - Date.now();
      if (msLeft <= 0) {
        forceStart({ by: "timeout" });
        return;
      }

      if (onJoinTick) {
        onJoinTick({
          seconds: secondsLeft(msLeft),
          snapshot: snapshot()
        });
      }
    }, 250);

    return snapshot();
  }

  function join({ id, emoji } = {}) {
    if (phase !== "joining") return false; // 🔒 no joining after start
    const keyId = String(id || "").trim();
    if (!keyId) return false;
    caretakers.set(keyId, { emoji: String(emoji || "👻") });
    return true;
  }

function forceStart({ by = "host" } = {}) {
  if (phase !== "joining") return false;

  // lock join phase
  joinEndsAt = 0;
  if (joinTimer) {
    clearInterval(joinTimer);
    joinTimer = null;
  }

  // phase change only — no gameplay privilege
  setPhase("active", { by });
  return true;
}
}

    setPhase("active", { startedEarly, by });
    return true;
  }

  function registerDrop({ success } = {}) {
    if (phase !== "active") return;
    finished++;
    if (success) hits++;
  }

  function isComplete() {
    return finished >= totalDrops;
  }

  function getBasePercent() {
    return totalDrops > 0 ? Math.round((hits / totalDrops) * 100) : 0;
  }

  function getFinalPercent() {
    const base = getBasePercent();
    const players = Math.max(1, caretakers.size);
    const coopBonus = Math.min(players * coopBonusPerPlayer, coopBonusCap);
    return base + coopBonus;
  }

  function getResults() {
    const players = Math.max(1, caretakers.size);
    const coopBonus = Math.min(players * coopBonusPerPlayer, coopBonusCap);
    const basePercent = getBasePercent();
    const finalPercent = basePercent + coopBonus;
    return {
      key,
      players,
      coopBonus,
      basePercent,
      finalPercent,
      hits,
      misses: Math.max(0, totalDrops - hits),
      drops: totalDrops,
      caretakers: Array.from(caretakers.entries()).map(([id, v]) => ({ id, emoji: v.emoji })),
      host: { ...host }
    };
  }

  function startResults() {
    clearTimers();
    resultsEndsAt = Date.now() + resultMs;
    setPhase("results", {});

    resultsTimer = setInterval(() => {
      if (phase !== "results") return;
      const msLeft = resultsEndsAt - Date.now();

      if (onResultsTick) {
        onResultsTick({
          seconds: secondsLeft(msLeft),
          snapshot: snapshot()
        });
      }

      if (msLeft <= 0) {
        end();
      }
    }, 250);
  }

  function end() {
    clearTimers();
    joinEndsAt = 0;
    resultsEndsAt = 0;
    setPhase("idle", {});
  }

  return {
    key,
    snapshot,
    startJoining,
    join,
    forceStart,
    registerDrop,
    isComplete,
    getResults,
    startResults,
    end
  };
}
