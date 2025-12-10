"use strict";

const axios = require('axios');

// CONFIGURATION
// TODO: Replace with your actual YouTube Data API v3 Key
const YOUTUBE_API_KEY = "YOUR_YOUTUBE_API_KEY_HERE"; 
const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3/search";

const TrailerService = {

    /**
     * Cleans the name based on IPTV provider patterns
     */
    cleanNameAndExtractYear: function(rawName) {
        let name = rawName || "";
        let extractedYear = null;

        // 1. Handle IPTV Prefixes (check for first " - ")
        const separatorIndex = name.indexOf(" - ");
        if (separatorIndex !== -1) {
            name = name.substring(separatorIndex + 3);
        }

        // 2. Extract Year if inside parentheses
        const yearMatch = name.match(/\((\d{4})\)/);
        if (yearMatch) {
            extractedYear = yearMatch[1];
            name = name.replace(/\s*\(\d{4}\)\s*/, ''); 
        }

        // 3. General Cleanup
        name = name.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').trim();

        return { name, extractedYear };
    },

    /**
     * Searches for a trailer on YouTube and returns detailed info
     */
    searchTrailer: async function(movieName, year) {
        if (!movieName) throw new Error("Movie name is required");

        // Step 1: Clean Name
        const cleanedData = this.cleanNameAndExtractYear(movieName);
        let finalName = cleanedData.name;
        let finalYear = cleanedData.extractedYear || year;

        // Step 2: Build Query
        let query = `${finalName}`;
        if (finalYear) {
            query += ` ${finalYear}`;
        }
        query += " trailer";

        console.log(`Searching YouTube for: [${query}]`);

        try {
            const response = await axios.get(YOUTUBE_API_URL, {
                params: {
                    part: 'snippet', // 'snippet' contains title, thumbnails, date, etc.
                    q: query,
                    type: 'video',
                    maxResults: 1,
                    key: YOUTUBE_API_KEY
                }
            });

            const items = response.data.items;

            if (items && items.length > 0) {
                const videoItem = items[0];
                const snippet = videoItem.snippet;
                const videoId = videoItem.id.videoId;

                return {
                    found: true,
                    id: videoId,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    title: snippet.title, // Video Title
                    date: snippet.publishedAt, // Upload Date (ISO format)
                    thumbnail: snippet.thumbnails.high ? snippet.thumbnails.high.url : snippet.thumbnails.default.url, // Best available thumbnail
                    channel: snippet.channelTitle, // Who uploaded it (e.g., "Marvel Entertainment")
                    description: snippet.description // Short description of the video
                };
            } else {
                return { found: false, message: "No trailer found" };
            }

        } catch (error) {
            console.error("YouTube API Error:", error.response?.data || error.message);
            throw new Error("Failed to fetch trailer from YouTube");
        }
    }
};

module.exports = TrailerService;