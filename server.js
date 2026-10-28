import express from "express";
import helmet from "helmet";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

const API = "https://api.mail.tm";
const inboxes = new Map();

async function mailRequest(endpoint, options = {}) {
  const response = await fetch(`${API}${endpoint}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.["hydra:description"] || "Email service request failed");
  }

  return data;
}

// Generate a temporary email inbox
app.post("/api/inboxes", async (req, res) => {
  try {
    const domainsData = await mailRequest("/domains");
    const domains = domainsData["hydra:member"] || domainsData;

    const domain = domains.find(
      item => item.isActive && !item.isPrivate
    )?.domain;

    if (!domain) {
      return res.status(503).json({
        error: "No available email domain"
      });
    }

    const address =
      `${crypto.randomBytes(5).toString("hex")}@${domain}`;

    const password = crypto.randomBytes(24).toString("hex");

    const account = await mailRequest("/accounts", {
      method: "POST",
      body: JSON.stringify({ address, password })
    });

    const tokenData = await mailRequest("/token", {
      method: "POST",
      body: JSON.stringify({ address, password })
    });

    const id = crypto.randomUUID();

    inboxes.set(id, {
      address,
      token: tokenData.token,
      accountId: account.id,
      expiresAt: Date.now() + 60 * 60 * 1000
    });

    res.status(201).json({
      id,
      address,
      expiresAt: Date.now() + 60 * 60 * 1000
    });
  } catch (error) {
    console.error("Inbox creation failed:", error.message);
    res.status(502).json({
      error: "Could not create inbox. Please try again."
    });
  }
});

// Read inbox messages
app.get("/api/inboxes/:id/messages", async (req, res) => {
  try {
    const inbox = inboxes.get(req.params.id);

    if (!inbox) {
      return res.status(404).json({ error: "Inbox not found" });
    }

    if (Date.now() > inbox.expiresAt) {
      inboxes.delete(req.params.id);
      return res.status(410).json({ error: "Inbox expired" });
    }

    const data = await mailRequest("/messages", {
      headers: {
        Authorization: `Bearer ${inbox.token}`
      }
    });

    const messages = (data["hydra:member"] || []).map(message => ({
      id: message.id,
      from: message.from?.address || "Unknown sender",
      subject: message.subject || "(No subject)",
      intro: message.intro || "",
      createdAt: message.createdAt
    }));

    res.json({ address: inbox.address, messages });
  } catch (error) {
    console.error("Inbox read failed:", error.message);
    res.status(502).json({ error: "Could not load inbox" });
  }
});

// Read a single message and detect a likely OTP
app.get("/api/inboxes/:id/messages/:messageId", async (req, res) => {
  try {
    const inbox = inboxes.get(req.params.id);

    if (!inbox || Date.now() > inbox.expiresAt) {
      return res.status(404).json({ error: "Inbox unavailable" });
    }

    const message = await mailRequest(
      `/messages/${encodeURIComponent(req.params.messageId)}`,
      {
        headers: {
          Authorization: `Bearer ${inbox.token}`
        }
      }
    );

    const text = `${message.subject || ""}\n${message.text || ""}\n${message.intro || ""}`;

    const patterns = [
      /(?:otp|verification code|security code|login code|one-time code)[^\d]{0,40}(\d{4,8})/i,
      /(\d{4,8})[^\w]{0,20}(?:is your )?(?:otp|verification code|security code)/i
    ];

    let otp = null;

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        otp = match[1];
        break;
      }
    }

    res.json({
      id: message.id,
      subject: message.subject,
      from: message.from?.address,
      text: message.text || message.intro || "",
      otp
    });
  } catch (error) {
    console.error("Message read failed:", error.message);
    res.status(502).json({ error: "Could not read message" });
  }
});

// Delete a temporary inbox
app.delete("/api/inboxes/:id", (req, res) => {
  const existed = inboxes.delete(req.params.id);

  if (!existed) {
    return res.status(404).json({ error: "Inbox not found" });
  }

  res.status(204).end();
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`TempMail Pro running on port ${PORT}`);
});
