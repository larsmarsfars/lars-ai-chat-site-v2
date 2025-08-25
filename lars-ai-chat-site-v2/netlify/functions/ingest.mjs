let memory = { last: 0, notes: [] };

export default async (req) => {
  try {
    const { urls = [] } = await req.json();
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const now = Date.now();
    if (memory.notes.length && now - memory.last < 5 * 60 * 1000) return Response.json({ notes: memory.notes, cached: true });

    const texts = await Promise.all(urls.map(async (u) => {
      try {
        const res = await fetch(u, { headers: { "User-Agent": "NetlifyBot" } });
        const html = await res.text();
        const plain = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 20000);
        return { url: u, text: plain };
      } catch { return { url: u, text: "" }; }
    }));

    if (!apiKey) return Response.json({ notes: texts.map(t => ({ url: t.url, note: t.text.slice(0, 500) })) });

    const prompt = [
      { role: "system", content: "Summarize each source into a compact fact pack for a portfolio assistant. Keep it truthful, names-heavy (collaborators/agencies), projects, titles, awards if explicit. 80-120 words per source, plain text." },
      { role: "user", content: JSON.stringify(texts) }
    ];

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.2, messages: prompt })
    });
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const splits = content.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
    memory.notes = splits.map((note, i) => ({ url: urls[i] || urls[0], note }));
    memory.last = now;
    return Response.json({ notes: memory.notes });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), { status: 500 });
  }
};
