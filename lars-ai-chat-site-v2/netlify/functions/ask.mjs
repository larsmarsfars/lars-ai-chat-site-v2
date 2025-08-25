let cache = { ingested: [] };

export default async (req) => {
  try {
    const body = await req.json();
    const messages = body?.messages || [];
    const ingested = body?.ingested || { notes: [] };
    cache.ingested = ingested.notes || [];

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!apiKey) return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), { status: 400 });

    // Append ingested notes to the conversation (as additional user context)
    messages.push({ role: "user", content: "INGESTED NOTES (web summaries):\n" + JSON.stringify(cache.ingested).slice(0, 12000) });

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.5, messages })
    });
    if (!resp.ok) return new Response(JSON.stringify({ error: await resp.text() }), { status: 500 });
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content || "";
    // Optionally request images
    const images = await fetch(process.env.IMAGES_ENDPOINT || "/.netlify/functions/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: messages?.[messages.length-1]?.content || "Lars Jorgensen portfolio" })
    }).then(r=>r.json()).catch(()=>({ urls: [] }));

    return Response.json({ text, images: images.urls || [], refs: (process.env.REFS_JSON ? JSON.parse(process.env.REFS_JSON) : []) });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), { status: 500 });
  }
};
