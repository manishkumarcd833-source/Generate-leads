# Soma's Agency — Chatbot Backend 

This is the server your website's chat widget talks to. It keeps your Anthropic API key private, runs the lead-qualification logic, and sends emails for the market-snapshot magnet and new-lead alerts.

## 1. Get it running locally (optional, to test first)

```bash
npm install
cp .env.example .env
# open .env and fill in your real values
npm start
```

Visit `http://localhost:3001/health` — you should see `{"ok":true,"agency":"Soma's Agency"}`.

## 2. Fill in `.env`

- **ANTHROPIC_API_KEY** — from [console.anthropic.com](https://console.anthropic.com)
- **SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS** — from whichever email sender you use:
  - SendGrid: host `smtp.sendgrid.net`, user `apikey`, pass = your SendGrid API key
  - Gmail: host `smtp.gmail.com`, port `587`, user = your Gmail address, pass = an [app password](https://support.google.com/accounts/answer/185833) (not your normal password)
- **FROM_EMAIL** — the address snapshot emails come from (must be verified with your provider)
- **AGENCY_NOTIFY_EMAIL** — where you want new-lead alerts sent
- **ALLOWED_ORIGIN** — your website's domain, so random sites can't call your backend

## 3. Deploy it somewhere

Easiest options for something this size:

- **Render** (render.com) — connect your GitHub repo, pick "Web Service", it auto-detects Node
- **Railway** (railway.app) — same idea, very quick
- **Vercel** — works too, but as serverless functions rather than a long-running server; ask me if you want it restructured that way

Whichever you pick: add the same variables from `.env` into that platform's "Environment Variables" settings — never commit your real `.env` file to GitHub.

## 4. Point your website widget at it

Two files are included for this: `soma-chat-widget.js` (the actual embeddable widget) and `demo.html` (a placeholder page to test it on before going live).

**To test locally:**
1. Run the backend (`npm start`)
2. Open `demo.html` in your browser directly (double-click it, or use a local server)
3. Click the chat bubble bottom-right and try a full conversation

**To go live on your real site**, once the backend is deployed:
1. Upload `soma-chat-widget.js` to your website's hosting (or serve it from anywhere reachable, e.g. a CDN, S3, or your own server)
2. Add this just before `</body>` on your site:

```html
<script>
  window.SomaChatConfig = {
    backendUrl: "https://your-backend-url.onrender.com",
    agencyName: "Soma's Agency",
    agentName: "Maya",
  };
</script>
<script src="https://your-domain.com/path/to/soma-chat-widget.js"></script>
```

That's it — the chat bubble appears on every page that includes it. It already talks to `/api/chat`, `/api/send-snapshot`, and `/api/lead` on its own; no other wiring needed.

## 3 endpoints, in short

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` | Send the conversation, get Maya's reply + extracted fields back |
| `POST /api/send-snapshot` | Emails the free Neighborhood Market Snapshot to a captured lead |
| `POST /api/lead` | Emails you a summary + full transcript for a captured lead |

## Note on the snapshot content

The snapshot email currently has placeholder lines for sale prices, days-on-market, and price trends. Hook these up to your actual MLS/data source (or have your team fill in a template per area) before this goes live — right now it's a stub so the flow works end-to-end.
