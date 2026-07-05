/**
 * Soma's Agency — Website Chat Widget
 * ------------------------------------
 * Drop this on any page with:
 *
 *   <script>
 *     window.SomaChatConfig = { backendUrl: "https://your-backend-url.onrender.com" };
 *   </script>
 *   <script src="soma-chat-widget.js"></script>
 *
 * That's it — a chat bubble appears bottom-right. No other setup needed on the page.
 */
(function () {
  const CONFIG = Object.assign(
    {
      backendUrl: "http://localhost:3001",
      agencyName: "Soma's Agency",
      agentName: "Maya",
      accent: "#B08A4E",
      ink: "#1B2430",
      paper: "#FAF8F2",
    },
    window.SomaChatConfig || {}
  );

  const GREETING = `Hi, I'm ${CONFIG.agentName} with ${CONFIG.agencyName}. Tell me the area you're watching and whether you're looking to buy or rent — I'll send you a free Neighborhood Market Snapshot for it while we chat.`;

  const FIELD_KEYS = [
    "name",
    "phone",
    "email",
    "intent",
    "propertyType",
    "location",
    "budgetMin",
    "budgetMax",
    "bedrooms",
    "timeline",
    "financing",
  ];

  // ---------- state ----------
  let displayMessages = [{ role: "assistant", content: GREETING }];
  let apiHistory = [];
  let fields = FIELD_KEYS.reduce((acc, k) => ({ ...acc, [k]: "" }), {});
  let qualified = false;
  let snapshotSent = false;
  let leadSent = false;
  let loading = false;
  let open = false;

  // ---------- styles ----------
  const style = document.createElement("style");
  style.textContent = `
    #soma-widget-bubble {
      position: fixed; bottom: 24px; right: 24px; z-index: 999999;
      width: 60px; height: 60px; border-radius: 50%;
      background: ${CONFIG.ink}; color: ${CONFIG.accent};
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,0.25);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      border: 2px solid ${CONFIG.accent}; transition: transform 150ms ease;
    }
    #soma-widget-bubble:hover { transform: scale(1.06); }
    #soma-widget-panel {
      position: fixed; bottom: 96px; right: 24px; z-index: 999999;
      width: 360px; max-width: calc(100vw - 32px);
      height: 520px; max-height: calc(100vh - 140px);
      background: #fff; border-radius: 14px; overflow: hidden;
      box-shadow: 0 12px 40px rgba(0,0,0,0.28);
      display: none; flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      border: 1px solid #E2DDD1;
    }
    #soma-widget-panel.open { display: flex; }
    #soma-widget-header {
      background: ${CONFIG.ink}; color: ${CONFIG.paper};
      padding: 14px 16px; display: flex; justify-content: space-between; align-items: center;
    }
    #soma-widget-header .title { font-weight: 600; font-size: 14.5px; }
    #soma-widget-header .sub { font-size: 11px; color: ${CONFIG.accent}; margin-top: 2px; }
    #soma-widget-close { cursor: pointer; color: #8A93A0; font-size: 18px; line-height: 1; background: none; border: none; }
    #soma-widget-messages {
      flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px;
      background: #FAF8F2;
    }
    .soma-msg { display: flex; }
    .soma-msg.user { justify-content: flex-end; }
    .soma-bubble {
      max-width: 82%; padding: 9px 13px; border-radius: 16px; font-size: 13.5px; line-height: 1.45;
    }
    .soma-msg.user .soma-bubble { background: ${CONFIG.ink}; color: ${CONFIG.paper}; border-top-right-radius: 4px; }
    .soma-msg.assistant .soma-bubble { background: #F5F2EA; color: ${CONFIG.ink}; border-top-left-radius: 4px; }
    #soma-widget-inputrow {
      display: flex; gap: 8px; padding: 10px; border-top: 1px solid #EDE9DD; background: #fff;
    }
    #soma-widget-input {
      flex: 1; resize: none; border: 1px solid #E2DDD1; border-radius: 10px; padding: 9px 11px;
      font-size: 13.5px; font-family: inherit; outline: none; background: #F5F2EA; color: ${CONFIG.ink};
    }
    #soma-widget-send {
      width: 38px; height: 38px; border-radius: 10px; background: ${CONFIG.accent}; border: none;
      color: ${CONFIG.ink}; cursor: pointer; flex-shrink: 0; font-size: 16px;
    }
    #soma-widget-send:disabled { opacity: 0.5; cursor: default; }
    .soma-typing { display: flex; gap: 4px; padding: 10px 13px; }
    .soma-typing span {
      width: 5px; height: 5px; border-radius: 50%; background: #8A93A0; display: inline-block;
      animation: somaBlink 1.2s infinite ease-in-out;
    }
    .soma-typing span:nth-child(2) { animation-delay: 0.2s; }
    .soma-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes somaBlink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
  `;
  document.head.appendChild(style);

  // ---------- DOM ----------
  const bubble = document.createElement("div");
  bubble.id = "soma-widget-bubble";
  bubble.innerHTML = "&#128172;"; // speech balloon emoji as a neutral default icon
  document.body.appendChild(bubble);

  const panel = document.createElement("div");
  panel.id = "soma-widget-panel";
  panel.innerHTML = `
    <div id="soma-widget-header">
      <div>
        <div class="title">${CONFIG.agencyName}</div>
        <div class="sub">Usually replies in a minute</div>
      </div>
      <button id="soma-widget-close">&times;</button>
    </div>
    <div id="soma-widget-messages"></div>
    <div id="soma-widget-inputrow">
      <textarea id="soma-widget-input" rows="1" placeholder="Type a message…"></textarea>
      <button id="soma-widget-send">&#10148;</button>
    </div>
  `;
  document.body.appendChild(panel);

  const messagesEl = panel.querySelector("#soma-widget-messages");
  const inputEl = panel.querySelector("#soma-widget-input");
  const sendBtn = panel.querySelector("#soma-widget-send");
  const closeBtn = panel.querySelector("#soma-widget-close");

  function render() {
    messagesEl.innerHTML = "";
    displayMessages.forEach((m) => {
      const row = document.createElement("div");
      row.className = `soma-msg ${m.role}`;
      const b = document.createElement("div");
      b.className = "soma-bubble";
      b.textContent = m.content;
      row.appendChild(b);
      messagesEl.appendChild(row);
    });
    if (loading) {
      const row = document.createElement("div");
      row.className = "soma-msg assistant";
      row.innerHTML = `<div class="soma-bubble soma-typing"><span></span><span></span><span></span></div>`;
      messagesEl.appendChild(row);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    sendBtn.disabled = loading || !inputEl.value.trim();
  }

  function toggle() {
    open = !open;
    panel.classList.toggle("open", open);
    if (open) render();
  }
  bubble.addEventListener("click", toggle);
  closeBtn.addEventListener("click", toggle);
  inputEl.addEventListener("input", () => (sendBtn.disabled = loading || !inputEl.value.trim()));
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener("click", send);

  async function send() {
    const text = inputEl.value.trim();
    if (!text || loading) return;
    inputEl.value = "";
    displayMessages.push({ role: "user", content: text });
    loading = true;
    render();

    const nextHistory = [...apiHistory, { role: "user", content: text }];

    try {
      const res = await fetch(`${CONFIG.backendUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextHistory }),
      });
      const { raw, parsed } = await res.json();

      apiHistory = [...nextHistory, { role: "assistant", content: raw }];
      displayMessages.push({ role: "assistant", content: parsed.reply || "…" });

      const hadEmail = !!fields.email;
      Object.entries(parsed.fields || {}).forEach(([k, v]) => {
        if (v) fields[k] = v;
      });

      const wasQualified = qualified;
      qualified = !!parsed.qualified;

      // Fire the snapshot email the moment we newly learn the visitor's email.
      if (!hadEmail && fields.email && !snapshotSent) {
        snapshotSent = true;
        fetch(`${CONFIG.backendUrl}/api/send-snapshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: fields.email, name: fields.name, location: fields.location }),
        }).catch(() => {});
      }

      // Notify the agency inbox the moment the lead becomes qualified.
      if (!wasQualified && qualified && !leadSent) {
        leadSent = true;
        fetch(`${CONFIG.backendUrl}/api/lead`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields, transcript: displayMessages }),
        }).catch(() => {});
      }
    } catch (e) {
      displayMessages.push({ role: "assistant", content: "Sorry — I hit a snag there. Mind trying that again?" });
    } finally {
      loading = false;
      render();
    }
  }

  render();
})();
