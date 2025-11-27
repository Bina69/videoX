import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const BEARER = process.env.BEARER_TOKEN;

async function getTweet(id) {
    const url = `https://api.x.com/2/tweets/${id}?expansions=author_id,attachments.media_keys&media.fields=url,preview_image_url&user.fields=username,name,profile_image_url&tweet.fields=public_metrics,created_at`;

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${BEARER}` }
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`X API error ${res.status}: ${text}`);
    }

    return res.json();
}

// nếu bạn muốn nhiều bài, chỉnh array này
const TWEET_IDS = [
    "1703401567628738561"
    
];

app.get("/api/posts", async (req, res) => {
    try {
        const results = [];

        for (const id of TWEET_IDS) {
            const data = await getTweet(id);
            results.push(data);
        }

        res.json({
            success: true,
            count: results.length,
            items: results
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.listen(3000, () => console.log("API running on 3000"));
