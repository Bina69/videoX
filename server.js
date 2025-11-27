import 'dotenv/config';
import express from 'express';
import { Client } from "twitter-api-sdk";
import fs from "fs";

const app = express();
const client = new Client(process.env.BEARER_TOKEN);

// DANH SÁCH POST CỦA BẠN
const MY_POST_IDS = [
    "1703401567628738561"
];

// FILE CACHE
const CACHE_FILE = "./cache.json";

// CORS
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    next();
});

// Hàm lưu cache
function saveCache(data) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

// Hàm load cache
function loadCache() {
    if (fs.existsSync(CACHE_FILE)) {
        return JSON.parse(fs.readFileSync(CACHE_FILE));
    }
    return null;
}

// =====================
//  API CHÍNH
// =====================
app.get("/api/posts", async (req, res) => {
    try {
        console.log("📥 Fetching X posts...");

        const response = await client.tweets.getPostsByIds({
            ids: MY_POST_IDS,
            "tweet.fields": ["text", "created_at", "public_metrics", "attachments", "author_id"],
            "expansions": ["author_id", "attachments.media_keys"],
            "media.fields": ["url", "preview_image_url"]
        });

        // Lưu cache
        saveCache(response);

        res.json({ success: true, data: response });

    } catch (err) {
        console.log("❌ LỖI, TRẢ CACHE");
        const cache = loadCache();
        if (cache) {
            return res.json({ success: true, cache: true, data: cache });
        }

        res.status(500).json({ success: false, error: err.message });
    }
});

// HEALTH CHECK
app.get("/", (req, res) => {
    res.json({
        ok: true,
        api: "/api/posts"
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
