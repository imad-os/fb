"use strict";
// Service keys (TMDB, YouTube, football APIs, subtitle host) are NOT kept in the code: the repo is public.
// They live in the Firestore document  xtream_private/apiKeys  with the fields:
//   TMDB_API_KEY      string
//   YOUTUBE_API_KEY   string
//   FOOTBALL_KEYS     array of { url, host, key }
//   SUBTITLES_TARGET  string (base64 of the real subtitle host)
// firestore.rules gives browsers no access to xtream_private; only the Cloud Functions (Admin SDK) can read it.
// An environment variable with the same name wins over the document (FOOTBALL_KEYS as a JSON string).
// loadSecrets() copies the values into config (TMDB_API_KEY, YOUTUBE_API_KEY, API, SUBTITLES_TARGET_ENCODED),
// once per instance, then again at most every 10 minutes.
const config = require("../config");

const TTL_MS = 10 * 60 * 1000;
let loadedAt = 0;
let pending = null;

function parseJsonArray(text) {
    try { const v = JSON.parse(text); return Array.isArray(v) ? v : null; } catch (e) { return null; }
}

async function readDoc() {
    try {
        const { getFirestore } = require("firebase-admin/firestore");
        const snap = await getFirestore().collection("xtream_private").doc("apiKeys").get();
        return snap.exists ? (snap.data() || {}) : {};
    } catch (e) {
        console.error("secrets: could not read xtream_private/apiKeys:", e.message);
        return {};
    }
}

async function refresh() {
    const doc = await readDoc();
    const env = process.env;
    const pick = (name) => env[name] || doc[name] || "";

    config.TMDB_API_KEY = pick("TMDB_API_KEY");
    config.YOUTUBE_API_KEY = pick("YOUTUBE_API_KEY");
    config.SUBTITLES_TARGET_ENCODED = pick("SUBTITLES_TARGET");
    const football = (env.FOOTBALL_KEYS && parseJsonArray(env.FOOTBALL_KEYS)) ||
        (Array.isArray(doc.FOOTBALL_KEYS) ? doc.FOOTBALL_KEYS : null) ||
        (typeof doc.FOOTBALL_KEYS === "string" ? parseJsonArray(doc.FOOTBALL_KEYS) : null) || [];
    config.API.splice(0, config.API.length, ...football);
    loadedAt = Date.now();
}

async function loadSecrets() {
    if (loadedAt && Date.now() - loadedAt < TTL_MS) return;
    if (!pending) pending = refresh().finally(() => { pending = null; });
    await pending;
}

module.exports = { loadSecrets };
