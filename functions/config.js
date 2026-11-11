"use strict";
const footballApis=[
    {"url":"https://v3.football.api-sports.io","host":"v3.football.api-sports.io", "key":"9e9fb80bd8d4c5c226e8a7f69375995a"},
    {"url":"https://v3.football.api-sports.io","host":"v3.football.api-sports.io", "key":"d79fe49364b4f281787947da46201ee3"},
    {"url":"https://api-football-v1.p.rapidapi.com/v3","host":"api-football-v1.p.rapidapi.com", "key":"b7e837cfb4msh0b84d927aa2291dp130d32jsn7b1570d863f8"},
    {"url":"https://api-football-v1.p.rapidapi.com/v3","host":"api-football-v1.p.rapidapi.com", "key":"b3a3d033ffmsh6e94bc1a2adfb2ap197138jsn33bbf80e8bb2"},
    {"url":"https://v3.football.api-sports.io","host":"v3.football.api-sports.io", "key":"cb397bed4ae3bce1f341cde74671ec94"},//free sub
];
module.exports = {
    API:footballApis,

    // --- SUBTITLES API ---
    SUBTITLES_DOMAIN: "iptv-subtitle.geekspro.us",
    SUBTITLES_TARGET_ENCODED: "ZXhvYXBwLnR2",

    // --- YOUTUBE API ---
    // TODO: Add your YouTube API Key here
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || "AIzaSyAGwuah6_wsPNojzaYDqTsG15tI7V_kQGM", 
    YOUTUBE_API_URL: "https://www.googleapis.com/youtube/v3/search",

    // --- TMDB API ---
    // TODO: Add your TMDB API Key here
    TMDB_API_KEY: process.env.TMDB_API_KEY || "4fea759274b31a120afda53601abae83", 
    TMDB_BASE_URL: "https://api.themoviedb.org/3",
    TMDB_IMAGE_BASE: "https://image.tmdb.org/t/p/w500",
    TMDB_BACKDROP_BASE: "https://image.tmdb.org/t/p/original",

    // --- IP LOCATION API ---
    IP_API_URL: "http://ip-api.com/json",

    // 1. GLOBAL (Always relevant)
    GLOBAL_LEAGUES: [1,15,1168], // World Cup

    // 2. CONTINENTAL SPECIFIC
    // Keys match the "continentCode" from IP-API (EU, AF, AS, SA, NA, OC)
    CONTINENT_LEAGUES: {
        // Europe
        EU: {
            CUP: [4],          // Euro
            CL: [2],           // UEFA Champions League
            SECOND: [3, 848]   // Europa League, Conference League
        },
        // Africa
        AF: {   
            CUP: [6],         // AFCON (African Cup of Nations)
            CL: [12],          // CAF Champions League
            SECOND: [20]       // CAF Confederation Cup
        },
        // Asia
        AS: {
            CUP: [15],         // Asian Cup
            CL: [17],          // AFC Champions League
            SECOND: [18]       // AFC Cup
        },
        // South America
        SA: {
            CUP: [9],          // Copa America
            CL: [13],          // Copa Libertadores
            SECOND: [11]       // Copa Sudamericana
        },
        // North America
        NA: {
            CUP: [22],         // Gold Cup
            CL: [16],          // CONCACAF Champions League
            SECOND: []
        }
    },

    // FRIENDLIES (Check team names)
    FRIENDLIES: [10, 666], 

    FAVORITE_TEAMS: [
        85,//PSG
        50,//Manchester City
        541,//Real Madrid
        529,//Barcelona
        23
    ],
    
    FOOTBALL_CONTINENT_MAP : {
        // AFRICA (CAF)
        "MA": "AF", "DZ": "AF", "TN": "AF", "EG": "AF", "LY": "AF", // North
        "NG": "AF", "GH": "AF", "CI": "AF", "SN": "AF", "CM": "AF", // West/Central
        "ZA": "AF", "KE": "AF", "TZ": "AF", "UG": "AF", "AO": "AF", // South/East
    
        // EUROPE (UEFA)
        "GB": "EU", "UK": "EU", "FR": "EU", "DE": "EU", "IT": "EU", "ES": "EU",
        "PT": "EU", "NL": "EU", "BE": "EU", "RU": "EU", "TR": "EU", "IL": "EU", // Israel is UEFA
        "KZ": "EU", "UA": "EU", "PL": "EU", "SE": "EU", "NO": "EU", "DK": "EU",
    
        // ASIA (AFC)
        "JP": "AS", "KR": "AS", "CN": "AS", "IN": "AS", "SA": "AS", 
        "QA": "AS", "AE": "AS", "IR": "AS", "IQ": "AS", "TH": "AS",
        "AU": "AS", // Australia plays in Asian Confederation (AFC)
    
        // SOUTH AMERICA (CONMEBOL)
        "BR": "SA", "AR": "SA", "UY": "SA", "CO": "SA", "CL": "SA",
        "PE": "SA", "EC": "SA", "PY": "SA", "VE": "SA", "BO": "SA",
    
        // NORTH AMERICA (CONCACAF)
        "US": "NA", "CA": "NA", "MX": "NA", "CR": "NA", "PA": "NA",
        "JM": "NA", "HN": "NA", "SV": "NA", "GT": "NA"
    },
};