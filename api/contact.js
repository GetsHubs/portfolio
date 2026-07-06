const crypto = require("node:crypto");

const MAX_BODY_BYTES = 16 * 1024;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const OUTBOUND_TIMEOUT_MS = 8000;
const UPSTASH_TIMEOUT_MS = 4000;
const RATE_LIMIT_DEFAULTS = {
  windowSeconds: 600,
  maxAttempts: 5,
  blockSeconds: 600,
};
const FIELD_LIMITS = {
  name: 120,
  email: 180,
  subject: 180,
  message: 3000,
};

function setSecurityHeaders(res) {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'none'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sendHtml(res, statusCode, title, message) {
  setSecurityHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} | The Trendify AI</title>
  <meta name="theme-color" content="#27262b" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body class="contact-page">
  <header class="site-header" aria-label="Contact response header">
    <a class="brand" href="/index.html">The Trendify AI</a>
    <nav class="site-nav" aria-label="Contact response navigation">
      <a href="/contact.html">Back to Contact</a>
      <a href="/index.html">Back to Home</a>
    </nav>
  </header>
  <main id="top" class="contact-main section-wrap" tabindex="-1">
    <section class="contact-panel" aria-labelledby="response-title">
      <div class="contact-intro">
        <p class="section-label">Contact</p>
        <h1 id="response-title">${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
      </div>
    </section>
  </main>
</body>
</html>`);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanMessage(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function containsLikelySecret(value) {
  return /(api[_ -]?key|secret[_ -]?key|password|token|sk-[A-Za-z0-9_-]{16,}|card number|cvv)/i.test(value);
}

function getPositiveIntegerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getRateLimitSettings() {
  return {
    windowSeconds: getPositiveIntegerEnv("CONTACT_RATE_LIMIT_WINDOW_SECONDS", RATE_LIMIT_DEFAULTS.windowSeconds),
    maxAttempts: getPositiveIntegerEnv("CONTACT_RATE_LIMIT_MAX_ATTEMPTS", RATE_LIMIT_DEFAULTS.maxAttempts),
    blockSeconds: getPositiveIntegerEnv("CONTACT_RATE_LIMIT_BLOCK_SECONDS", RATE_LIMIT_DEFAULTS.blockSeconds),
  };
}

function getClientIp(req) {
  const cfConnectingIp = clean(req.headers["cf-connecting-ip"]);
  const forwardedFor = clean(req.headers["x-forwarded-for"]).split(",")[0].trim();
  const realIp = clean(req.headers["x-real-ip"]);
  const socketIp = clean(req.socket && req.socket.remoteAddress);

  return cfConnectingIp || forwardedFor || realIp || socketIp || "";
}

function hashIdentifier(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
}

function normalizeEmail(email) {
  return clean(email).toLowerCase();
}

function getTurnstileToken(params) {
  return clean(params.get("cf-turnstile-response"));
}

function unavailableProtectionResult() {
  return {
    ok: false,
    statusCode: 503,
    title: "Contact Is Temporarily Unavailable",
    message: "Contact protection is temporarily unavailable. Please try again later.",
  };
}

function verificationRequiredResult() {
  return {
    ok: false,
    statusCode: 400,
    title: "Verification Required",
    message: "Please complete the spam protection check and try again.",
  };
}

function rateLimitedResult() {
  return {
    ok: false,
    statusCode: 429,
    title: "Too Many Attempts",
    message: "Too many attempts. Please wait a few minutes before trying again.",
  };
}

async function verifyTurnstile(token, req) {
  if (!token) {
    return verificationRequiredResult();
  }

  const secret = process.env.TURNSTILE_SECRET_KEY || "";
  if (!secret) {
    return unavailableProtectionResult();
  }

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);

  const remoteIp = getClientIp(req);
  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OUTBOUND_TIMEOUT_MS);

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      return unavailableProtectionResult();
    }

    const result = await response.json().catch(() => null);
    return result && result.success ? { ok: true } : verificationRequiredResult();
  } catch {
    return unavailableProtectionResult();
  } finally {
    clearTimeout(timeout);
  }
}

function getRedisConfig() {
  const url = clean(process.env.UPSTASH_REDIS_REST_URL).replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || "";

  if (!url || !token) {
    return null;
  }

  return { url, token };
}

async function redisCommand(redis, command) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTASH_TIMEOUT_MS);

  try {
    const response = await fetch(redis.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redis.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error("Redis command failed.");
    }

    const data = await response.json().catch(() => null);
    if (!data || data.error) {
      throw new Error("Redis command failed.");
    }

    return data.result;
  } finally {
    clearTimeout(timeout);
  }
}

function redisGet(redis, key) {
  return redisCommand(redis, ["GET", key]);
}

function redisSetEx(redis, key, seconds, value) {
  return redisCommand(redis, ["SETEX", key, String(seconds), value]);
}

function redisIncr(redis, key) {
  return redisCommand(redis, ["INCR", key]);
}

function redisExpire(redis, key, seconds) {
  return redisCommand(redis, ["EXPIRE", key, String(seconds)]);
}

function buildRateLimitKeys(req, email) {
  const clientIp = getClientIp(req) || "unknown";
  const ipHash = hashIdentifier(`ip:${clientIp}`);
  const emailHash = hashIdentifier(`email:${normalizeEmail(email)}`);
  const pairHash = hashIdentifier(`pair:${ipHash}:${emailHash}`);

  return [
    {
      attemptKey: `contact:attempt:ip:${ipHash}`,
      blockKey: `contact:block:ip:${ipHash}`,
    },
    {
      attemptKey: `contact:attempt:email:${emailHash}`,
      blockKey: `contact:block:email:${emailHash}`,
    },
    {
      attemptKey: `contact:attempt:pair:${pairHash}`,
      blockKey: `contact:block:pair:${pairHash}`,
    },
  ];
}

async function incrementAttempt(redis, key, windowSeconds) {
  const attempts = Number(await redisIncr(redis, key));
  if (!Number.isFinite(attempts)) {
    throw new Error("Invalid Redis counter response.");
  }

  if (attempts === 1) {
    await redisExpire(redis, key, windowSeconds);
  }

  return attempts;
}

async function enforceRateLimit(req, email) {
  const redis = getRedisConfig();
  if (!redis) {
    return unavailableProtectionResult();
  }

  const settings = getRateLimitSettings();
  const keys = buildRateLimitKeys(req, email);

  try {
    const blockValues = await Promise.all(keys.map((entry) => redisGet(redis, entry.blockKey)));
    if (blockValues.some((value) => value !== null && value !== undefined)) {
      return rateLimitedResult();
    }

    const attempts = [];
    for (const entry of keys) {
      attempts.push(await incrementAttempt(redis, entry.attemptKey, settings.windowSeconds));
    }

    if (attempts.some((count) => count > settings.maxAttempts)) {
      await Promise.all(keys.map((entry) => redisSetEx(redis, entry.blockKey, settings.blockSeconds, "1")));
      return rateLimitedResult();
    }

    return { ok: true };
  } catch {
    return unavailableProtectionResult();
  }
}

function validateContactForm(params) {
  const submission = {
    company: clean(params.get("company")),
    name: clean(params.get("name")),
    email: clean(params.get("email")),
    subject: clean(params.get("subject")),
    message: cleanMessage(params.get("message")),
  };

  if (submission.company) {
    return { ok: false, bot: true };
  }

  if (!submission.name || submission.name.length > FIELD_LIMITS.name) {
    return { ok: false, message: "Please enter a valid name." };
  }

  if (!submission.email || submission.email.length > FIELD_LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submission.email)) {
    return { ok: false, message: "Please enter a valid email address." };
  }

  if (!submission.subject || submission.subject.length > FIELD_LIMITS.subject) {
    return { ok: false, message: "Please enter a valid subject." };
  }

  if (!submission.message || submission.message.length > FIELD_LIMITS.message) {
    return { ok: false, message: "Please enter a message under 3000 characters." };
  }

  if (containsLikelySecret(submission.subject) || containsLikelySecret(submission.message)) {
    return { ok: false, message: "Please remove passwords, API keys, payment details, or private secrets before sending." };
  }

  return {
    ok: true,
    submission: {
      name: submission.name,
      email: submission.email,
      subject: submission.subject,
      message: submission.message,
      source: "The Trendify AI portfolio contact form",
      submittedAt: new Date().toISOString(),
    },
  };
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers["content-length"] || 0);
    if (contentLength > MAX_BODY_BYTES) {
      reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
      return;
    }

    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function getUrlEncodedParams(req) {
  if (typeof req.body === "string") {
    if (Buffer.byteLength(req.body, "utf8") > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    }

    return new URLSearchParams(req.body);
  }

  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.body)) {
      params.set(key, Array.isArray(value) ? String(value[0] || "") : String(value || ""));
    }

    if (Buffer.byteLength(params.toString(), "utf8") > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    }

    return params;
  }

  return new URLSearchParams(await readRawBody(req));
}

async function forwardSubmission(submission) {
  const webhookUrl = process.env.CONTACT_FORM_WEBHOOK_URL || "";
  const webhookToken = process.env.CONTACT_FORM_WEBHOOK_TOKEN || "";

  if (!webhookUrl) {
    return { ok: false, statusCode: 503 };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OUTBOUND_TIMEOUT_MS);

  try {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "the-trendify-ai-contact-form/1.0",
    };

    if (webhookToken) {
      headers.Authorization = `Bearer ${webhookToken}`;
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(submission),
      signal: controller.signal,
    });

    return { ok: response.ok, statusCode: response.ok ? 200 : 502 };
  } catch {
    return { ok: false, statusCode: 502 };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    setSecurityHeaders(res);
    res.setHeader("Allow", "POST");
    sendHtml(res, 405, "Method Not Allowed", "Please submit the contact form from the website.");
    return;
  }

  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    sendHtml(res, 415, "Unsupported Form Request", "Please submit the contact form from the website.");
    return;
  }

  let params;
  try {
    params = await getUrlEncodedParams(req);
  } catch (error) {
    const statusCode = error && error.statusCode === 413 ? 413 : 400;
    sendHtml(res, statusCode, statusCode === 413 ? "Message Too Large" : "Invalid Form Request", "Please check the form and try again.");
    return;
  }

  const validation = validateContactForm(params);
  if (validation.bot) {
    setSecurityHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!validation.ok) {
    sendHtml(res, 400, "Check Your Message", validation.message);
    return;
  }

  const turnstile = await verifyTurnstile(getTurnstileToken(params), req);
  if (!turnstile.ok) {
    sendHtml(res, turnstile.statusCode, turnstile.title, turnstile.message);
    return;
  }

  const rateLimit = await enforceRateLimit(req, validation.submission.email);
  if (!rateLimit.ok) {
    sendHtml(res, rateLimit.statusCode, rateLimit.title, rateLimit.message);
    return;
  }

  const delivery = await forwardSubmission(validation.submission);
  if (!delivery.ok) {
    const message = delivery.statusCode === 503
      ? "The contact delivery endpoint is not configured yet."
      : "The contact delivery endpoint could not accept the message right now.";
    sendHtml(res, delivery.statusCode, "Contact Is Not Available Yet", message);
    return;
  }

  sendHtml(res, 200, "Message Sent", "Your message was accepted by the contact endpoint.");
};
