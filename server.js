require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const BEARER = process.env.BEARER_TOKEN;

// Lấy timeline của chính user (chỉ Free tier được)
async function getTimeline(userId) {
    const url = `https://api.x.com/2/users/${userId}/tweets?tweet.fields=created_at,public_metrics,attachments&expansions=attachments.media_keys&media.fields=url`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${BEARER}` }
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`X API ERROR ${res.status}: ${txt}`);
    }
    return res.json();
}

// Thay bằng userId của bạn (chính bạn)
const MY_USER_ID = "1686973224486416384";

app.get("/api/posts", async (req, res) => {
    try {
        const data = await getTimeline(MY_USER_ID);
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get("/", (req, res) => {
    res.json({ status: "OK", endpoint: "/api/posts" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on " + PORT));
