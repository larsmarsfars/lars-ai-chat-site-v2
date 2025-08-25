// netlify/functions/ingest.mjs
// v3 — web search + domain crawl + sharp summaries + image extraction

let cache = { t: 0, notes: [], gallery: [] };

const MAX_BYTES   = parseInt(process.env.MAX_INGEST_BYTES || "180000", 10); // ~180 KB/page
const CHUNK_BYTES = parseInt(process.env.CHUNK_BYTES || "45000", 10);       // 45 KB summarize chunks
const CACHE_MS    = parseInt(process.env.INGEST_CACHE_MS || (5*60*1000), 10);
const PER_DOMAIN  = parseInt(process.env.CRAWL_PER_DOMAIN || "6", 10);      // pages per domain
const TIMEOUT_MS  = 12000;

function strip(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(svg|canvas|iframe|form|input|button|video|audio|source|picture)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(base, href) {
  try { return new URL(href, base).toString(); } catch { return ""; }
}

function domainOf(u){ try { return new URL(u).hostname.replace(/^www\./,""); } catch { return ""; } }

async function fetchText(url) {
  const ctl = new AbortController();
  const id = setTimeout(()=>ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { "User-Agent":"NetlifyIngest/1.0" }, signal: ctl.signal });
    const html = await r.text();
    return { ok: r.ok, status: r.status, url, html };
  } catch (e) {
    return { ok:false, status:0, url, html:"", err:e?.message };
  } finally { clearTimeout(id); }
}

function ogImages(html, baseUrl) {
  const urls = new Set();
  const add = (m) => { const u = m?.[1]?.trim(); if (u) urls.add(absUrl(baseUrl, u)); };
  html.replace(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi, (_,u)=>add([,u]));
  html.replace(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi, (_,u)=>add([,u]));
  html.replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, (_,u)=>{ const U=absUrl(baseUrl,u); if(/\.(jpg|jpeg|png|webp)$/i.test(U)) urls.add(U); });
  return Array.from(urls).slice(0,4);
}

async function bingSearch(q, key, count=8) {
  if (!key || !process.env.BING_SEARCH) return [];
  const r = await fetch(`https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}&count=${count}`, {
    headers: { "Ocp-Apim-Subscription-Key": key }
  });
  if (!r.ok) return [];
  const j = await r.json();
  const web = j.webPages?.value || [];
  return web.map(x => x.url).filter(Boolean);
}

function uniqueBy(arr, keyFn) {
  const seen = new Set(); const out = [];
  for (const x of arr) { const k = keyFn(x); if (k && !seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

async function summarizeChunks(chunks, headers, model) {
  const partials = [];
  for (const c of chunks) {
    const prompt = [
      { role:"system", content:
`Extract sharp, factual notes for a creative portfolio.
KEEP PROPER NOUNS (project names, collaborators, agencies, brands), years, roles, awards only if explicit, and a one-line "how it worked".
Return 6–10 compact bullets, no fluff.` },
      { role:"user", content: c }
    ];
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method:"POST", headers, body: JSON.stringify({ model, temperature:0.1, messages: prompt })
    });
    const j = await r.json();
    partials.push(j?.choices?.[0]?.message?.content || "");
  }
  const joinPass = [
    { role:"system", content:
`Fuse into one crisp fact-pack for a portfolio assistant.
Keep: project names, collaborators (credit first), role, what was made, where/when, verifiable outcomes.
Output 8–14 bullets. No generic adjectives. No speculation.` },
    { role:"user", content: partials.join("\n\n") }
  ];
  const r2 = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST", headers, body: JSON.stringify({ model, temperature:0.1, messages: joinPass })
  });
  const j2 = await r2.json();
  return j2?.choices?.[0]?.message?.content || partials.join("\n");
}

export default async (req) => {
  try {
    const { urls = [], queries = [], allowDomains = [] } = await req.json();
    const now = Date.now();
    if (cache.notes.length && now - cache.t < CACHE_MS) {
      return Response.json({ notes: cache.notes, gallery: cache.gallery, cached: true });
    }

    // Build target URL list: given urls + Bing search results for queries
    const bingKey = process.env.BING_API_KEY;
    let expanded = [...urls];
    for (const q of (queries || [])) {
      const found = await bingSearch(q, bingKey, 8);
      expanded.push(...found);
    }
    expanded = uniqueBy(expanded, u => {
      try { return new URL(u).toString().replace(/#.*$/, ""); } catch { return u; }
    });

    // Filter to allowed domains if provided
    const allowSet = new Set((allowDomains||[]).map(d=>d.toLowerCase()));
    if (allowSet.size) {
      expanded = expanded.filter(u => allowSet.has(domainOf(u).toLowerCase()));
    }

    // Crawl within each domain (shallow BFS via same-page links)
    const perDomain = {};
    const queue = [...expanded];
    const fetched = [];
    const gallery = [];

    while (queue.length) {
      const url = queue.shift();
      const dom = domainOf(url);
      if (!dom) continue;
      perDomain[dom] = perDomain[dom] || 0;
      if (perDomain[dom] >= PER_DOMAIN) continue;
      perDomain[dom]++;

      const { ok, html } = await fetchText(url);
      if (!ok || !html) continue;
      fetched.push({ url, html });
      // collect OG images
      ogImages(html, url).forEach(u => gallery.push({ src: u, from: url }));

      // add a few on-site links
      const links = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)).map(m=>absUrl(url, m[1]));
      for (const L of links) {
        const d2 = domainOf(L);
        if (d2 === dom && (perDomain[dom]||0) < PER_DOMAIN && /\.[a-z]{2,}/.test(L)) queue.push(L);
        if (queue.length > 100) break;
      }
    }

    // Summarize each fetched page (chunked)
    const apiKey = process.env.OPENAI_API_KEY;
    const model  = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!apiKey) {
      const notes = fetched.map(p => ({ url: p.url, note: strip(p.html).slice(0, 800) }));
      cache = { t: now, notes, gallery };
      return Response.json({ notes, gallery, offline: true });
    }

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    };
    if (process.env.OPENAI_PROJECT) headers["OpenAI-Project"] = process.env.OPENAI_PROJECT;
    if (process.env.OPENAI_ORG) headers["OpenAI-Organization"] = process.env.OPENAI_ORG;

    const notes = [];
    for (const p of fetched) {
      const text = strip(p.html).slice(0, MAX_BYTES);
      if (!text) continue;
      const chunks = [];
      for (let i=0;i<text.length;i+=CHUNK_BYTES) chunks.push(text.slice(i, i+CHUNK_BYTES));
      const note = await summarizeChunks(chunks, headers, model);
      notes.push({ url: p.url, note });
    }

    cache = { t: now, notes, gallery: uniqueBy(gallery, g=>g.src) };
    return Response.json({ notes: cache.notes, gallery: cache.gallery });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error in ingest" }), { status: 500 });
  }
};
