// Local server for development.
//
//   node server.mjs        → http://localhost:4174
//
// 1. Serves the app (everything in app/), like `python3 -m http.server`.
// 2. GET /api/token hands out a one-time ticket (a "signed URL") for a
//    conversation with the ElevenLabs agent. The API key stays here on the
//    server; the app only ever sees the ticket, which expires after 15 minutes.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const appDir = join(root, "app");
const PORT = Number(process.env.PORT) || 4174;

// ---- settings from .env (same format the recording script uses) ----
if (existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const KEY = process.env.ELEVENLABS_SERVER_KEY;     // the read-only "jkk-server" key
const AGENT = process.env.ELEVENLABS_AGENT_ID;
// which settings were found – names only, never values
console.log("settings found:", Object.keys(process.env).filter((k) => k.startsWith("ELEVENLABS")).join(", ") || "none");

// ---- 1. the ticket ----
async function token(res) {
  if (!KEY || !AGENT) return send(res, 500, { error: "ELEVENLABS_SERVER_KEY or ELEVENLABS_AGENT_ID missing in .env" });

  const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(AGENT)}`;
  const r = await fetch(url, { headers: { "xi-api-key": KEY } });
  if (!r.ok) {
    // pass ElevenLabs' explanation on (it never contains the key)
    return send(res, 502, { error: `ElevenLabs answered ${r.status}`, detail: await r.text() });
  }
  const { signed_url } = await r.json();
  send(res, 200, { signedUrl: signed_url });
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

// ---- 2. the app's files ----
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".txt": "text/plain; charset=utf-8",
};

async function file(req, res) {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const full = normalize(join(appDir, path));
  if (!full.startsWith(appDir + sep)) return send(res, 403, { error: "forbidden" }); // no ../ escapes
  try {
    const data = await readFile(full);
    res.writeHead(200, { "Content-Type": TYPES[extname(full)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

// ---- the server ----
createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url.split("?")[0] === "/api/token") return await token(res);
    if (req.method === "GET") return await file(req, res);
    send(res, 405, { error: "method not allowed" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "server error" });
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
