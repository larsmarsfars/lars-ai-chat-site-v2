// netlify/functions/ask.mjs
let cache = { ingested: [] };

export default async (req) => {
  try {
    const body = await req.json();
    const messages = body?.messages || [];
    const ingested = body?.ingested || { notes: [] };
    cache.ingested = ingested.notes || [];

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const openaiProject = process.env.OPENAI_PROJECT || "";      // <-- you set this in Netlify
    const openaiOrg = process.env.OPENAI_ORG || "";              // optional

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY on Netlify" }), { status: 400 });
    }

    // Add ingested notes into the conversation (compact)
    if (cache.ingested.length) {
      messages.push({
        role: "user",
        content: "INGESTED NOTES (web summaries):\n" + JSON.stringify(cache.ingested).slice(0, 12000)
      });
    }

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    };
    if (openaiProject) headers["OpenAI-Project"] = openaiProject; // <-- critical for sk-proj keys
    if (openaiOrg) headers["OpenAI-Organization"] = openaiOrg;

    const payload = { model, temperature: 0.5, messages };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const raw = await resp.text();
    if (!resp.ok) {
      console.error("OpenAI HTTP", resp.status, raw); // shows in Netlify → Functions → ask → Invocation logs
      return new Response(JSON.stringify({ error: `OpenAI ${resp.status}: ${raw}` }), { status: 500 });
    }

    let data;
    try { data = JSON.parse(raw); } catch (e) {
      console.error("OpenAI JSON parse error:", e.message, "RAW:", raw);
      return new Response(JSON.stringify({ error: "OpenAI JSON parse error", raw }), { status: 500 });
    }

    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      console.warn("OpenAI returned no message content. Full payload:", JSON.stringify(data).slice(0, 4000));
      return Response.json({ text: "(no content from OpenAI)", payloadPreview: JSON.stringify(data).slice(0, 2000) });
    }

    // Try images (best-effort) using absolute URL
    let images = [];
    try {
      const siteUrl = process.env.URL || ""; // provided by Netlify
      const imgResp = await fetch(`${siteUrl}/.netlify/functions/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: messages?.[messages.length - 1]?.content || "Lars Jorgensen portfolio" })
      });
      if (imgResp.ok) {
        const j = await imgResp.json();
        images = j.urls || [];
      }
    } catch (e) {
      console.warn("Images function error:", e?.message);
    }

    return Response.json({
      text,
      images,
      refs: (process.env.REFS_JSON ? JSON.parse(process.env.REFS_JSON) : [])
    });

  } catch (e) {
    console.error("ask.mjs fatal:", e?.stack || e?.message);
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), { status: 500 });
  }
};
