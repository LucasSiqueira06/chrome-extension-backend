import { jwtVerify } from "jose";

async function verifyAppJwt(authHeader) {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Token ausente");
  const token = authHeader.slice(7);
  const secret = new TextEncoder().encode(process.env.APP_JWT_SECRET);
  const { payload } = await jwtVerify(token, secret);
  return payload;
}

async function rateLimit(userId) {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${userId}:${day}`;

  const r = await fetch(`${baseUrl}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, "86400"]
    ])
  });
  const [cnt] = await r.json();
  return Number(cnt?.result ?? 0);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const payload = await verifyAppJwt(req.headers.authorization);
    const used = await rateLimit(payload.sub);
    if (used > 100) return res.status(429).json({ error: "Limite diário atingido" });

    const { text } = req.body ?? {};
    if (!text || typeof text !== "string") return res.status(400).json({ error: "texto inválido" });

    const groq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.2,
        messages: [
          { role: "system", content: "Resuma com linguagem simples e foco em clareza." },
          { role: "user", content: `Resuma para alguém com TDAH/pouco tempo:\n\n${text}` }
        ]
      })
    });

    if (!groq.ok) {
      const err = await groq.text();
      return res.status(502).json({ error: err });
    }
    const data = await groq.json();
    const summary = data?.choices?.[0]?.message?.content ?? "(sem conteúdo)";
    return res.status(200).json({ summary });
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }
}

