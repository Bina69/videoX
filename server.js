require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const BEARER = process.env.BEARER_TOKEN;

// Danh sách tweet muốn lấy
const TWEET_IDS = [
    "1870530689844078669",
    "1869919215071815788"
];

async function getTweet(id) {
    const url = `https://api.x.com/2/tweets/${id}?expansions=author_id,attachments.media_keys&media.fields=url,preview_image_url&user.fields=username,name,profile_image_url&tweet.fields=public_metrics,created_at`;

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${BEARER}` }
    });

    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`X API ERROR ${res.status}: ${txt}`);
    }

    return res.json();
}

app.get("/api/posts", async (req, res) => {
    try {
        const results = [];
        for (const id of TWEET_IDS) {
            results.push(await getTweet(id));
        }

        res.json({
            success: true,
            items: results
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.get("/", (req, res) => {
    res.json({ status: "OK", endpoint: "/api/posts" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on " + PORT));
