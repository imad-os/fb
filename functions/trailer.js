"use strict";

const axios = require('axios');
const config = require('./config');

const TrailerService = {

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

    searchTrailer: async function(movieName, year, tmdb_id, type = 'movie') {
        
        // CASE A: We have an ID.
        if (tmdb_id) {
            const tmdbResult = await this.fetchFromTmdbSmart(tmdb_id, type);
            if (tmdbResult) return tmdbResult;
        }

        // CASE B: We only have a Name.
        if (movieName) {
            const cleaned = this.cleanNameAndExtractYear(movieName);
            const searchName = cleaned.name;
            const searchYear = cleaned.extractedYear || year;

            console.log(`Searching TMDB for metadata: ${searchName} (${searchYear || 'No Year'})`);

            const metadata = await this.searchTmdbForId(searchName, searchYear, type);
            
            if (metadata) {
                const fullResult = await this.fetchFromTmdbSmart(metadata.id, metadata.type);
                if (fullResult) return fullResult;
                
                return await this.searchYoutubeFallback(searchName, searchYear, metadata);
            }
        }

        // CASE C: Fallback
        return await this.searchYoutubeFallback(movieName, year, null);
    },

    searchTmdbForId: async function(name, year, type) {
        try {
            const endpoint = `${config.TMDB_BASE_URL}/search/${type}`;
            const params = {
                api_key: config.TMDB_API_KEY,
                query: name,
                page: 1
            };
            if (year) {
                if (type === 'movie') params.year = year;
                if (type === 'tv') params.first_air_date_year = year;
            }

            const response = await axios.get(endpoint, { params });
            const results = response.data.results;

            if (results && results.length > 0) return results[0];
        } catch (error) {
            console.error("TMDB Search Error:", error.message);
        }
        return null;
    },

    fetchFromTmdbSmart: async function(id, initialType) {
        const tryFetch = async (currentType) => {
            try {
                const endpoint = `${config.TMDB_BASE_URL}/${currentType}/${id}`;
                const response = await axios.get(endpoint, {
                    params: { 
                        api_key: config.TMDB_API_KEY,
                        append_to_response: 'videos'
                    }
                });
                return { data: response.data, type: currentType };
            } catch (error) {
                return null;
            }
        };

        let result = await tryFetch(initialType);
        if (!result) {
            const altType = (initialType === 'movie') ? 'tv' : 'movie';
            result = await tryFetch(altType);
        }

        if (!result) return null;

        const { data, type } = result;
        const videos = data.videos ? data.videos.results : [];

        const trailer = videos.find(v => v.site === "YouTube" && v.type === "Trailer") 
                     || videos.find(v => v.site === "YouTube"); 

        if (trailer) {
            return this.formatTmdbResponse(data, trailer, type);
        }
        return null; 
    },

    formatTmdbResponse: function(data, trailerVideo, type) {
        const isMovie = (type === 'movie' || data.title);
        const title = isMovie ? data.title : data.name;
        const date = isMovie ? data.release_date : data.first_air_date;
        
        return {
            found: true,
            id: trailerVideo ? trailerVideo.key : null,
            url: trailerVideo ? `https://www.youtube.com/watch?v=${trailerVideo.key}` : null,
            title: title, 
            original_title: isMovie ? data.original_title : data.original_name,
            date: date,
            rating: data.vote_average ? parseFloat(data.vote_average.toFixed(1)) : 0,
            votes: data.vote_count,
            poster: data.poster_path ? `${config.TMDB_IMAGE_BASE}${data.poster_path}` : null,
            backdrop: data.backdrop_path ? `${config.TMDB_BACKDROP_BASE}${data.backdrop_path}` : null,
            thumbnail: trailerVideo ? `https://img.youtube.com/vi/${trailerVideo.key}/hqdefault.jpg` : null,
            overview: data.overview || "",
            genres: data.genres ? data.genres.map(g => g.name) : [],
            source: "TMDB"
        };
    },

    searchYoutubeFallback: async function(movieName, year, metadata) {
        const cleaned = this.cleanNameAndExtractYear(movieName);
        let query = `${cleaned.name}`;
        if (cleaned.extractedYear || year) query += ` ${cleaned.extractedYear || year}`;
        query += " trailer";

        try {
            const response = await axios.get(config.YOUTUBE_API_URL, {
                params: {
                    part: 'snippet',
                    q: query,
                    type: 'video',
                    maxResults: 1,
                    key: config.YOUTUBE_API_KEY
                }
            });

            const items = response.data.items;

            if (items && items.length > 0) {
                const vid = items[0];
                const videoId = vid.id.videoId;

                if (metadata) {
                    const formatted = this.formatTmdbResponse(metadata, { key: videoId }, metadata.title ? 'movie' : 'tv');
                    formatted.source = "TMDB_Metadata + YouTube_Search";
                    return formatted;
                }

                return {
                    found: true,
                    id: videoId,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    title: vid.snippet.title,
                    date: vid.snippet.publishedAt,
                    thumbnail: vid.snippet.thumbnails.high.url,
                    rating: null,
                    poster: vid.snippet.thumbnails.high.url,
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