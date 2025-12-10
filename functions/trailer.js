"use strict";

const axios = require('axios');

// CONFIGURATION
const YOUTUBE_API_KEY = "AIzaSyAGwuah6_wsPNojzaYDqTsG15tI7V_kQGM"; 
const TMDB_API_KEY = "4fea759274b31a120afda53601abae83";

const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3/search";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

const TrailerService = {

    /**
     * Cleans the name based on IPTV provider patterns
     */
    cleanNameAndExtractYear: function(rawName) {
        let name = rawName || "";
        let extractedYear = null;

        const separatorIndex = name.indexOf(" - ");
        if (separatorIndex !== -1) {
            name = name.substring(separatorIndex + 3);
        }

        const yearMatch = name.match(/\((\d{4})\)/);
        if (yearMatch) {
            extractedYear = yearMatch[1];
            name = name.replace(/\s*\(\d{4}\)\s*/, ''); 
        }

        name = name.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').trim();

        return { name, extractedYear };
    },

    /**
     * Main Entry point: Decides whether to use TMDB or YouTube Search
     * @param {string} movieName 
     * @param {string} year 
     * @param {string|number} tmdb_id (Optional)
     * @param {string} type (Optional: 'movie' or 'tv', defaults to 'movie')
     */
    searchTrailer: async function(movieName, year, tmdb_id, type = 'movie') {
        
        // 1. Priority: Try TMDB if ID is provided
        if (tmdb_id) {
            console.log(`Checking TMDB for ID: ${tmdb_id} (${type})`);
            const tmdbResult = await this.fetchFromTmdb(tmdb_id, type);
            
            if (tmdbResult) {
                return tmdbResult;
            }
            console.log("TMDB trailer not found, falling back to YouTube search...");
        }

        // 2. Fallback: Search YouTube by Name
        return await this.searchYoutubeByName(movieName, year);
    },

    /**
     * Fetches video data from TMDB and formats it like the YouTube response
     */
    fetchFromTmdb: async function(id, type) {
        try {
            // Endpoint: /movie/{id}/videos or /tv/{id}/videos
            const endpoint = `${TMDB_BASE_URL}/${type}/${id}/videos`;
            
            const response = await axios.get(endpoint, {
                params: { api_key: TMDB_API_KEY }
            });

            const results = response.data.results;
            
            // Filter: We want a Trailer hosted on YouTube
            const trailer = results.find(v => v.site === "YouTube" && v.type === "Trailer") 
                         || results.find(v => v.site === "YouTube"); // Fallback to any YouTube video (Teaser/Clip) if no "Trailer"

            if (trailer) {
                return {
                    found: true,
                    id: trailer.key,
                    url: `https://www.youtube.com/watch?v=${trailer.key}`,
                    title: trailer.name,
                    date: trailer.published_at,
                    // TMDB doesn't give a full thumbnail URL, so we construct the standard YouTube one
                    thumbnail: `https://img.youtube.com/vi/${trailer.key}/hqdefault.jpg`, 
                    channel: "TMDB Official", 
                    description: "Official Trailer sourced via TMDB"
                };
            }
        } catch (error) {
            console.error("TMDB API Error:", error.message);
            // We return null so the main function knows to fall back to YouTube Search
            return null;
        }
        return null;
    },

    /**
     * The original YouTube Search Logic
     */
    searchYoutubeByName: async function(movieName, year) {
        if (!movieName) throw new Error("Movie name is required for fallback search");

        const cleanedData = this.cleanNameAndExtractYear(movieName);
        let finalName = cleanedData.name;
        let finalYear = cleanedData.extractedYear || year;

        let query = `${finalName}`;
        if (finalYear) query += ` ${finalYear}`;
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
                const snippet = items[0].snippet;
                const videoId = items[0].id.videoId;

                return {
                    found: true,
                    id: videoId,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    title: snippet.title,
                    date: snippet.publishedAt,
                    thumbnail: snippet.thumbnails.high ? snippet.thumbnails.high.url : snippet.thumbnails.default.url,
                    channel: snippet.channelTitle,
                    description: snippet.description
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