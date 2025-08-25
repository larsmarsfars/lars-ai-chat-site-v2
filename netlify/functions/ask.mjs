// netlify/functions/ask.mjs
let lastIngest = { notes: [], gallery: [] };

export default async (req) => {
  try {
    const body = await req.json();
    const messages = body?.messages || [];
    const ingested = body?.ingested || { notes: [], gallery: [] };
    if (ingested.notes?.length) lastIngest = ingested;

    const apiKey = process.env.OPENAI_API_KEY;
    const model  = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const proj   = process.env.OPENAI_PROJECT || "";
    const org    = process.env.OPENAI_ORG || "";
    if (!apiKey) return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY on Netlify" }), { status: 400 });

    if (lastIngest.notes?.length) {
      messages.push({ role: "user", content: "INGESTED NOTES (web summaries):\n" + JSON.stringify(lastIngest.notes).slice(0, 12000) });
    }

    const headers = { "Content-Type":"application/json", "Authorization":`Bearer ${apiKey}` };
    if (proj) headers["OpenAI-Project"] = proj;
    if (org)  headers["OpenAI-Organization"] = org;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method:"POST", headers, body: JSON.stringify({ model, temperature:0.4, messages })
    });
    const raw = await resp.text();
    if (!resp.ok) return new Response(JSON.stringify({ error:`OpenAI ${resp.status}: ${raw}` }), { status: 500 });
    const data = JSON.parse(raw);
    const text = data?.choices?.[0]?.message?.content || "(no content)";

    // Prefer ingested OG images; fallback to images function
    let images = (lastIngest.gallery || []).slice(0,4).map(g => g.src);
    if (!images.length) {
      const siteUrl = process.env.URL || "";
      try {
        const imgR = await fetch(`${siteUrl}/.netlify/functions/images`, {
          method:"POST", headers: { "Content-Type":"application/json" },
          body: JSON.stringify({ q: messages?.[messages.length-1]?.content || "Lars Jorgensen creative director" })
        });
        if (imgR.ok) { const j = await imgR.json(); images = j.urls || []; }
      } catch {}
    }

    return Response.json({ text, images, refs: (process.env.REFS_JSON ? JSON.parse(process.env.REFS_JSON) : []) });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error in ask" }), { status: 500 });
  }
};
