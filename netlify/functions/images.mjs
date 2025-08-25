export default async (req) => {
  try {
    const { q = "creative director portfolio" } = await req.json();
    const bingKey = process.env.BING_API_KEY;
    const giphyKey = process.env.GIPHY_API_KEY;

    // Try Bing Image Search API first
    if (bingKey) {
      const r = await fetch(`https://api.bing.microsoft.com/v7.0/images/search?q=${encodeURIComponent(q)}&count=4&safeSearch=Moderate`, {
        headers: { "Ocp-Apim-Subscription-Key": bingKey }
      });
      if (r.ok) {
        const j = await r.json();
        const urls = (j.value || []).slice(0, 4).map(v => v.contentUrl).filter(Boolean);
        if (urls.length) return Response.json({ urls });
      }
    }

    // Fallback to a random GIF with Giphy for playful energy
    if (giphyKey) {
      const r = await fetch(`https://api.giphy.com/v1/gifs/random?api_key=${giphyKey}&tag=${encodeURIComponent(q)}&rating=pg-13`);
      if (r.ok) {
        const j = await r.json();
        const url = j?.data?.images?.downsized_large?.url || j?.data?.image_url;
        if (url) return Response.json({ urls: [url] });
      }
    }

    // Final fallback: no images
    return Response.json({ urls: [] });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), { status: 500 });
  }
};
