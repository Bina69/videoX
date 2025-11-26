import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs-extra";
import path from "path";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

const X_COOKIE = process.env.X_COOKIE || '';
const X_USER_ID = process.env.X_USER_ID || '';
const CACHE_FILE = path.join(process.cwd(), process.env.CACHE_FILE || 'videos.json');
const CACHE_EXPIRE = Number(process.env.CACHE_EXPIRE || 600) * 1000;

// Tạo file cache rỗng nếu chưa có
if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, '[]', 'utf8');

// Cache in-memory
let cache = { timestamp: 0, videos: [] };

// Ghi cache ra file
function writeCache(videos) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(videos, null, 2), 'utf8');
}

// Fetch video từ X (GraphQL)
async function fetchVideos() {
  // Trả cache nếu chưa hết hạn
  if (Date.now() - cache.timestamp < CACHE_EXPIRE) return cache.videos;
  if (!X_USER_ID) return cache.videos;

  const url = `https://api.twitter.com/2/timeline/media_by_user.json?user_id=${X_USER_ID}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'application/json',
    'Cookie': X_COOKIE
  };

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const videos = [];

    // Parse kiểu globalObjects
    if (data.globalObjects?.tweets) {
      Object.values(data.globalObjects.tweets).forEach(t => {
        t.extended_entities?.media?.forEach(m => {
          if (m.type === 'video' || m.type === 'animated_gif') {
            const variants = (m.video_info?.variants || []).filter(v => v.content_type === 'video/mp4');
            if (variants.length) {
              const best = variants.sort((a,b)=> (b.bitrate||0)-(a.bitrate||0))[0];
              videos.push({
                id: t.id_str || t.id,
                text: t.full_text || t.text || '',
                date: t.created_at || '',
                thumbnail: m.media_url_https || m.media_url || '',
                video_url: best.url
              });
            }
          }
        });
      });
    }

    cache = { timestamp: Date.now(), videos };
    writeCache(videos);
    return videos;

  } catch(e) {
    console.error('[fetchVideos] error:', e.message);
    return cache.videos;
  }
}

// Route trả JSON cho PHP
app.get(['/videos', '/videos.json'], async (req, res) => {
  if (fs.existsSync(CACHE_FILE)) {
    res.sendFile(CACHE_FILE);
  } else {
    const videos = await fetchVideos();
    res.json(videos);
  }
});

// Cron refresh cache mỗi 5 phút
import { CronJob } from "cron";
new CronJob("*/5 * * * *", async ()=> {
  console.log('[cron] refresh cache...');
  try { await fetchVideos(); } catch {}
}).start();

// Start server
app.listen(PORT, () => console.log(`NodeJS X video server running on port ${PORT}`));
