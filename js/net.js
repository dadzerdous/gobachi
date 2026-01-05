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
     console.log("[ws] connected");
  });

socket.addEventListener("message", (evt) => {
  console.log("[ws recv raw]", evt.data);

  let data;
  try {
    data = JSON.parse(evt.data);
  } catch {
    emit("chat", { emoji: "⚙️", text: String(evt.data), system: true });
    return;
  }

  if (!data) return;

  const type =
    data.type ||
    data.kind ||
    data.event ||
    data.t ||
    (data.presence != null ? "presence" : null) ||
    ((data.entry || data.emoji) ? "chat" : null);

  if (!type) return;

  if (type === "chat") {
    const entry = data.entry ?? data;

    emit("chat", {
      emoji: entry.emoji ?? "👻",
      text: entry.text ?? "",
      time: entry.time,
      system: entry.emoji === "⚙️"
    });
    return;
  }

  if (type === "presence") {
    const count =
      data.presence ??
      data.count ??
      data.online ??
      data.users;

    if (Number.isFinite(count)) {
      emit("presence", count);
    }
    return;
  }

  if (type === "system") {
    emit("chat", { emoji: "⚙️", text: data.text ?? "", system: true });
    return;
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
