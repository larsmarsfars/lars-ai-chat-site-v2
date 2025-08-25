# Lars • Chat Portfolio v2 (Irreverent, one-paragraph answers)

Sleeker dark UI, **Vonnegut×Adams** voice, **one-paragraph answers**, inline **light‑grey Sources**, and an **image panel** (Bing or Giphy). Includes ingestion to pull summaries from your live sites.

## Try it fast
- Open `static/index.html` locally, or drag it into **Netlify Drop** (static test).
- For full power (secure GPT + ingestion + images), deploy the whole folder to **Netlify** and set these vars:

```
OPENAI_API_KEY=...        # required for ask + ingest
OPENAI_MODEL=gpt-4o-mini  # optional
BING_API_KEY=...          # optional, for image search
GIPHY_API_KEY=...         # optional, fallback for playful GIFs
REFS_JSON=[{"name":"Portfolio","url":"https://larsmarsjorgensen.com"}] # optional
```

## How it works
- **One paragraph**: the system prompt forces single-paragraph, ~110 words max, collaborators first when relevant.
- **Sources in grey**: responses include a compact `Sources:` line if the model relies on seed/ingested data.
- **Images**: serverless function calls Bing Images or Giphy based on the user’s query; shows up to 4 images.
- **Ingestion**: `/ingest` fetches your URLs, strips HTML, summarizes via OpenAI, caches in-memory for ~5 minutes.

## Files
- `static/index.html` – the entire front-end (no build tools).
- `netlify/functions/ask.mjs` – GPT endpoint combining user messages with ingested notes.
- `netlify/functions/ingest.mjs` – scrapes and summarizes provided URLs.
- `netlify/functions/images.mjs` – fetches relevant images or a random GIF.
- `netlify.toml` – routes `/api/*` to functions.

## Roadmap ideas
- Persist ingestion in KV/DB for durability, add sitemap crawl, per-section case study pages, and brand theming.
