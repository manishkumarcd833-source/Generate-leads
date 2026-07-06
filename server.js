require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------- simple lead storage (JSON file) ----------
// Note: on free hosting tiers (e.g. Render free plan) this file can be wiped on redeploy,
// since the filesystem isn't guaranteed persistent. Fine for getting started; swap in a
// real database (Postgres/SQLite) later if you need it fully durable.
const LEADS_FILE = path.join(__dirname, "leads.json");

function readLeads() {
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

function writeLeads(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

// ---------- lead scoring (Hot / Warm / Cold), LeadSquared-style ----------
function computeLeadScore(fields = {}) {
  let score = 0;
  if (fields.intent) score += 15;
  if (fields.budgetMin || fields.budgetMax) score += 20;
  if (fields.timeline) score += 15;
  if (fields.financing) score += 10;
  if (fields.location) score += 10;
  if (fields.propertyType) score += 5;
  if (fields.bedrooms) score += 5;
  if (fields.phone) score += 10;
  if (fields.name) score += 5;
  score = Math.min(score, 100);

  let label = "Cold";
  if (score >= 65) label = "Hot";
  else if (score >= 35) label = "Warm";
  return { score, label };
}

const AGENCY_NAME = "Soma's Agency";
const AGENT_NAME = "Maya";
const OWNER_NAME = process.env.AGENT_OWNER_NAME || "Soma"; // who leads get assigned to by default
const BASE_URL = process.env.BASE_URL || ""; // your Render URL, e.g. https://generate-leads.onrender.com — used to build clickable stage-update links in emails
const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.FOLLOWUP_SECRET; // reuses your existing secret if ADMIN_SECRET isn't set separately
const LEAD_MAGNET =
  "a free Neighborhood Market Snapshot (recent sale prices, days-on-market, and price trends for any area they're eyeing)";

const REFERENCE_KNOWLEDGE = `
REFERENCE FACTS — India real estate (general awareness, not legal/financial advice; always remind the visitor that exact figures vary by state and change over time, and offer to connect them with the agency's team or a lawyer/CA for their specific case):

BUYING & LEGAL PROCESS
- RERA (Real Estate Regulation and Development Act, 2016) governs residential projects above 500 sq. m. or with more than 8 units. Buyers should always check a project's RERA registration on their state's RERA portal before booking.
- Under RERA, builders cannot collect more than 10% of the property cost as advance before a Builder-Buyer Agreement is signed and registered.
- Builders must sell based on "carpet area" (usable floor area within walls), not inflated "super built-up area."
- Typical steps: verify title/ownership history and check for encumbrances, sign the sale agreement, pay stamp duty, register the sale deed at the sub-registrar's office with the buyer, seller, and two witnesses present.
- Stamp duty is a state-level tax (commonly in the roughly 3–10% of property value range depending on the state) and registration charges are typically around 1% of property value, set by the central government — both vary by state and sometimes by buyer gender (many states offer a discount for women buyers).
- Stamp duty and registration charges are usually NOT covered by a home loan — buyers pay these separately, out of pocket.
- Stamp duty/registration costs may be eligible for an income tax deduction (traditionally under Section 80C, subject to a combined cap, only under the old tax regime) — this is a general awareness point, not tax advice; a CA should confirm current applicability.

HOME LOANS / FINANCING
- Lenders typically finance a portion of a property's value (loan-to-value commonly up to around 75–90% depending on the property price band and lender policy); the buyer covers the rest as a down payment.
- Home loans generally do NOT cover stamp duty or registration charges — budget for these separately.
- Typical documents needed: identity proof, address proof, income proof (salary slips/ITR), bank statements, and property documents.
- Processing fees are commonly around 1–3% of the loan amount plus applicable taxes, varying by lender.
- Loan principal repayment and home loan interest have historically had separate income tax benefit provisions — exact sections and limits should be confirmed with a bank or CA since tax law changes.

RENTING
- Rental/leave-and-license agreements for 11 months or less are common in India partly because they can avoid certain mandatory registration requirements that apply to longer terms — but rules and enforcement vary a lot by state and city, and several states are moving toward mandatory registration and online tenant verification regardless of term length.
- Security deposits for residential rentals are commonly around 1–2 months' rent in many states (some cities allow more) — always confirm the local norm.
- Police verification of tenants is mandatory or strongly expected in most major Indian cities and is usually arranged by the landlord, sometimes online through the local police portal.
- A good rental agreement should clearly cover: rent amount, security deposit and refund conditions, notice period for either party, maintenance/utility responsibilities, and renewal terms.
- The Model Tenancy Act (a central framework some states have adopted in some form) generally aims to standardize notice periods, deposit caps, and dispute resolution — but adoption and specifics vary by state.

When answering, use these facts to be genuinely helpful and specific rather than vague, but always frame percentages/amounts as "typically" or "commonly" ranges — never state a figure as universally fixed, since rules differ by state and change over time. For anything highly specific to the visitor's exact state, city, or deal, be upfront that a human agent or the relevant professional (lawyer/CA/bank) should confirm the current, precise figure.
`;

const SYSTEM_PROMPT = `You are ${AGENT_NAME}, the first-contact assistant for ${AGENCY_NAME}, a real estate agency operating in India.

Your job in every reply:
1. Read the visitor's actual question or statement carefully and respond to exactly what they asked — never a generic, one-size-fits-all answer. If they ask about financing, answer financing specifically; if they ask about a neighborhood, answer about that neighborhood; don't reuse the same canned response for different questions.
2. Personalize using whatever you already know about them (their budget, area of interest, timeline, buy/rent intent) rather than giving generic advice that ignores context they've already shared.
3. Use the REFERENCE FACTS below to give genuinely accurate, specific answers about the Indian real estate process, home loans, and renting — don't be vague when you actually have real information to share. Still, never state an exact figure as fixed nationwide; frame it as typical/common and note that it varies by state, and offer a human follow-up for anything that needs to be precise for their situation.
4. Be accurate and honest about limits beyond the reference facts: you don't have access to live listings, exact current prices, or availability. If a question needs a specific number or fact you don't actually have, say so plainly and offer to have a human agent follow up — never guess or invent a figure, address, or listing to sound more helpful.
5. Alongside answering, naturally learn these fields over the course of the chat — ask about ONE missing thing per reply, never a checklist:
   name, phone, email, intent ("buy" or "rent"), propertyType (e.g. condo/house/townhome), location (neighborhood/city), budgetMin, budgetMax, bedrooms, timeline (when they want to move/close), financing ("pre-approved"/"cash"/"needs financing"/"unsure").
6. Use ${LEAD_MAGNET} as your main hook for getting contact details. Once the visitor has mentioned an area of interest but you don't yet have their email, offer to send them this snapshot for that area and ask for their email to send it to. Don't offer it more than once, and don't dangle it if they've already given their email — just confirm you'll send it. This is a real incentive, not a gimmick, so treat it naturally, not pushy.
7. Keep replies warm, sharp, and short — 1 to 3 sentences. No corporate filler.
8. When you answer a genuine property-related question (buying process, home loans, renting, neighborhoods, etc.), end with a brief, natural mention of 2 to 4 closely related questions the visitor might want to ask next — phrased as a casual conversational offer in one added sentence (e.g., "Want me to also cover registration costs, or how loan eligibility works?"), never as a bulleted list or a separate section. Skip this when their message was just qualifying info (like sharing their budget) rather than an actual question, and skip it if you just asked them something yourself — don't stack two questions on them.

${REFERENCE_KNOWLEDGE}

You must respond with ONLY a single valid JSON object. No markdown fences, no commentary, nothing outside the JSON.
Format exactly:
{"reply": "<what to show the visitor>", "fields": {"name":"","phone":"","email":"","intent":"","propertyType":"","location":"","budgetMin":"","budgetMax":"","bedrooms":"","timeline":"","financing":""}, "qualified": false, "magnetOffered": false}

Rules for "fields": only set a value if the visitor has stated it at some point in the conversation (this turn or earlier turns you can see in the history). Leave it as "" if still unknown. Never guess or fabricate a value. Once you learn something, keep restating it in every subsequent turn's fields so it isn't lost.
Set "qualified": true once you know intent, at least one budget figure, and timeline. Otherwise false.
Set "magnetOffered": true starting from the turn where you first offer the Neighborhood Market Snapshot, and keep it true in every turn after that. Otherwise false.`;

// ---------- pipeline stage helpers ----------
const STAGES = ["New", "Contacted", "Qualified", "Converted", "Lost"];

function stageActionLinks(email) {
  if (!BASE_URL || !ADMIN_SECRET) {
    return "(Set BASE_URL and ADMIN_SECRET in your environment variables to get clickable stage-update links here.)";
  }
  const make = (stage) =>
    `Mark ${stage}: ${BASE_URL}/api/update-stage?email=${encodeURIComponent(email)}&stage=${stage}&key=${ADMIN_SECRET}`;
  return ["Contacted", "Qualified", "Converted", "Lost"].map(make).join("\n");
}

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

// Saves/updates a lead as the conversation progresses. Called after every turn once
// the visitor's email is known, so we have somewhere to send a follow-up later.
// Body: { fields: {...}, qualified: boolean }
app.post("/api/save-lead", (req, res) => {
  try {
    const { fields = {}, qualified = false } = req.body;
    if (!fields.email) {
      return res.status(400).json({ error: "email is required to save a lead" });
    }
    const key = fields.email.trim().toLowerCase();
    const leads = readLeads();
    const existing = leads[key];
    const { score, label } = computeLeadScore(fields);

    leads[key] = {
      fields,
      score,
      label,
      qualified: qualified || existing?.qualified || false,
      stage: existing?.stage || "New",
      assignedTo: existing?.assignedTo || OWNER_NAME,
      createdAt: existing?.createdAt || new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      followUpCount: existing?.followUpCount || 0,
      lastFollowUpAt: existing?.lastFollowUpAt || null,
      convertedAt: existing?.convertedAt || null,
    };
    writeLeads(leads);
    res.json({ ok: true, score, label });
  } catch (err) {
    console.error("save-lead error:", err);
    res.status(500).json({ error: "Could not save lead." });
  }
});

// Sends up to FOLLOWUP_MAX nurture emails to leads that have gone quiet for
// FOLLOWUP_DELAY_HOURS without qualifying. Call this on a schedule (see README) —
// e.g. a free daily cron-job.org ping to GET /api/run-followups?key=YOUR_SECRET
app.get("/api/run-followups", async (req, res) => {
  if (!process.env.FOLLOWUP_SECRET || req.query.key !== process.env.FOLLOWUP_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const delayHours = Number(process.env.FOLLOWUP_DELAY_HOURS || 48);
  const maxFollowUps = Number(process.env.FOLLOWUP_MAX || 2);

  try {
    const leads = readLeads();
    const now = Date.now();
    let sent = 0;

    for (const [email, lead] of Object.entries(leads)) {
      if (lead.qualified) continue;
      if ((lead.followUpCount || 0) >= maxFollowUps) continue;

      const lastTouch = new Date(lead.lastFollowUpAt || lead.lastActiveAt).getTime();
      const hoursSince = (now - lastTouch) / (1000 * 60 * 60);
      if (hoursSince < delayHours) continue;

      const f = lead.fields || {};
      await transporter.sendMail({
        from: process.env.FROM_EMAIL,
        to: email,
        subject: `Still thinking about ${f.location || "your next move"}?`,
        text: `Hi ${f.name || "there"},

Just checking in — ${AGENT_NAME} from ${AGENCY_NAME} here. Last time we spoke, you mentioned ${
          f.intent ? `you're looking to ${f.intent}` : "you were exploring your options"
        }${f.location ? ` around ${f.location}` : ""}.

If you're still looking, happy to help — just reply to this email or hop back into the chat on our site anytime.

— ${AGENCY_NAME}`,
      });

      lead.followUpCount = (lead.followUpCount || 0) + 1;
      lead.lastFollowUpAt = new Date().toISOString();
      sent++;
    }

    writeLeads(leads);
    res.json({ ok: true, sent });
  } catch (err) {
    console.error("run-followups error:", err);
    res.status(500).json({ error: "Could not run follow-ups." });
  }
});

// One-tap pipeline stage update — the links in your emails point here.
// GET so they work as plain clickable links (no app needed to trigger them).
app.get("/api/update-stage", (req, res) => {
  if (!ADMIN_SECRET || req.query.key !== ADMIN_SECRET) {
    return res.status(401).send("Unauthorized");
  }
  const { email, stage } = req.query;
  if (!email || !STAGES.includes(stage)) {
    return res.status(400).send("Invalid request — check the email and stage in this link.");
  }
  const leads = readLeads();
  const key = email.trim().toLowerCase();
  if (!leads[key]) return res.status(404).send("Lead not found.");

  const now = new Date().toISOString();
  leads[key].stage = stage;
  if (stage === "Contacted" && !leads[key].contactedAt) leads[key].contactedAt = now;
  if (stage === "Qualified" && !leads[key].qualifiedAt) leads[key].qualifiedAt = now;
  if (stage === "Converted") {
    leads[key].convertedAt = now;
    leads[key].qualified = true;
  }
  if (stage === "Lost") leads[key].lostAt = now;
  writeLeads(leads);

  res.send(
    `<html><body style="font-family:sans-serif;padding:40px;text-align:center;">
      <h2>Marked ${email} as ${stage} ✓</h2>
      <p>You can close this tab.</p>
    </body></html>`
  );
});

// Sends a lead-pipeline digest: stage counts, conversion rate, average time-to-first-contact,
// and your top open leads by score, each with one-tap links to update their stage.
// Trigger this on a schedule (daily or weekly) the same way as /api/run-followups.
app.get("/api/send-digest", async (req, res) => {
  if (!ADMIN_SECRET || req.query.key !== ADMIN_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const leads = readLeads();
    const all = Object.entries(leads);
    const total = all.length;

    const counts = { New: 0, Contacted: 0, Qualified: 0, Converted: 0, Lost: 0 };
    all.forEach(([, l]) => {
      const s = l.stage || "New";
      counts[s] = (counts[s] || 0) + 1;
    });

    const conversionRate = total ? ((counts.Converted / total) * 100).toFixed(1) : "0.0";

    const responseTimes = all
      .filter(([, l]) => l.contactedAt && l.createdAt)
      .map(([, l]) => (new Date(l.contactedAt) - new Date(l.createdAt)) / (1000 * 60 * 60));
    const avgResponseHours = responseTimes.length
      ? (responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length).toFixed(1)
      : null;

    const openLeads = all
      .filter(([, l]) => l.stage !== "Converted" && l.stage !== "Lost")
      .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
      .slice(0, 5);

    const openLeadsText = openLeads
      .map(([email, l]) => {
        const f = l.fields || {};
        return `${f.name || email} — ${l.label || "Cold"} (${l.score || 0}/100), stage: ${l.stage || "New"}
  Wants to ${f.intent || "?"} in ${f.location || "?"}, assigned to ${l.assignedTo || OWNER_NAME}
  ${stageActionLinks(email)}`;
      })
      .join("\n\n");

    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: process.env.AGENCY_NOTIFY_EMAIL,
      subject: `${AGENCY_NAME} — Lead pipeline digest (${total} total)`,
      text: `Pipeline snapshot:
New: ${counts.New}  |  Contacted: ${counts.Contacted}  |  Qualified: ${counts.Qualified}  |  Converted: ${counts.Converted}  |  Lost: ${counts.Lost}

Conversion rate: ${conversionRate}%
${avgResponseHours ? `Average time to first contact: ${avgResponseHours} hours` : "Average time to first contact: not enough data yet"}

Your top open leads right now:

${openLeadsText || "(no open leads right now)"}

— ${AGENCY_NAME} chat assistant`,
    });

    res.json({ ok: true, total, counts, conversionRate });
  } catch (err) {
    console.error("send-digest error:", err);
    res.status(500).json({ error: "Could not send digest." });
  }
});
// Body: { fields: {...}, transcript: [{ role, content }, ...] }
app.post("/api/lead", async (req, res) => {
  try {
    const { fields = {}, transcript = [] } = req.body;
    const { score, label } = computeLeadScore(fields);

    // Mark this lead as qualified in storage so follow-ups stop targeting them,
    // and advance its pipeline stage (unless it's already further along, e.g. Converted/Lost).
    if (fields.email) {
      const key = fields.email.trim().toLowerCase();
      const leads = readLeads();
      const existing = leads[key];
      const alreadyPastQualified = existing && ["Converted", "Lost"].includes(existing.stage);
      leads[key] = {
        ...(existing || {}),
        fields,
        score,
        label,
        qualified: true,
        stage: alreadyPastQualified ? existing.stage : "Qualified",
        qualifiedAt: existing?.qualifiedAt || new Date().toISOString(),
        assignedTo: existing?.assignedTo || OWNER_NAME,
        lastActiveAt: new Date().toISOString(),
        createdAt: existing?.createdAt || new Date().toISOString(),
        followUpCount: existing?.followUpCount || 0,
        lastFollowUpAt: existing?.lastFollowUpAt || null,
      };
      writeLeads(leads);
    }

    const summary = Object.entries(fields)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    const transcriptText = transcript.map((m) => `${m.role}: ${m.content}`).join("\n");

    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: process.env.AGENCY_NOTIFY_EMAIL,
      subject: `[${label} lead · ${score}/100] New lead captured — ${fields.name || "unnamed visitor"}`,
      text: `A new lead came through the ${AGENCY_NAME} chat assistant:

Lead score: ${score}/100 (${label})
Assigned to: ${OWNER_NAME}

${summary || "(no fields captured yet)"}

Update this lead's stage:
${fields.email ? stageActionLinks(fields.email) : "(no email captured yet, so no direct links available)"}

---
Full conversation:
${transcriptText}`,
    });

    res.json({ ok: true, score, label });
  } catch (err) {
    console.error("lead error:", err);
    res.status(500).json({ error: "Could not send the lead notification." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`${AGENCY_NAME} backend running on port ${PORT}`));
