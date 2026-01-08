// api/bgg.js
export default async function handler(req, res) {
  // Устанавливаем CORS-заголовки ВСЕГДА
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
        'User-Agent': 'GameTracker/1.0 (+https://game-tracker-steel.vercel.app)',
        'Accept': 'application/xml'
      }
    });

    // Пробрасываем статус (включая 202)
    res.status(response.status);

    // ОБЯЗАТЕЛЬНО: явно указываем Content-Type + CORS
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*'); // ← дублируем для надёжности

    const xml = await response.text();
    res.send(xml);
  } catch (err) {
    console.error('BGG Proxy Error:', err);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(500).json({ error: 'Proxy failed' });
  }
}
