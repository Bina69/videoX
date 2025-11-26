require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.static('public'));

// ---- Config từ .env ----
const USERNAME = process.env.USERNAME;
const X_COOKIE = process.env.X_COOKIE || '';
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || '';
const CACHE_FILE = process.env.CACHE_FILE || path.join(__dirname, 'videos.json');
const CACHE_EXPIRE = parseInt(process.env.CACHE_EXPIRE) || 6000000; // 10 phút

// ---- Cache ----
let cache = { timestamp: 0, videos: [] };

// ---- Hàm fetch video ----
async function fetchVideos() {
  try {
    // Nếu cache chưa hết hạn
    if (Date.now() - cache.timestamp < CACHE_EXPIRE) return cache.videos;

    const url = `https://api.twitter.com/2/timeline/profile/${USERNAME}.json`;

    const headers = {
      'User-Agent': 'Mozilla/5.0',
      ...(X_BEARER_TOKEN && { Authorization: `Bearer ${X_BEARER_TOKEN}` }),
      ...(X_COOKIE && { Cookie: X_COOKIE })
    };

    const res = await fetch(url, { headers });
    const data = await res.json();

    const videos = [];

    if (data && data.globalObjects && data.globalObjects.tweets) {
      const tweets = Object.values(data.globalObjects.tweets);
      for (let t of tweets) {
        if (t.extended_entities && t.extended_entities.media) {
          t.extended_entities.media.forEach(m => {
            if (m.type === 'video' || m.type === 'animated_gif') {
              const variants = m.video_info.variants.filter(v => v.content_type === 'video/mp4');
              const best = variants.sort((a,b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
              if (best) {
                videos.push({
                  text: t.full_text,
                  date: t.created_at,
                  video_url: best.url,
                  thumbnail: m.media_url_https
                });
              }
            }
          });
        }
      }
    }

    // ---- Cache + lưu file ----
    cache = { timestamp: Date.now(), videos };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(videos, null, 2));
    console.log(`Saved ${videos.length} videos to ${CACHE_FILE}`);

    return videos;

  } catch (err) {
    console.error(err);
    // Nếu fetch lỗi, vẫn trả cache cũ
    return cache.videos;
  }
}

// ---- API endpoint ----
app.get('/api/videos', async (req, res) => {
  const videos = await fetchVideos();
  res.json(videos);
});

// ---- Endpoint trả file JSON trực tiếp ----
app.get('/videos.json', (req, res) => {
  if (fs.existsSync(CACHE_FILE)) {
    res.sendFile(CACHE_FILE);
  } else {
    res.status(404).json({ error: 'No cache file found' });
  }
});

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
