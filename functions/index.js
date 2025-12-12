const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");

const config = require('./config');


// Import Modules
const SubtitleFetcher = require("./subtitles");
const FootballService = require("./football");
const TrailerService = require("./trailer"); 
const RecommendationService = require("./recommendations");
const LocationService = require("./location");

initializeApp();

// --- MIDDLEWARE: CORS ---
const applyMiddleware = (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return true;
    }
    return false;
};


// ==========================================
// 5. LOCATION API (NEW)
// ==========================================

exports.getLocation = onRequest({ cors: true }, async (request, response) => {
    if (applyMiddleware(request, response)) return;

    try {
        const ip = request.body.ip || request.query.ip || "";
        const locationData = await LocationService.getLocationByIp(ip);
        response.status(200).send(locationData);

    } catch (error) {
        logger.error("Location API Error:", error);
        response.status(500).send({ status: "error", message: error.message });
    }
});

// ==========================================
// 1. SUBTITLES API
// ==========================================

exports.fetchSubtitles = onRequest({ cors: true }, async (request, response) => {
    if (applyMiddleware(request, response)) return;
    try {
        const { movieData, movieType } = request.body;
        if (!movieData) {
            response.status(400).send({ error: "Missing movieData" });
            return;
        }
        const subtitles = await SubtitleFetcher.fetchSubtitles(movieData, movieType || 'movie');
        response.status(200).send({ status: "success", subtitles });
    } catch (error) {
        logger.error("Error fetching subtitles:", error);
        response.status(500).send({ status: "error", message: error.message });
    }
});

exports.downloadSubtitle = onRequest({ cors: true }, async (request, response) => {
    if (applyMiddleware(request, response)) return;
    try {
        const subtitleUrl = request.query.url || request.body.url;
        
        if (!subtitleUrl) {
            response.status(400).send("Missing 'url' parameter");
            return;
        }
        const content = await SubtitleFetcher.downloadSubtitleContent(subtitleUrl);
        
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.status(200).send(content);
    } catch (error) {
        logger.error("Download error:", error);
        response.status(500).send("Failed to download.");
    }
});

// ==========================================
// 3. TRAILER API
// ==========================================

exports.searchTrailer = onRequest({ cors: true }, async (request, response) => {
    if (applyMiddleware(request, response)) return;

    try {
        // Support both Body (POST) and Query (GET)
        const movieName = request.body.movie_name || request.query.movie_name;
        const year = request.body.year || request.query.year;
        const tmdbId = request.body.tmdb_id || request.query.tmdb_id;
        const type = request.body.type || request.query.type || 'movie';

        // Validation
        if (!movieName && !tmdbId) {
            response.status(400).send({ 
                status: "error", 
                message: "Missing 'movie_name' or 'tmdb_id' parameter" 
            });
            return;
        }

        // Always returns a result object (e.g. { found: false, ... } or { found: true, ... })
        const result = await TrailerService.searchTrailer(movieName, year, tmdbId, type);
        
        // We always send 200 OK so the client can parse the JSON check 'found'
        response.status(200).send(result);

    } catch (error) {
        logger.error("Trailer API Error:", error);
        response.status(500).send({ 
            status: "error", 
            message: error.message 
        });
    }
});



// ==========================================
// 4. RECOMMENDATIONS API
// ==========================================

exports.getRecommendations = onRequest({ cors: true }, async (request, response) => {
    if (applyMiddleware(request, response)) return;

    try {
        // Parse Body
        let favorites = request.body.favorites || [];
        let watched = request.body.watched || [];
        
        // Params: returnmax (default 20), type (default movie)
        // Checks both Body and Query string
        let count = parseInt(request.body.returnmax || request.query.returnmax || 20);
        let type = request.body.type || 'movie'; 

        // Safety: Limit max return to 100 to prevent timeout
        if (count > 100) count = 100;

        // Run Logic
        const recommendations = await RecommendationService.getRecommendations(favorites, watched, count, type);
        
        response.status(200).send({
            status: "success",
            count: recommendations.length,
            data: recommendations
        });

    } catch (error) {
        logger.error("Recommendation API Error:", error);
        response.status(500).send({ 
            status: "error", 
            message: error.message 
        });
    }
});


// ==========================================
// 2. FOOTBALL API
// ==========================================

exports.footballRequest = onRequest({ cors: true }, async (request, response) => {
    if (applyMiddleware(request, response)) return;

    try {
        let endpoint = request.body.endpoint;
        let params = request.body.params;

        if (request.method === 'GET') {
            endpoint = request.query.endpoint;
            params = { ...request.query };
            delete params.endpoint; 
        }

        if (!endpoint) {
            response.status(400).send({ error: "Missing 'endpoint' parameter" });
            return;
        }

        const data = await FootballService.fetchData(endpoint, params || {});
        response.status(200).send(data);

    } catch (error) {
        logger.error("Football API Error:", error);
        response.status(500).send({ error: true, message: error.message });
    }
});

// ==========================================
// 6. FOOTBALL RECOMMENDATIONS API (NEW)
// ==========================================

exports.footballRecommendations = onRequest({ cors: true }, async (request, response) => {
    if (applyMiddleware(request, response)) return;

    try {
        let country = request.body.country || request.query.country;
        let city = request.body.city || request.query.city;
        let continentCode = request.body.continent || request.query.continent;

        if (!country || !continentCode) {
            try {
                const location = await LocationService.getLocationByIp();
                country = location.country;
                city = location.city;
                continentCode = config.FOOTBALL_CONTINENT_MAP[location.countryCode] || "";
                
                logger.info(`Auto-detected: ${country}, ${city}, ${continentCode}`);
            } catch (e) {
                logger.warn("Location detection failed", e);
            }
        }

        if (!country || !continentCode) {
            response.status(400).send({ 
                status: "error", 
                message: "Location (Country/Continent) is required and could not be detected." 
            });
            return;
        }

        const matches = await FootballService.getRecommendedMatches(country, city || "", continentCode);
        
        response.status(200).send({
            status: "success",
            count: matches.length,
            data: matches
        });

    } catch (error) {
        logger.error("Football Recs Error:", error);
        response.status(500).send({ status: "error", message: error.message });
    }
});


exports.footballNews = onRequest({ cors: true }, async (request, response) => {
    if (applyMiddleware(request, response)) return;

    try {
        const langue  = request.body.langue || request.query.langue || "en";
        const country = request.body.country || request.query.country || "MA";
        const page    = request.body.page || request.query.page || 1;
        const news = await FootballService.news(langue,country,page);
        response.status(200).send(news);

    } catch (error) {
        logger.error("news API Error:", error);
        response.status(500).send({ status: "error", message: error.message });
    }
});
