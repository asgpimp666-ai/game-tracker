// api/bgg.js
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;

  if (!url || !url.startsWith('https://boardgamegeek.com/xmlapi2/')) {
    return res.status(400).json({ error: 'Invalid BGG URL' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'GameTracker/1.0 (+https://your-site.com)',
        'Accept': 'application/xml'
      }
    });

    // Пробрасываем статус (включая 202!)
    res.status(response.status);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');

    const xml = await response.text();
    res.send(xml);
  } catch (err) {
    console.error('BGG Proxy Error:', err);
    res.status(500).json({ error: 'Proxy failed' });
  }
}