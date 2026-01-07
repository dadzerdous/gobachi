/* ======================================================
   feedinggame.js — VISUAL GAME ENGINE
   Owns: Bowl movement, food physics, collision detection
   ====================================================== */
"use strict";

let bowlX = 50;
let bowlDir = 1;
let bowlSpeed = 0.5;
let bowlRAF = null;

export function startBowlMovement() {
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

export function stopBowlMovement() {
  cancelAnimationFrame(bowlRAF);
  bowlRAF = null;
}

export function spawnFoodPiece({ container, clientX, onResult, onBroadcast }) {
  const piece = document.createElement("div");
  piece.className = "food-piece";
  piece.textContent = "🍖";

  // Calculate X position
  const rect = container.getBoundingClientRect();
  const xPos = clientX ? Math.max(0, Math.min(rect.width, clientX - rect.left)) : rect.width / 2;
  piece.style.left = `${xPos}px`;
  piece.style.transform = "translateX(-50%)";

  container.appendChild(piece);

  // Measure for networking
  const pieceRect = piece.getBoundingClientRect();
  onBroadcast(pieceRect.left - rect.left, pieceRect.top - rect.top);

  const bowlArea = document.querySelector(".bowl-area");
  let resolved = false;

  function checkCollision() {
    if (resolved) return;
    const foodRect = piece.getBoundingClientRect();
    const bowlRect = bowlArea?.getBoundingClientRect();

    if (bowlRect && 
        foodRect.bottom >= bowlRect.top &&
        foodRect.top <= bowlRect.bottom &&
        foodRect.right >= bowlRect.left &&
        foodRect.left <= bowlRect.right) {
      resolved = true;
      onResult(true);
      piece.remove();
    } else {
      requestAnimationFrame(checkCollision);
    }
  }

  requestAnimationFrame(checkCollision);

  setTimeout(() => {
    if (!resolved) {
      resolved = true;
      onResult(false);
      piece.remove();
    }
  }, 2200);
}

export function bowlPop(success = true) {
  const bowl = document.querySelector(".bowl");
  if (!bowl) return;
  bowl.animate(
    [{ transform: "scale(1)" }, { transform: success ? "scale(1.25)" : "scale(0.9)" }, { transform: "scale(1)" }],
    { duration: 180, easing: "ease-out" }
  );
}
