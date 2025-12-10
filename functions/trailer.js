"use strict";

const axios = require('axios');

// CONFIGURATION
const YOUTUBE_API_KEY = "AIzaSyAGwuah6_wsPNojzaYDqTsG15tI7V_kQGM"; 
const TMDB_API_KEY = "4fea759274b31a120afda53601abae83";

const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3/search";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/original";

const TrailerService = {

    /**
     * Cleans the name based on IPTV provider patterns
     */
    cleanNameAndExtractYear: function(rawName) {
        let name = rawName || "";
        let extractedYear = null;

        // 1. Remove Prefix "EN - ", "4k - "
        const separatorIndex = name.indexOf(" - ");
        if (separatorIndex !== -1) {
            name = name.substring(separatorIndex + 3);
        }

        // 2. Extract Year
        const yearMatch = name.match(/\((\d{4})\)/);
        if (yearMatch) {
            extractedYear = yearMatch[1];
            name = name.replace(/\s*\(\d{4}\)\s*/, ''); 
        }

        // 3. Clean Brackets
        name = name.replace(/\[.*?\]/g, '').replace(/\{.*?\}/g, '').trim();

        return { name, extractedYear };
    },

    /**
     * Main Entry point
     */
    searchTrailer: async function(movieName, year, tmdb_id, type = 'movie') {
        
        if (tmdb_id) {
            const tmdbResult = await this.fetchFromTmdbSmart(tmdb_id, type);
            if (tmdbResult) return tmdbResult;
        }
        if (movieName) {
            const cleaned = this.cleanNameAndExtractYear(movieName);
            const searchName = cleaned.name;
            const searchYear = cleaned.extractedYear || year;

            console.log(`Searching TMDB for metadata: ${searchName} (${searchYear || 'No Year'})`);

            const metadata = await this.searchTmdbForId(searchName, searchYear, type);
            
            if (metadata) {
                const fullResult = await this.fetchFromTmdbSmart(metadata.id, metadata.type);
                
                if (fullResult) {
                    return fullResult;
                }
                                return await this.searchYoutubeFallback(searchName, searchYear, metadata);
            }
        }
        return await this.searchYoutubeFallback(movieName, year, null);
    },

    /**
     * Helper: Search TMDB by Name to find the ID and Metadata
     */
    searchTmdbForId: async function(name, year, type) {
        try {
            const endpoint = `${TMDB_BASE_URL}/search/${type}`;
            const params = {
                api_key: TMDB_API_KEY,
                query: name,
                page: 1
            };
            if (year) {
                if (type === 'movie') params.year = year;
                if (type === 'tv') params.first_air_date_year = year;
            }

            const response = await axios.get(endpoint, { params });
            const results = response.data.results;

            if (results && results.length > 0) {
                // Return the first match
                return results[0];
            }
        } catch (error) {
            console.error("TMDB Search Error:", error.message);
        }
        return null;
    },

    /**
     * Helper: Fetch Details + Video from TMDB by ID
     */
    fetchFromTmdbSmart: async function(id, initialType) {
        // Wrapper to try fetching 'movie' or 'tv'
        const tryFetch = async (currentType) => {
            try {
                const endpoint = `${TMDB_BASE_URL}/${currentType}/${id}`;
                const response = await axios.get(endpoint, {
                    params: { 
                        api_key: TMDB_API_KEY,
                        append_to_response: 'videos' // Get videos in same request
                    }
                });
                return { data: response.data, type: currentType };
            } catch (error) {
                return null;
            }
        };

        // 1. Try requested type
        let result = await tryFetch(initialType);

        // 2. Auto-fix type (if movie not found, try tv)
        if (!result) {
            const altType = (initialType === 'movie') ? 'tv' : 'movie';
            result = await tryFetch(altType);
        }

        if (!result) return null;

        const { data, type } = result;
        const videos = data.videos ? data.videos.results : [];

        // Find best trailer
        const trailer = videos.find(v => v.site === "YouTube" && v.type === "Trailer") 
                     || videos.find(v => v.site === "YouTube"); 

        if (trailer) {
            // SUCCESS: We have metadata AND a video
            return this.formatTmdbResponse(data, trailer, type);
        }
        
        return null; // Movie found, but no video (will trigger fallback logic in main function)
    },

    /**
     * Formats TMDB data into your app's structure
     */
    formatTmdbResponse: function(data, trailerVideo, type) {
        const isMovie = (type === 'movie' || data.title);
        const title = isMovie ? data.title : data.name;
        const date = isMovie ? data.release_date : data.first_air_date;
        
        return {
            found: true,
            id: trailerVideo ? trailerVideo.key : null,
            url: trailerVideo ? `https://www.youtube.com/watch?v=${trailerVideo.key}` : null,
            
            // --- MOVIE DETAILS ---
            title: title, 
            original_title: isMovie ? data.original_title : data.original_name,
            date: date,
            rating: data.vote_average ? parseFloat(data.vote_average.toFixed(1)) : 0, // e.g. 7.8
            votes: data.vote_count,
            
            // Images
            poster: data.poster_path ? `${TMDB_IMAGE_BASE}${data.poster_path}` : null,
            backdrop: data.backdrop_path ? `${TMDB_BACKDROP_BASE}${data.backdrop_path}` : null,
            thumbnail: trailerVideo ? `https://img.youtube.com/vi/${trailerVideo.key}/hqdefault.jpg` : null,

            overview: data.overview || "",
            genres: data.genres ? data.genres.map(g => g.name) : [],
            source: "TMDB"
        };
    },

    /**
     * Fallback: Search YouTube Directly
     * If metadata is provided, we attach it to the YouTube result.
     */
    searchYoutubeFallback: async function(movieName, year, metadata) {
        const cleaned = this.cleanNameAndExtractYear(movieName);
        let query = `${cleaned.name}`;
        if (cleaned.extractedYear || year) query += ` ${cleaned.extractedYear || year}`;
        query += " trailer";

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
                const vid = items[0];
                const videoId = vid.id.videoId;

                // If we have TMDB metadata, USE IT for title/poster/rating
                if (metadata) {
                    // We call the formatter but manually pass the YouTube video ID since TMDB didn't have one
                    const formatted = this.formatTmdbResponse(metadata, { key: videoId }, metadata.title ? 'movie' : 'tv');
                    formatted.source = "TMDB_Metadata + YouTube_Search";
                    return formatted;
                }

                // If NO metadata (Total Failure), use YouTube snippet data
                return {
                    found: true,
                    id: videoId,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    title: vid.snippet.title, // Warning: This is the video title, not movie title
                    date: vid.snippet.publishedAt,
                    thumbnail: vid.snippet.thumbnails.high.url,
                    rating: null, // Cannot get rating from YouTube
                    poster: vid.snippet.thumbnails.high.url, // Fallback to thumbnail
                    description: vid.snippet.description,
                    source: "YouTube_Raw"
                };
            }
        } catch (error) {
            console.error("YouTube Fallback Error:", error.message);
        }

        return { found: false, message: "No trailer found" };
    }
};

module.exports = TrailerService;