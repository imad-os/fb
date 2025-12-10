"use strict";

const axios = require('axios'); 

// -----------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------
const API_KEY = "9e9fb80bd8d4c5c226e8a7f69375995a"; 
const BASE_URL = "https://v3.football.api-sports.io";

const HEADERS = {
    'x-rapidapi-host': 'v3.football.api-sports.io',
    'x-rapidapi-key': API_KEY
};

const FootballService = {

    /**
     * Generic Fetcher (The method index.js was looking for)
     * @param {string} endpoint - e.g., "fixtures", "/leagues"
     * @param {object} params - Query parameters
     */
    fetchData: async function(endpoint, params = {}) {
        // Ensure endpoint starts with '/'
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

        try {
            const response = await axios.get(`${BASE_URL}${cleanEndpoint}`, {
                headers: HEADERS,
                params: params
            });
            return response.data;
        } catch (error) {
            console.error(`Football API Error [${cleanEndpoint}]:`, error.message);
            // Return a structured error so the client handles it gracefully
            throw new Error(error.response?.data?.message || "Failed to fetch data from Football Provider");
        }
    },

    // (Optional) Keep these if you need them for other server-side logic, 
    // but fetchData covers most needs now.
    getLiveMatches: async function() {
        return this.fetchData('/fixtures', { live: 'all' });
    }
};

module.exports = FootballService;