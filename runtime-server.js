const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const contactHandler = require("./api/contact.js");

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;

const staticFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/ar.html", "ar.html"],
  ["/contact.html", "contact.html"],
  ["/style.css", "style.css"],
  ["/favicon.svg", "favicon.svg"],
]);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
]);

function setStaticHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-Frame-Options", "DENY");
}

async function serveStatic(req, res, pathname) {
  const filename = staticFiles.get(pathname);

  if (!filename) {
    setStaticHeaders(res);
    res.statusCode = 404;
    res.end("Not Found");
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    setStaticHeaders(res);
    res.setHeader("Allow", "GET, HEAD");
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  const filePath = path.join(ROOT, filename);
  const body = await fs.readFile(filePath);

  setStaticHeaders(res);
  res.statusCode = 200;
  res.setHeader(
    "Content-Type",
    mimeTypes.get(path.extname(filename)) || "application/octet-stream"
  );
  res.setHeader("Content-Length", body.length);

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");

    if (url.pathname === "/healthz") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end('{"status":"ok"}');
      return;
    }

    if (url.pathname === "/api/contact") {
      await contactHandler(req, res);
      return;
    }

    await serveStatic(req, res, url.pathname);
  } catch {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    res.end("Internal Server Error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`The Trendify AI portfolio listening on port ${PORT}`);
});
