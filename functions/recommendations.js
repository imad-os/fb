"use strict";

const axios = require('axios');
const config = require('./config');

// TMDB Genre ID Mapping
const GENRE_MAP = {
    "Action": 28, "Adventure": 12, "Animation": 16, "Comedy": 35, 
    "Crime": 80, "Documentary": 99, "Drama": 18, "Family": 10751, 
    "Fantasy": 14, "History": 36, "Horror": 27, "Music": 10402, 
    "Mystery": 9648, "Romance": 10749, "Science Fiction": 878, "Sci-Fi": 878, 
    "TV Movie": 10770, "Thriller": 53, "War": 10752, "Western": 37
};

const RecommendationService = {

    /**
     * Main Entry Point
     */
    getRecommendations: async function(favorites, watched, count = 20, type = 'movie') {
        const limit = parseInt(count);
        
        // 1. Build Exclusion Set (IDs or Cleaned Names) to prevent duplicates
        const excludedIds = new Set();
        const excludedTitles = new Set();

        const addToExclusion = (list) => {
            if (!list || !Array.isArray(list)) return;
            list.forEach(item => {
                if (item.tmdb_id) excludedIds.add(item.tmdb_id);
                if (item.name) excludedTitles.add(item.name.toLowerCase().trim());
                if (item.title) excludedTitles.add(item.title.toLowerCase().trim());
            });
        };

        addToExclusion(favorites);
        addToExclusion(watched);

        // 2. Analyze User Taste (Find Top Genres)
        const topGenreIds = this.getTopGenres(favorites);
        
        // Default to "Action" & "Drama" if user has no valid genres in favorites
        const genreQuery = topGenreIds.length > 0 ? topGenreIds.join('|') : "28|18"; 

        console.log(`Generating ${limit} recs based on Genres: [${genreQuery}]`);

        // 3. Fetch from TMDB Discover API (Loop pages if needed)
        let candidates = [];
        let page = 1;
        const maxPageChecks = 10; // Safety limit to prevent infinite loops

        while (candidates.length < limit && page <= maxPageChecks) {
            const newItems = await this.fetchDiscoveryPage(type, genreQuery, page);
            
            if (newItems.length === 0) break; // No more results available

            for (const item of newItems) {
                // FILTER: Check if user already saw this
                const titleKey = (item.title || item.name || "").toLowerCase().trim();
                
                if (!excludedIds.has(item.id) && !excludedTitles.has(titleKey)) {
                    candidates.push({
                        id: item.id,
                        title: item.title || item.name,
                        overview: item.overview,
                        poster: item.poster_path ? `${config.TMDB_IMAGE_BASE}${item.poster_path}` : null,
                        backdrop: item.backdrop_path ? `${config.TMDB_BACKDROP_BASE}${item.backdrop_path}` : null,
                        rating: item.vote_average ? parseFloat(item.vote_average.toFixed(1)) : 0,
                        year: item.release_date ? item.release_date.split('-')[0] : (item.first_air_date ? item.first_air_date.split('-')[0] : ""),
                        type: type
                    });
                    
                    // Add to exclusion so we don't add it twice
                    excludedIds.add(item.id);
                }

                if (candidates.length >= limit) break; // Stop if we have enough
            }
            page++;
        }

        return candidates;
    },

    /**
     * counting how many times each genre appears in favorites
     * Returns string of Top 3 IDs joined by pipe OR (e.g. "28|878|12")
     */
    getTopGenres: function(items) {
        if (!items || items.length === 0) return [];

        const tally = {};

        items.forEach(item => {
            // Genre input might be a String ("Action") or Array of Strings or ID
            let genresToProcess = [];

            if (Array.isArray(item.genre)) {
                genresToProcess = item.genre;
            } else if (typeof item.genre === 'string') {
                // Handle "Action, Drama" strings
                genresToProcess = item.genre.split(',').map(s => s.trim());
            }

            genresToProcess.forEach(gName => {
                // Map Name -> ID
                const gID = GENRE_MAP[gName] || GENRE_MAP[gName.replace('Movies', '').trim()]; // Clean "Action Movies" -> "Action"
                if (gID) {
                    tally[gID] = (tally[gID] || 0) + 1;
                }
            });
        });

        // Sort by frequency (highest count first)
        const sorted = Object.keys(tally).sort((a, b) => tally[b] - tally[a]);

        // Return Top 3 (or fewer)
        return sorted.slice(0, 3); 
    },

    fetchDiscoveryPage: async function(type, genreIds, page) {
        try {
            const response = await axios.get(`${config.TMDB_BASE_URL}/discover/${type}`, {
                params: { 
                    api_key: config.TMDB_API_KEY, 
                    with_genres: genreIds,      // e.g. "28|878" (Action OR Sci-Fi)
                    sort_by: 'popularity.desc', // Get best movies first
                    'vote_count.gte': 100,      // Filter out junk with 0 votes
                    page: page
                }
            });
            return response.data.results || [];
        } catch (e) {
            console.error(`Discovery Error (Page ${page}):`, e.message);
            return [];
        }
    }
};

module.exports = RecommendationService;