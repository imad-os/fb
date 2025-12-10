const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");

// Import Modules
const SubtitleFetcher = require("./subtitles");
const FootballService = require("./football");

initializeApp();

// --- MIDDLEWARE: CORS ---
const applyMiddleware = (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', '*');
    res.set('Access-Control-Allow-Headers', '*');
    
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return true;
    }
    return false;
};

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
// 2. FOOTBALL API
// ==========================================

/**
 * Unified Football Endpoint.
 * Expects JSON body: { "endpoint": "fixtures", "params": { "live": "all" } }
 */
exports.footballRequest= onRequest({ cors: true }, async (request, response) => {
    if (applyMiddleware(request, response)) return;

    try {
        // Accept params from Body (POST) or Query (GET)
        const endpoint = request.body.endpoint || request.query.endpoint;
        const params = request.body.params || request.query;

        // Clean up params if coming from Query (remove 'endpoint' from params object)
        if (request.method === 'GET' && params.endpoint) {
            delete params.endpoint;
        }

        if (!endpoint) {
            response.status(400).send({ error: "Missing 'endpoint' parameter" });
            return;
        }

        const data = await FootballService.fetchData(endpoint, params);
        response.status(200).send(data);

    } catch (error) {
        logger.error("Football API Error:", error);
        response.status(500).send({ 
            error: true, 
            message: error.message 
        });
    }
});