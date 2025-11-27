import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors());

const BEARER = process.env.BEARER;
const USER_ID = process.env.USER_ID;

// ===============================
// GET TIMELINE
// ===============================
app.get("/timeline", async (req, res) => {
    try {
        const url = `https://api.x.com/2/users/${USER_ID}/tweets?max_results=10&tweet.fields=created_at,public_metrics,entities`;

        const response = await axios.get(url, {
            headers: {
                "Authorization": `Bearer ${BEARER}`,
                "User-Agent": "Mozilla/5.0",          // quan trọng
                "Accept-Language": "en-US,en;q=0.9",  // bắt buộc để X cho truy cập
                "Accept": "*/*"
            }
        });

        return res.json({
            success: true,
            data: response.data
        });

    } catch (err) {
        return res.json({
            success: false,
            error: err.response?.data || err.message
        });
    }
});


// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("API running on " + PORT));
