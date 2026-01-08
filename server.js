// server.js
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Разрешаем CORS для всех
app.use(cors());

// Прокси для BGG
app.get('/bgg', async (req, res) => {
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

    res.status(response.status);
    res.set('Content-Type', 'application/xml; charset=utf-8');
    const xml = await response.text();
    res.send(xml);
  } catch (err) {
    console.error('BGG Proxy Error:', err);
    res.status(500).json({ error: 'Proxy failed' });
  }
});

// Обслуживаем статические файлы (опционально)
app.use(express.static('public'));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'BGG Proxy is running' });
});

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
});