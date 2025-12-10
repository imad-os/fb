"use strict";

// You can use 'axios' or native 'fetch' (Node 18+). 
// If using older Node, run: npm install axios
const axios = require('axios'); 

// -----------------------------------------------------------
// CONFIGURATION
// Get your free key from: https://dashboard.api-football.com/
// -----------------------------------------------------------
const API_KEY = "9e9fb80bd8d4c5c226e8a7f69375995a"; 
const BASE_URL = "https://v3.football.api-sports.io";

const HEADERS = {
    'x-rapidapi-host': 'v3.football.api-sports.io',
    'x-rapidapi-key': API_KEY
};

const FootballService = {

    /**
     * Helper to make requests
     */
    _request: async function(endpoint, params = {}) {
        try {
            const response = await axios.get(`${BASE_URL}${endpoint}`, {
                headers: HEADERS,
                params: params
            });
            return response.data;
        } catch (error) {
            console.error(`Football API Error [${endpoint}]:`, error.message);
            throw new Error("Failed to fetch data from Football Provider");
        }
    },

    /**
     * Get Live Matches
     */
    getLiveMatches: async function() {
        // "live=all" gets all currently playing matches
        return await this._request('/fixtures', { live: 'all' });
    },

    /**
     * Get Matches by Date (Fixtures)
     * date format: "YYYY-MM-DD"
     */
    getFixturesByDate: async function(date) {
        return await this._request('/fixtures', { date: date });
    },

    /**
     * Get Leagues List
     */
    getLeagues: async function() {
        return await this._request('/leagues');
    },

    /**
     * Get Standings for a specific league and season
     */
    getStandings: async function(leagueId, season) {
        return await this._request('/standings', { 
            league: leagueId, 
            season: season 
        });
    }
};

module.exports = FootballService;