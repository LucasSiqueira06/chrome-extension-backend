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
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { text, options } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Campo 'text' é obrigatório" });
    }

    const style = (options?.style || "mesclado").toLowerCase(); // "texto" | "topicos" | "mesclado"

    // ===== Prompt templates por estilo =====
    const systemBase = `
Você é um assistente que escreve para pessoas com TDAH/pouco tempo.
Use linguagem simples, frases curtas e foco em clareza.
Responda em PT-BR se o texto estiver em PT-BR; caso contrário, espelhe o idioma de entrada.
Não invente fatos; se algo não estiver no texto, diga "não informado".
Apenas devolva o resumo de forma mecânica, não apresente e nem converse.
`;

    const styleRules = {
      texto: `
FORMATO OBRIGATÓRIO:
- Apenas parágrafos curtos (2–4 frases cada).
- Não use bullets.
- Se houver listas no original, converta-as em frases claras.
- Se houver datas/nomes, destaque com **negrito**.
      `.trim(),

      topicos: `
FORMATO OBRIGATÓRIO:
- Somente tópicos em bullet points (comece cada linha com "* ").
- 4–8 bullets, cada um com até 1–2 frases.
- Destaque datas/nomes com **negrito**.
- Não inclua parágrafos fora dos bullets.
      `.trim(),

      mesclado: `
FORMATO OBRIGATÓRIO:
- Comece com "TL;DR:" em uma única linha (1–2 frases).
- Em seguida traga 4–7 bullets (cada linha começando com "* ").
- Destaque datas/nomes com **negrito**.
- Não adicione seções extras além do TL;DR e bullets.
      `.trim()
    };

    const sys = `${systemBase}\n${styleRules[style] || styleRules.mesclado}`;

    // ===== Chamada Groq =====
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: `Resuma o texto a seguir obedecendo estritamente ao FORMATO OBRIGATÓRIO do sistema:\n\n"""${text}"""`
          }
        ]
      })
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      return res.status(resp.status).json({ error: `Groq API error: ${errTxt}` });
    }

    const data = await resp.json();
    const summary = data?.choices?.[0]?.message?.content?.trim() || "";

    // Sanitiza fallback simples
    if (!summary) {
      return res.status(500).json({ error: "Resumo vazio" });
    }

    return res.status(200).json({ summary });
  } catch (e) {
    console.error("summarize error:", e);
    return res.status(500).json({ error: e?.message || "Erro interno" });
  }
}

