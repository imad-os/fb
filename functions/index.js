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
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    
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
        // Support both query param (GET) and body (POST) for flexibility
        const subtitleUrl = request.query.url || request.body.url;
        
        if (!subtitleUrl) {
            response.status(400).send("Missing 'url' parameter");
            return;
        }
        const content = await SubtitleFetcher.downloadSubtitleContent(subtitleUrl);
        
        // Force text/plain so the browser/TV parses it as raw text
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

exports.footballRequest = onRequest({ cors: true }, async (request, response) => {
    if (applyMiddleware(request, response)) return;

    try {
        // 1. Parse Input
        // The football.html sends a POST with { endpoint: "...", params: {...} }
        let endpoint = request.body.endpoint;
        let params = request.body.params;

        // Fallback for direct browser testing (GET requests)
        if (request.method === 'GET') {
            endpoint = request.query.endpoint;
            params = { ...request.query };
            delete params.endpoint; // Remove endpoint from the params list
        }

        // 2. Validation
        if (!endpoint) {
            response.status(400).send({ error: "Missing 'endpoint' parameter" });
            return;
        }

        // 3. Execution
        // Now calling the generic fetchData method we added to football.js
        const data = await FootballService.fetchData(endpoint, params || {});
        
        response.status(200).send(data);

    } catch (error) {
        logger.error("Football API Error:", error);
        response.status(500).send({ 
            error: true, 
            message: error.message 
        });
    }
});