"use strict";

module.exports = {
    // --- FOOTBALL API ---
    FOOTBALL_API_KEY: "9e9fb80bd8d4c5c226e8a7f69375995a",
    FOOTBALL_BASE_URL: "https://v3.football.api-sports.io",
    FOOTBALL_HOST_HEADER: "v3.football.api-sports.io",

    // --- SUBTITLES API ---
    SUBTITLES_DOMAIN: "iptv-subtitle.geekspro.us",
    SUBTITLES_TARGET_ENCODED: "ZXhvYXBwLnR2", // "exoapp.tv" encoded

    // --- YOUTUBE API ---
    // TODO: Add your YouTube API Key here
    YOUTUBE_API_KEY: "AIzaSyAGwuah6_wsPNojzaYDqTsG15tI7V_kQGM", 
    YOUTUBE_API_URL: "https://www.googleapis.com/youtube/v3/search",

    // --- TMDB API ---
    // TODO: Add your TMDB API Key here
    TMDB_API_KEY: "4fea759274b31a120afda53601abae83", 
    TMDB_BASE_URL: "https://api.themoviedb.org/3",
    TMDB_IMAGE_BASE: "https://image.tmdb.org/t/p/w500",
    TMDB_BACKDROP_BASE: "https://image.tmdb.org/t/p/original",

    // Known IDs for Priority Sorting (You can add more IDs here as needed)
    // 1=World Cup, 2=UCL, 3=Europa, 4=Euro, 9=Copa America, 15=Asian Cup, 16=AFCON
    FOOTBALL_PRIORITY_LEAGUES: {
        WORLD_CUP: [1,15], 
        CONTINENT_CUP: [6,19,5,4,14,1168],
        CHAMPIONS_LEAGUE: [2,12,848,533,36,],
        CONTINENT_SECOND: [3, 5, 20],
        FRIENDLIES: [666, 10]
    },

    // --- IP LOCATION API ---
    IP_API_URL: "http://ip-api.com/json",

};