const { Redis } = require('@upstash/redis');
require('dotenv').config();

// Automatically pulls from UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your .env
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function init() {
    console.log("Connecting to Upstash Redis via REST...");
    try {
        // 1. Generate serials GHOST-001 through GHOST-900
        const serials = Array.from({ length: 900 }, (_, i) => 
            `GHOST-${(i + 1).toString().padStart(3, '0')}`
        );

        console.log("Generating 900 serials...");

        // 2. Clear existing set to avoid duplicates or old data (Clean Slate)
        await redis.del('available_serials');

        // 3. Add all 900 to the Redis Set
        // Note: @upstash/redis handles arrays slightly differently, 
        // we use the spread operator to add them all at once.
        await redis.sadd('available_serials', ...serials);
        
        const count = await redis.scard('available_serials');
        console.log(`🚀 Success! ${count} Serials Loaded into GHOST_PROTOCOL.`);
        
        process.exit(0);
    } catch (error) {
        console.error("❌ Failed to load serials:", error);
        process.exit(1);
    }
}

init();

