// The production server on Cloudflare – the online twin of server.mjs.
//
// Cloudflare serves everything in app/ as static files by itself (see
// wrangler.jsonc). Only requests that don't match a file reach this code,
// and the only one we answer is GET /api/token: a ticket (signed URL) for the
// live coach. The server key lives in Cloudflare's secrets, never in app/.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/token" && request.method === "GET") return token(request, env);
    return env.ASSETS.fetch(request); // anything else: a file from app/ (or 404)
  },
};

async function token(request, env) {
  // Only our own pages may ask. Browsers mark where a request comes from;
  // another website calling us gets "cross-site" and is turned away.
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return json(403, { error: "Not allowed" });

  // Anyone can call this address, and every ticket can start a conversation
  // on our bill – so a few tickets per minute per visitor, no more.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const { success } = await env.TOKEN_LIMITER.limit({ key: ip });
  if (!success) return json(429, { error: "Too many requests – try again in a minute" });

  // While the live coach is being tested, only the owner's phone gets tickets
  // (the app sends the code it got from ?tester=…). No TESTER_KEY set = nobody.
  if (!(await sameSecret(request.headers.get("X-Tester"), env.TESTER_KEY))) {
    return json(403, { error: "The live coach is not available" });
  }

  if (!env.ELEVENLABS_SERVER_KEY || !env.ELEVENLABS_AGENT_ID) {
    return json(500, { error: "ELEVENLABS_SERVER_KEY or ELEVENLABS_AGENT_ID missing (wrangler secret put)" });
  }
  const r = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(env.ELEVENLABS_AGENT_ID)}`,
    { headers: { "xi-api-key": env.ELEVENLABS_SERVER_KEY } }
  );
  if (!r.ok) {
    // details go to Cloudflare's log (wrangler tail), not to the public
    console.error("ElevenLabs answered", r.status, await r.text());
    return json(502, { error: `ElevenLabs answered ${r.status}` });
  }
  const { signed_url } = await r.json();
  return json(200, { signedUrl: signed_url });
}

// Compare without leaking how many characters matched (timing).
async function sameSecret(given, expected) {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map((t) => crypto.subtle.digest("SHA-256", enc.encode(t))));
  return crypto.subtle.timingSafeEqual(a, b);
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
