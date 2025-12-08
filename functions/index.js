const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");

// Import the local helper
const SubtitleFetcher = require("./subtitles");

initializeApp();

/**
 * Endpoint 1: Fetch Subtitles List
 * Accepts JSON body: { movieData: {...}, movieType: "movie"|"series" }
 */
exports.fetchSubtitles = onRequest({ cors: false }, async (request, response) => {
    try {
        const { movieData, movieType } = request.body;
        
        if (!movieData) {
            response.status(400).send({ error: "Missing movieData in request body" });
            return;
        }

        const subtitles = await SubtitleFetcher.fetchSubtitles(movieData, movieType || 'movie');
        
        response.status(200).send({ 
            status: "success", 
            subtitles: subtitles 
        });

    } catch (error) {
        logger.error("Error fetching subtitles:", error);
        response.status(500).send({ 
            status: "error", 
            message: error.message 
        });
    }
});

/**
 * Endpoint 2: Proxy Subtitle Download
 * Accepts Query Param or Body: { url: "/path/to/sub.srt" }
 * Returns: The actual file content (SRT/VTT)
 */
exports.downloadSubtitle = onRequest({ cors: false }, async (request, response) => {
    try {
        // Support getting URL from query string (?url=...) or body
        const subtitleUrl = request.query.url || request.body.url;

        if (!subtitleUrl) {
            response.status(400).send("Missing 'url' parameter");
            return;
        }

        // Fetch the raw content using our helper
        const subtitleContent = await SubtitleFetcher.downloadSubtitleContent(subtitleUrl);

        // Set headers to prompt download or correct display
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.status(200).send(subtitleContent);

    } catch (error) {
        logger.error("Error downloading subtitle:", error);
        response.status(500).send("Failed to download subtitle.");
    }
});