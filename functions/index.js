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
const XtreamService = require("./includes/xtreamApi"); // Import new Local Service

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

const settings =   {
    region: "europe-west1",
    cors: true
};


// ==========================================
// 5. LOCATION API
// ==========================================

exports.getLocation = onRequest(settings, async (request, response) => {
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

exports.fetchSubtitles = onRequest(settings, async (request, response) => {
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

exports.downloadSubtitle = onRequest(settings, async (request, response) => {
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

exports.searchTrailer = onRequest(settings, async (request, response) => {
    if (applyMiddleware(request, response)) return;

    try {
        const movieName = request.body.movie_name || request.query.movie_name;
        const year = request.body.year || request.query.year;
        const tmdbId = request.body.tmdb_id || request.query.tmdb_id;
        const type = request.body.type || request.query.type || 'movie';

        if (!movieName && !tmdbId) {
            response.status(400).send({ 
                status: "error", 
                message: "Missing 'movie_name' or 'tmdb_id' parameter" 
            });
            return;
        }

        const result = await TrailerService.searchTrailer(movieName, year, tmdbId, type);
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

exports.getRecommendations = onRequest(settings, async (request, response) => {
    if (applyMiddleware(request, response)) return;

    try {
        let favorites = request.body.favorites || [];
        let watched = request.body.watched || [];
        let count = parseInt(request.body.returnmax || request.query.returnmax || 20);
        let type = request.body.type || 'movie'; 

        if (count > 100) count = 100;

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

exports.footballRequest = onRequest(settings, async (request, response) => {
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
// 6. FOOTBALL RECOMMENDATIONS API
// ==========================================

exports.footballRecommendations = onRequest(settings, async (request, response) => {
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


exports.footballNews = onRequest(settings, async (request, response) => {
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


// ==========================================
// 7. XTREAM CODES API (LOCAL FIRESTORE)
// ==========================================

exports.xtreamRequest = onRequest(settings, async (request, response) => {
    if (applyMiddleware(request, response)) return;

    // --- STREAM HANDLING LOGIC ---
    // Detects URL pattern: /xtream/movie/username/password/streamID.mp4
    const pathSegments = request.path.split('/').filter(p => p);
    
    // ADJUSTMENT: The hosting rewrite adds "xtream" to the start of pathSegments.
    // We normalize this by removing "xtream" if it exists at index 0.
    // Example: ['xtream', 'movie', 'user', 'pass', 'id.mp4'] -> ['movie', 'user', 'pass', 'id.mp4']
    let segments = pathSegments;
    if (segments.length > 0 && segments[0] === 'xtream') {
        segments = segments.slice(1);
    }

    // Check for standard XC stream pattern (4 parts: type/user/pass/id.ext)
    if (segments.length === 4) {
        const [type, username, password, file] = segments;
        
        // Only handle specific types to avoid conflicting with other routes
        if (['movie', 'live'].includes(type)) {
            try {
                // Extract ID from "23802.mp4" -> "23802"
                const streamId = file.split('.')[0];
                
                const directSource = await XtreamService.getStreamDirectSource(username, password, streamId, type);
                
                if (directSource) {
                    response.redirect(directSource);
                } else {
                    response.status(404).send("Stream source not found");
                }
                return; // Stop execution here for streams
            } catch (err) {
                logger.error("Stream Fetch Error", err);
                response.status(500).send("Error fetching stream");
                return;
            }
        }
    }
    // -----------------------------

    try {
        // Standard XC API uses GET with query params (username, password, action)
        const params = request.method === 'GET' ? request.query : request.body;
        
        let action = params.action;

        if (!action) {
             // If no action is provided, but auth is present, standard behavior is often to return user info
             if(params.username && params.password) {
                 action = 'get_user_info';
                 params.action = action;
             } else {
                response.status(400).send({ status: "error", message: "Missing 'action' parameter" });
                return;
             }
        }

        const data = await XtreamService.handleRequest(params);
        response.status(200).send(data);

    } catch (error) {
        logger.error("Xtream API Error:", error);
        // If auth fails, standard XC might return null or specific error, but we send 401/500
        if (error.message === "Authentication failed") {
             response.status(401).send({ status: "error", message: "Authentication Failed" });
        } else {
             response.status(500).send({ status: "error", message: error.message });
        }
    }
});