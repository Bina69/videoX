import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs-extra";
import path from "path";
import { CronJob } from "cron";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

const X_COOKIE = process.env.X_COOKIE || '';
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || '';
const X_USER_ID = process.env.X_USER_ID || '';
const CACHE_FILE = path.join(process.cwd(), process.env.CACHE_FILE || 'videos.json');
const CACHE_EXPIRE = Number(process.env.CACHE_EXPIRE || 600) * 1000;

// Tạo file cache rỗng nếu chưa có
if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, '[]', 'utf8');

// In-memory cache
let cache = { timestamp: 0, videos: [] };

// Ghi cache ra file
function writeCache(videos) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(videos, null, 2), 'utf8');
}

// Fetch video từ X GraphQL private
async function fetchVideos() {
  // Nếu cache còn hiệu lực
  if (Date.now() - cache.timestamp < CACHE_EXPIRE) return cache.videos;
  if (!X_USER_ID || !X_BEARER_TOKEN) return cache.videos;

  const url = `https://x.com/i/api/graphql/USER_MEDIA_HASH/UserMedia?variables=${encodeURIComponent(JSON.stringify({ userId: X_USER_ID, count: 50 }))}`;

  const headers = {
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'application/json',
    'Authorization': `Bearer ${X_BEARER_TOKEN}`,
    'x-csrf-token': (X_COOKIE.match(/ct0=([^;]+)/)||[])[1] || '',
    'Cookie': X_COOKIE
  };

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const videos = [];

    // Duyệt data -> extract video mp4
    const mediaEdges = data?.data?.user?.result?.timeline_videos?.edges || [];
    mediaEdges.forEach(edge => {
      const node = edge.node;
      if (node?.media?.type === 'video' && node.media.video_variants) {
        const best = node.media.video_variants
          .filter(v => v.content_type === 'video/mp4')
          .sort((a,b)=> (b.bitrate||0)-(a.bitrate||0))[0];
        if (best) {
          videos.push({
            id: node.rest_id || node.id,
            text: node.text || '',
            date: node.created_at || '',
            thumbnail: node.media.preview_image_url || '',
            video_url: best.url
          });
        }
      }
    });

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
new CronJob("*/5 * * * *", async ()=> {
  console.log('[cron] refresh cache...');
  try { await fetchVideos(); } catch {}
}).start();

// Start server
app.listen(PORT, () => console.log(`NodeJS X video server running on port ${PORT}`));
