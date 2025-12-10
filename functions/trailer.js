"use strict";

const axios = require('axios');

// CONFIGURATION
// TODO: Replace with your actual YouTube Data API v3 Key
const YOUTUBE_API_KEY = "YOUR_YOUTUBE_API_KEY_HERE"; 
const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3/search";

const TrailerService = {

    /**
     * cleans the name based on IPTV provider patterns
     * 1. Detects and removes prefixes like "EN - ", "4k - " by finding the first " - "
     * 2. Extracts year if present in name (e.g. "Movie Name (2020)")
     */
    cleanNameAndExtractYear: function(rawName) {
        let name = rawName || "";
        let extractedYear = null;

        // 1. Handle IPTV Prefixes (check for first " - ")
        // logic: split by " - " (space hyphen space) to avoid breaking names like "Spider-Man"
        // If " - " exists, we assume the left part is a tag (EN, AR, 4K) and take the right part.
        const separatorIndex = name.indexOf(" - ");
        if (separatorIndex !== -1) {
            // Take everything after the first " - "
            name = name.substring(separatorIndex + 3);
        }

        // 2. Extract Year if inside parentheses e.g., "(2023)"
        const yearMatch = name.match(/\((\d{4})\)/);
        if (yearMatch) {
            extractedYear = yearMatch[1];
            // Remove the year from the name so we don't duplicate it in the search query later
            name = name.replace(/\s*\(\d{4}\)\s*/, ''); 
        }

        // 3. General Cleanup (trim spaces, remove brackets like [FR] if missed by dash check)
        name = name.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').trim();

        return { name, extractedYear };
    },

    /**
     * Searches for a trailer on YouTube
     * @param {string} movieName 
     * @param {string|number} year (Optional)
     */
    searchTrailer: async function(movieName, year) {
        if (!movieName) throw new Error("Movie name is required");

        // Step 1: Clean the name and check for year inside the string
        const cleanedData = this.cleanNameAndExtractYear(movieName);
        let finalName = cleanedData.name;
        
        // Prioritize the year found in the name, otherwise use the passed param
        let finalYear = cleanedData.extractedYear || year;

        // Step 2: Build Query
        // Format: "Iron Man 2008 trailer"
        let query = `${finalName}`;
        if (finalYear) {
            query += ` ${finalYear}`;
        }
        query += " trailer";

        console.log(`Searching YouTube for: [${query}]`);

        try {
            const response = await axios.get(YOUTUBE_API_URL, {
                params: {
                    part: 'snippet',
                    q: query,
                    type: 'video',
                    maxResults: 1,
                    key: YOUTUBE_API_KEY
                }
            });

            const items = response.data.items;
            if (items && items.length > 0) {
                const videoId = items[0].id.videoId;
                return {
                    found: true,
                    title: items[0].snippet.title,
                    videoId: videoId,
                    url: `https://www.youtube.com/watch?v=${videoId}`
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