(function () {
  "use strict";

  const base = document.body.dataset.base || "";
  const messages = document.getElementById("messages");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("message-input");
  const button = document.getElementById("send-button");

  // crypto.randomUUID() only works over HTTPS, so build the id by hand.
  function newSessionId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // The id lives in this browser's localStorage: a reload keeps the
  // conversation, a private window gets a new id and starts empty.
  function getSessionId() {
    try {
      let id = localStorage.getItem("chat_session_id");
      if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
        id = newSessionId();
        localStorage.setItem("chat_session_id", id);
      }
      return id;
    } catch (e) {
      return newSessionId();
    }
  }

  const sessionId = getSessionId();

  function addBubble(role, text) {
    const div = document.createElement("div");
    div.className = "bubble " + role;
    div.textContent = text; // textContent, never innerHTML: no HTML injection
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  async function loadHistory() {
    try {
      const res = await fetch(base + "/api/history/" + sessionId);
      if (!res.ok) return;
      const items = await res.json();
      items.forEach((m) => addBubble(m.role, m.content));
    } catch (e) {
      /* no history available, start empty */
    }
  }

  async function sendMessage(text) {
    addBubble("user", text);
    const bubble = addBubble("assistant", "...");
    let reply = "";

    const res = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message: text }),
    });

    if (!res.ok) {
      let msg = "Error " + res.status;
      try {
        msg = (await res.json()).error || msg;
      } catch (e) {
        /* keep default message */
      }
      bubble.textContent = msg;
      bubble.classList.add("error");
      return;
    }

    // The reply arrives as NDJSON: one JSON object per line.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    function handleLine(line) {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.token) {
        reply += event.token;
        bubble.textContent = reply;
        messages.scrollTop = messages.scrollHeight;
      }
      if (event.error) {
        bubble.textContent = event.error;
        bubble.classList.add("error");
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep the unfinished last line
      lines.forEach(handleLine);
    }
    handleLine(buffer);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    input.disabled = true;
    button.disabled = true;
    try {
      await sendMessage(text);
    } catch (err) {
      addBubble("assistant", "Connection error. Please try again.").classList.add("error");
    } finally {
      input.disabled = false;
      button.disabled = false;
      input.focus();
    }
  });

  loadHistory();
})();