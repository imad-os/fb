"use strict";

const axios = require('axios'); 
const config = require('./config');

const HEADERS = {
    'x-rapidapi-host': config.FOOTBALL_HOST_HEADER,
    'x-rapidapi-key': config.FOOTBALL_API_KEY
};

const FootballService = {

    fetchData: async function(endpoint, params = {}) {
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

        try {
            const response = await axios.get(`${config.FOOTBALL_BASE_URL}${cleanEndpoint}`, {
                headers: HEADERS,
                params: params
            });
            return response.data;
        } catch (error) {
            console.error(`Football API Error [${cleanEndpoint}]:`, error.message);
            throw new Error(error.response?.data?.message || "Failed to fetch data from Football Provider");
        }
    },

    getLiveMatches: async function() {
        return this.fetchData('/fixtures', { live: 'all' });
    }
};

module.exports = FootballService;