// server.js
require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(m=>m.default(...args));
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// Config từ .env
const X_COOKIE = process.env.X_COOKIE || '';
const X_USER_ID = process.env.X_USER_ID || ''; // numeric user id (required)
const CACHE_FILE = process.env.CACHE_FILE || path.join(__dirname, 'videos.json');
const CACHE_EXPIRE = parseInt(process.env.CACHE_EXPIRE || '6000', 10) * 1000; // env in seconds -> ms

// In-memory cache
let cache = { timestamp: 0, videos: [] };

// Helper: write cache file safely
function writeCacheFile(items) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(items, null, 2), { encoding: 'utf8' });
    console.log(`[cache] Saved ${items.length} items to ${CACHE_FILE}`);
  } catch (e) {
    console.error('[cache] Failed to write cache file', e);
  }
}

// Primary fetch function
async function fetchVideosFromX() {
  // If cache valid, return it
  if (Date.now() - cache.timestamp < CACHE_EXPIRE) {
    return cache.videos;
  }

  // Basic validation
  if (!X_USER_ID) {
    console.warn('[fetch] X_USER_ID not set — returning existing cache (if any)');
    return cache.videos;
  }

  // Build URL: use the (private) profile timeline GraphQL-ish endpoint pattern.
  // Note: this is best-effort; X changes their internal endpoints; with cookie + ct0 it often works.
  const url = `https://api.twitter.com/2/timeline/media_by_user.json?user_id=${encodeURIComponent(X_USER_ID)}`;

  // Headers: mimic browser
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `https://x.com/`,
    'Connection': 'keep-alive',
    ...(X_COOKIE ? { 'Cookie': X_COOKIE } : {})
    // don't set Authorization here — rely on cookie + ct0
  };

  try {
    const res = await fetch(url, { headers, method: 'GET' });
    if (!res.ok) {
      console.warn('[fetch] non-200 response', res.status);
      // Return cache if exist
      return cache.videos;
    }
    const data = await res.json();

    // Parse the structure to extract video infos.
    // NOTE: X internal shape varies. We try to support multiple shapes.
    const videos = [];

    // Case A: direct "globalObjects" style (older)
    if (data.globalObjects && data.globalObjects.tweets) {
      const tweets = Object.values(data.globalObjects.tweets);
      for (const t of tweets) {
        if (t.extended_entities && t.extended_entities.media) {
          for (const m of t.extended_entities.media) {
            if (m.type === 'video' || m.type === 'animated_gif') {
              const variants = (m.video_info && m.video_info.variants) || [];
              const mp4s = variants.filter(v => v.content_type === 'video/mp4');
              if (mp4s.length) {
                const best = mp4s.sort((a,b)=> (b.bitrate||0) - (a.bitrate||0))[0];
                videos.push({
                  id: t.id_str || t.id,
                  text: t.full_text || t.text || '',
                  date: t.created_at || '',
                  thumbnail: m.media_url_https || m.media_url || '',
                  video_url: best.url
                });
              }
            }
          }
        }
      }
    }

    // Case B: newer shapes — try to walk through data.includes or instructions
    if (videos.length === 0 && data.includes && data.includes.media) {
      // try to map includes.media with referenced tweets
      const mediaMap = {};
      for (const m of data.includes.media) {
        mediaMap[m.media_key || m.media_key] = m;
      }
      // If we have tweets in data.data or data.result
      const tweets = data.data || (data.result && data.result.timeline && data.result.timeline.instructions ? [] : []);
      // Try to extract any mp4 urls inside includes.media
      for (const m of Object.values(mediaMap)) {
        if ((m.type === 'video' || m.type === 'animated_gif') && m.variants) {
          const mp4s = m.variants.filter(v=> v.content_type && v.content_type.includes('video'));
          if (mp4s.length) {
            const best = mp4s.sort((a,b)=> (b.bitrate||0) - (a.bitrate||0))[0];
            videos.push({
              id: m.media_key || (m.id || ''),
              text: '',
              date: '',
              thumbnail: m.url || m.preview_image_url || '',
              video_url: best.url || best.uri || ''
            });
          }
        }
      }
    }

    // If still empty, try fallback: parse for 'video_url' in JSON string
    if (videos.length === 0) {
      const str = JSON.stringify(data);
      const re = /https?:\/\/video\.twimg\.com\/ext_tw_video\/[^\s"']+/g;
      const found = new Set();
      let m;
      while ((m = re.exec(str)) !== null) {
        found.add(m[0]);
      }
      for (const urlVideo of found) {
        videos.push({
          id: urlVideo,
          text: '',
          date: '',
          thumbnail: '',
          video_url: urlVideo
        });
      }
    }

    // Update cache
    cache = { timestamp: Date.now(), videos };
    writeCacheFile(videos);
    return videos;

  } catch (err) {
    console.error('[fetch] error fetching from X:', err.message || err);
    // return cache if present
    return cache.videos;
  }
}

// API - return JSON array
app.get('/api/videos', async (req, res) => {
  const videos = await fetchVideosFromX();
  res.json(videos);
});

// Serve the cache file for PHP / other hosts to download
app.get('/videos.json', (req, res) => {
  if (fs.existsSync(CACHE_FILE)) {
    res.sendFile(path.resolve(CACHE_FILE));
  } else {
    // If no cache yet, attempt to fetch once
    fetchVideosFromX().then(v=>{
      if (fs.existsSync(CACHE_FILE)) {
        res.sendFile(path.resolve(CACHE_FILE));
      } else {
        res.status(404).json({ error: 'No cache available' });
      }
    }).catch(()=> res.status(500).json({ error: 'Failed to fetch' }));
  }
});

// Health check
app.get('/_health', (req, res) => {
  res.json({ ok: true, cached: cache.videos.length, timestamp: cache.timestamp });
});

// Start
app.listen(PORT, () => {
  console.log(`x-video-crawler listening on port ${PORT}`);
});
