const SYSTEM = "You are Verity, a cheerful yellow smiley-face character who loves knowing things and sharing them. Give genuinely intelligent, thoughtful, well-reasoned answers with real substance and useful detail. Be warm and upbeat, and rhyme only occasionally: at most one playful rhyming line or sign-off now and then, never a whole rhyming answer. Stay accurate: if you are unsure or don't know something, say so cheerfully instead of making it up. Two special cases: if asked for the capital of France, reply with exactly: Oh Oui Oui Oui it is Paris! (and nothing else); if asked what the cow says, reply with exactly: Oh moo moo moo, I speak that too (and nothing else). Use plain text without markdown. If images are attached, study them carefully and answer based on what you actually see (for videos you are given evenly spaced frames and cannot hear audio). Reply as Verity.";
const MODEL = Netlify.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: { message: "Method not allowed" } }, 405);
  const key = Netlify.env.get("ANTHROPIC_API_KEY");
  const base = (Netlify.env.get("ANTHROPIC_BASE_URL") || "https://api.anthropic.com").replace(/\/+$/, "");

  let body;
  try {
    const raw = await req.text();
    if (raw.length > 5000000) return json({ error: { message: "That message is too large." } }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: { message: "Bad request." } }, 400);
  }

  // Rebuild the messages ourselves so visitors can only send plain text and small JPEG images.
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 20)
    return json({ error: { message: "Bad request." } }, 400);
  let images = 0;
  const clean = [];
  for (const m of body.messages) {
    if (m.role !== "user" && m.role !== "assistant") return json({ error: { message: "Bad request." } }, 400);
    if (m.role === "assistant") {
      clean.push({ role: "assistant", content: String(m.content || "").slice(0, 6000) });
      continue;
    }
    const blocks = [];
    for (const b of Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content || "") }]) {
      if (b.type === "text") blocks.push({ type: "text", text: String(b.text || "").slice(0, 4000) });
      else if (b.type === "image" && b.source && b.source.type === "base64" && typeof b.source.data === "string" && b.source.data.length < 1500000) {
        if (++images > 4) return json({ error: { message: "Please send at most 4 images at a time." } }, 400);
        blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b.source.data } });
      }
    }
    if (blocks.length === 0) return json({ error: { message: "Bad request." } }, 400);
    clean.push({ role: "user", content: blocks });
  }
  if (clean[clean.length - 1].role !== "user") return json({ error: { message: "Bad request." } }, 400);

  const upstream = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, stream: true, system: SYSTEM, messages: clean }),
  });
  if (!upstream.ok) {
    console.error("Anthropic error", upstream.status, await upstream.text());
    return json({ error: { message: "Verity is having trouble right now. Try again in a moment." } }, 502);
  }
  return new Response(upstream.body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
};

export const config = {
  path: "/api/chat",
  rateLimit: { windowLimit: 15, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
