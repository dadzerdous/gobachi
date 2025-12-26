
/* ======================================================
   GOBACHI — NETWORK LAYER (ALPHA)
   WebSocket chat + presence
====================================================== */

const SERVER_URL = "wss://gobachi-server.onrender.com";

let socket = null;

const listeners = {
  chat: [],
  presence: []
};

export function connect() {
  socket = new WebSocket(SERVER_URL);

  socket.onopen = () => {
    console.log("🌐 connected to Gobachi server");
  };

  socket.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === "init") {
      if (msg.chat) {
        msg.chat.forEach(entry => {
          listeners.chat.forEach(fn => fn(entry));
        });
      }
      if (typeof msg.presence === "number") {
        listeners.presence.forEach(fn => fn(msg.presence));
      }
    }

    if (msg.type === "chat") {
      listeners.chat.forEach(fn => fn(msg.entry));
    }

    if (msg.type === "presence") {
      listeners.presence.forEach(fn => fn(msg.presence));
    }
  };

  socket.onclose = () => {
    console.log("❌ disconnected from server");
  };
}

export function sendChat({ emoji, text }) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify({
    type: "chat",
    emoji,
    text
  }));
}

export function onChat(fn) {
  listeners.chat.push(fn);
}

export function onPresence(fn) {
  listeners.presence.push(fn);
}
