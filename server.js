require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AGENCY_NAME = "Soma's Agency";
const AGENT_NAME = "Maya";
const LEAD_MAGNET =
  "a free Neighborhood Market Snapshot (recent sale prices, days-on-market, and price trends for any area they're eyeing)";

const SYSTEM_PROMPT = `You are ${AGENT_NAME}, the first-contact assistant for ${AGENCY_NAME}, a real estate agency.

Your job in every reply:
1. Answer any general question the visitor asks about buying, renting, the local process, or how the agency works — briefly and honestly. Never invent specific listings, prices, or availability you don't know; speak in general terms and offer to have an agent follow up with specifics.
2. Naturally, conversationally, learn these fields over the course of the chat — ask about ONE missing thing per reply, never a checklist:
   name, phone, email, intent ("buy" or "rent"), propertyType (e.g. condo/house/townhome), location (neighborhood/city), budgetMin, budgetMax, bedrooms, timeline (when they want to move/close), financing ("pre-approved"/"cash"/"needs financing"/"unsure").
3. Use ${LEAD_MAGNET} as your main hook for getting contact details. Once the visitor has mentioned an area of interest but you don't yet have their email, offer to send them this snapshot for that area and ask for their email to send it to. Don't offer it more than once, and don't dangle it if they've already given their email — just confirm you'll send it. This is a real incentive, not a gimmick, so treat it naturally, not pushy.
4. Keep replies warm, sharp, and short — 1 to 3 sentences. No corporate filler.

You must respond with ONLY a single valid JSON object. No markdown fences, no commentary, nothing outside the JSON.
Format exactly:
{"reply": "<what to show the visitor>", "fields": {"name":"","phone":"","email":"","intent":"","propertyType":"","location":"","budgetMin":"","budgetMax":"","bedrooms":"","timeline":"","financing":""}, "qualified": false, "magnetOffered": false}

Rules for "fields": only set a value if the visitor has stated it at some point in the conversation (this turn or earlier turns you can see in the history). Leave it as "" if still unknown. Never guess or fabricate a value. Once you learn something, keep restating it in every subsequent turn's fields so it isn't lost.
Set "qualified": true once you know intent, at least one budget figure, and timeline. Otherwise false.
Set "magnetOffered": true starting from the turn where you first offer the Neighborhood Market Snapshot, and keep it true in every turn after that. Otherwise false.`;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Health check — hit this after deploying to confirm the server is up
app.get("/health", (req, res) => res.json({ ok: true, agency: AGENCY_NAME }));

// Main chat endpoint. Body: { messages: [{ role: "user"|"assistant", content: string }, ...] }
app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock ? textBlock.text : "{}";
    const clean = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      parsed = {
        reply: "Sorry, could you say that again?",
        fields: {},
        qualified: false,
        magnetOffered: false,
      };
    }

    // raw is what you append back into the conversation history as the assistant turn
    res.json({ raw, parsed });
  } catch (err) {
    console.error("chat error:", err);
    res.status(500).json({ error: "Something went wrong talking to the assistant." });
  }
});

// Sends the lead magnet (Neighborhood Market Snapshot) to a captured email.
// Body: { email, name, location }
app.post("/api/send-snapshot", async (req, res) => {
  try {
    const { email, name, location } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });

    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: `Your Neighborhood Market Snapshot${location ? ` — ${location}` : ""}`,
      text: `Hi ${name || "there"},

Thanks for chatting with ${AGENT_NAME} at ${AGENCY_NAME}. Here's a quick snapshot for ${location || "your area"}:

- Recent sale prices: [ connect this to your MLS/data source ]
- Average days on market: [ connect this to your MLS/data source ]
- Price trend, last 90 days: [ connect this to your MLS/data source ]

A member of our team will follow up shortly with more detail.

— ${AGENCY_NAME}`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("send-snapshot error:", err);
    res.status(500).json({ error: "Could not send the snapshot email." });
  }
});

// Notifies the agency inbox once a lead is captured/qualified.
// Body: { fields: {...}, transcript: [{ role, content }, ...] }
app.post("/api/lead", async (req, res) => {
  try {
    const { fields = {}, transcript = [] } = req.body;

    const summary = Object.entries(fields)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    const transcriptText = transcript.map((m) => `${m.role}: ${m.content}`).join("\n");

    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: process.env.AGENCY_NOTIFY_EMAIL,
      subject: `New lead captured — ${fields.name || "unnamed visitor"}`,
      text: `A new lead came through the ${AGENCY_NAME} chat assistant:

${summary || "(no fields captured yet)"}

---
Full conversation:
${transcriptText}`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("lead error:", err);
    res.status(500).json({ error: "Could not send the lead notification." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`${AGENCY_NAME} backend running on port ${PORT}`));
