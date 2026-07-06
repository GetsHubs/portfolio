const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 8080);
const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const WEBHOOK_URL = process.env.CONTACT_FORM_WEBHOOK_URL || "";
const WEBHOOK_TOKEN = process.env.CONTACT_FORM_WEBHOOK_TOKEN || "";

const rateLimitBuckets = new Map();

const staticRoutes = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/contact.html", "contact.html"],
  ["/style.css", "style.css"],
]);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
]);

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'none'",
      "style-src 'self'",
      "img-src 'self' https://images.unsplash.com",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ].join("; ")
  );
}

function sendHtml(res, statusCode, title, message) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getClientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(req) {
  const now = Date.now();
  const key = getClientKey(req);
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function validateContactForm(params) {
  const submission = {
    name: clean(params.get("name")),
    email: clean(params.get("email")),
    subject: clean(params.get("subject")),
    message: cleanMessage(params.get("message")),
    company: clean(params.get("company")),
  };

  if (submission.company) {
    return { ok: false, bot: true, message: "Submission ignored." };
  }

  if (submission.name.length < 2 || submission.name.length > 120) {
    return { ok: false, message: "Please enter a valid name." };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submission.email) || submission.email.length > 254) {
    return { ok: false, message: "Please enter a valid email address." };
  }

  if (submission.subject.length < 3 || submission.subject.length > 160) {
    return { ok: false, message: "Please enter a subject between 3 and 160 characters." };
  }

  if (submission.message.length < 10 || submission.message.length > 4000) {
    return { ok: false, message: "Please enter a message between 10 and 4000 characters." };
  }

  if (containsLikelySecret(submission.message) || containsLikelySecret(submission.subject)) {
    return { ok: false, message: "Please remove passwords, API keys, payment details, or private secrets before sending." };
  }

  return {
    ok: true,
    submission: {
      name: submission.name,
      email: submission.email,
      subject: submission.subject,
      message: submission.message,
      source: "portfolio-contact-form",
      submittedAt: new Date().toISOString(),
    },
  };
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

async function forwardSubmission(submission) {
  if (typeof fetch !== "function") {
    return { ok: false, status: 500, message: "The contact backend requires Node.js 18 or newer." };
  }

  if (!WEBHOOK_URL) {
    return { ok: false, status: 503, message: "The contact delivery endpoint is not configured yet." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "the-trendify-ai-contact-form/1.0",
    };

    if (WEBHOOK_TOKEN) {
      headers.Authorization = `Bearer ${WEBHOOK_TOKEN}`;
    }

    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(submission),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, status: 502, message: "The contact delivery endpoint rejected the message." };
    }

    return { ok: true };
  } catch {
    return { ok: false, status: 502, message: "The contact delivery endpoint could not be reached." };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleContactPost(req, res) {
  if (isRateLimited(req)) {
    sendHtml(res, 429, "Please Try Again Later", "Too many contact attempts were submitted from this connection.");
    return;
  }

  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim();
  if (contentType !== "application/x-www-form-urlencoded") {
    sendHtml(res, 415, "Unsupported Form Request", "Please submit the contact form from the website.");
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    sendHtml(res, 413, "Message Too Large", "Please shorten the message and try again.");
    return;
  }

  const validation = validateContactForm(new URLSearchParams(body));

  if (validation.bot) {
    setSecurityHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (!validation.ok) {
    sendHtml(res, 400, "Check Your Message", validation.message);
    return;
  }

  const delivery = await forwardSubmission(validation.submission);
  if (!delivery.ok) {
    sendHtml(res, delivery.status, "Contact Is Not Available Yet", delivery.message);
    return;
  }

  sendHtml(res, 200, "Message Sent", "Your message was accepted by the contact backend.");
}

async function serveStatic(req, res, pathname) {
  const routePath = staticRoutes.get(pathname);
  if (!routePath) {
    sendHtml(res, 404, "Page Not Found", "The requested page does not exist.");
    return;
  }

  const filePath = path.join(ROOT_DIR, routePath);
  const extension = path.extname(filePath);

  try {
    const body = await fs.readFile(filePath);
    setSecurityHeaders(res);
    res.writeHead(200, { "Content-Type": mimeTypes.get(extension) || "application/octet-stream" });
    res.end(body);
  } catch {
    sendHtml(res, 500, "Server Error", "The requested page could not be loaded.");
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname;

  if (req.method === "POST" && pathname === "/api/contact") {
    await handleContactPost(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res, pathname);
    return;
  }

  sendHtml(res, 405, "Method Not Allowed", "This route does not support that request method.");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Portfolio contact server running at http://127.0.0.1:${PORT}`);
});
