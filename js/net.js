/* ======================================================
   GOBACHI — NETWORK LAYER (ALPHA)
   WebSocket chat + presence
====================================================== */

const SERVER_URL = "wss://gobachi-server.onrender.com";


let socket = null;
let reconnectTimer = null;

const listeners = {
  chat: [],
  presence: [],
  status: []
};

function emit(kind, payload) {
  (listeners[kind] || []).forEach(fn => {
    try { fn(payload); } catch (e) { console.error("listener error:", e); }
  });
}

export function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  emit("status", { state: "connecting" });

  try {
    socket = new WebSocket(SERVER_URL);
  } catch (err) {
    console.error("WebSocket ctor failed:", err);
    emit("status", { state: "error", error: String(err) });
    scheduleReconnect();
    return;
  }

  socket.addEventListener("open", () => {
    emit("status", { state: "open" });
  });

  socket.addEventListener("message", (evt) => {
    let data;
    try {
      data = JSON.parse(evt.data);
    } catch {
      data = { type: "chat", emoji: "⚙️", text: String(evt.data), system: true };
    }

    if (!data || !data.type) return;

    if (data.type === "chat") {
      emit("chat", data);
    } else if (data.type === "presence") {
      emit("presence", data.count ?? data);
    } else if (data.type === "system") {
      emit("chat", { emoji: "⚙️", text: data.text ?? "", system: true });
    }
  });

  socket.addEventListener("close", (evt) => {
    emit("status", { state: "closed", code: evt.code, reason: evt.reason });
    scheduleReconnect();
  });

  socket.addEventListener("error", (evt) => {
    console.error("ws error", evt);
    emit("status", { state: "error" });
    try { socket.close(); } catch {}
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 1500);
}

export function sendChat({ emoji, text }) {
  if (!text) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    emit("status", { state: "send_failed" });
    return;
  }
  socket.send(JSON.stringify({ type: "chat", emoji, text }));
}

export function onChat(fn) { listeners.chat.push(fn); }
export function onPresence(fn) { listeners.presence.push(fn); }
export function onStatus(fn) { listeners.status.push(fn); }
