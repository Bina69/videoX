require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require("twitter-api-sdk");
const NodeCache = require('node-cache');

const app = express();
app.use(cors());
app.use(express.json());

// Cache để tối ưu hiệu suất
const cache = new NodeCache({ stdTTL: 300 }); // 5 phút cache

const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const YOUR_USERNAME = process.env.TWITTER_USERNAME || 'yourusername';

// Khởi tạo Twitter Client
const client = new Client(BEARER_TOKEN);

class TwitterTimelineService {
    constructor() {
        this.client = client;
    }

    // Lấy user ID từ username
    async getUserId(username) {
        const cacheKey = `userid_${username}`;
        let userId = cache.get(cacheKey);
        
        if (userId) return userId;

        const user = await this.client.users.findUserByUsername(username);
        userId = user.data.id;
        
        cache.set(cacheKey, userId, 3600); // Cache 1 giờ
        return userId;
    }

    // Lấy tweet IDs từ user - TỐI ƯU
    async getTweetIds(userId, maxResults = 15) {
        const cacheKey = `tweetids_${userId}_${maxResults}`;
        let tweetIds = cache.get(cacheKey);
        
        if (tweetIds) return tweetIds;

        const tweets = await this.client.tweets.usersIdTweets(userId, {
            max_results: maxResults,
            exclude: ['retweets', 'replies'],
            'tweet.fields': ['created_at', 'public_metrics', 'author_id']
        });

        tweetIds = tweets.data.map(tweet => tweet.id);
        cache.set(cacheKey, tweetIds, 300); // Cache 5 phút
        
        return tweetIds;
    }

    // Lấy chi tiết tweets bằng SDK - HIỆU QUẢ CAO
    async getTweetsDetail(tweetIds) {
        const cacheKey = `tweets_${tweetIds.join('_')}`;
        let tweets = cache.get(cacheKey);
        
        if (tweets) return tweets;

        const response = await this.client.tweets.getPostsByIds({
            ids: tweetIds,
            "tweet.fields": [
                "author_id",
                "created_at",
                "public_metrics", 
                "text",
                "context_annotations",
                "entities",
                "attachments",
                "referenced_tweets",
                "reply_settings"
            ],
            "expansions": [
                "author_id",
                "attachments.media_keys",
                "referenced_tweets.id",
                "referenced_tweets.id.author_id"
            ],
            "user.fields": [
                "name",
                "username", 
                "profile_image_url",
                "verified",
                "description"
            ],
            "media.fields": [
                "url",
                "preview_image_url",
                "type",
                "width", 
                "height"
            ]
        });

        // Xử lý response để kết hợp dữ liệu
        tweets = this.processTweetResponse(response);
        cache.set(cacheKey, tweets, 300); // Cache 5 phút
        
        return tweets;
    }

    // Xử lý response từ SDK
    processTweetResponse(response) {
        const usersMap = {};
        const mediaMap = {};
        const tweetsMap = {};

        // Map users
        if (response.includes && response.includes.users) {
            response.includes.users.forEach(user => {
                usersMap[user.id] = user;
            });
        }

        // Map media
        if (response.includes && response.includes.media) {
            response.includes.media.forEach(media => {
                mediaMap[media.media_key] = media;
            });
        }

        // Map tweets (cho referenced tweets)
        if (response.includes && response.includes.tweets) {
            response.includes.tweets.forEach(tweet => {
                tweetsMap[tweet.id] = tweet;
            });
        }

        // Kết hợp dữ liệu
        return response.data.map(tweet => {
            const processedTweet = {
                id: tweet.id,
                text: tweet.text,
                created_at: tweet.created_at,
                public_metrics: tweet.public_metrics,
                author_id: tweet.author_id,
                user: usersMap[tweet.author_id] || null,
                media: [],
                referenced_tweets: []
            };

            // Xử lý media attachments
            if (tweet.attachments && tweet.attachments.media_keys) {
                processedTweet.media = tweet.attachments.media_keys.map(key => 
                    mediaMap[key] || null
                ).filter(Boolean);
            }

            // Xử lý referenced tweets
            if (tweet.referenced_tweets) {
                processedTweet.referenced_tweets = tweet.referenced_tweets.map(ref => ({
                    type: ref.type,
                    tweet: tweetsMap[ref.id] ? {
                        ...tweetsMap[ref.id],
                        user: usersMap[tweetsMap[ref.id].author_id] || null
                    } : null
                }));
            }

            return processedTweet;
        });
    }

    // Lấy toàn bộ timeline của user
    async getUserTimeline(username, maxResults = 15) {
        try {
            console.log(`📱 Getting timeline for: @${username}`);
            
            const userId = await this.getUserId(username);
            const tweetIds = await this.getTweetIds(userId, maxResults);
            const tweets = await this.getTweetsDetail(tweetIds);
            
            console.log(`✅ Got ${tweets.length} tweets from @${username}`);
            return tweets;
        } catch (error) {
            console.error('❌ Error getting timeline:', error);
            throw new Error(`Không thể lấy timeline của @${username}`);
        }
    }

    // Lấy timeline của chính bạn
    async getMyTimeline() {
        return await this.getUserTimeline(YOUR_USERNAME, 15);
    }
}

const twitterService = new TwitterTimelineService();

// Routes
app.get('/', (req, res) => {
    res.json({ 
        message: 'Twitter Timeline API - Official SDK Version',
        version: '2.0.0',
        endpoints: {
            my_timeline: '/api/my-timeline',
            user_timeline: '/api/timeline/:username',
            health: '/health'
        }
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        cache_stats: cache.getStats()
    });
});

// Timeline của bạn
app.get('/api/my-timeline', async (req, res) => {
    try {
        const { limit = 15 } = req.query;
        const tweets = await twitterService.getMyTimeline(parseInt(limit));
        
        res.json({
            success: true,
            data: tweets,
            count: tweets.length,
            user: YOUR_USERNAME,
            cached: true
        });
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Timeline của user bất kỳ
app.get('/api/timeline/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { limit = 15 } = req.query;
        
        const tweets = await twitterService.getUserTimeline(username, parseInt(limit));
        
        res.json({
            success: true,
            data: tweets,
            count: tweets.length,
            user: username
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Lấy multiple timelines
app.get('/api/timelines', async (req, res) => {
    try {
        const { users = YOUR_USERNAME, limit = 10 } = req.query;
        const usernames = users.split(',');
        
        const timelines = await Promise.all(
            usernames.map(username => 
                twitterService.getUserTimeline(username, parseInt(limit))
                    .then(tweets => ({ username, tweets }))
                    .catch(error => ({ username, error: error.message, tweets: [] }))
            )
        );

        res.json({
            success: true,
            data: timelines
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Twitter Timeline API running on port ${PORT}`);
    console.log(`📱 Tracking: @${YOUR_USERNAME}`);
    console.log(`💡 Using Official Twitter API SDK`);
});
