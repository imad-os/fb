"use strict";

const axios = require('axios');
const config = require('./config');

const LocationService = {
    /**
     * Fetches location details for a given IP
     * @param {string} ipAddress 
     */
    getLocationByIp: async function(ipAddress="") {
        try {
            // ip-api.com/json/{ip}
            // Only a plain IPv4 / IPv6 address goes into the URL (no paths or queries).
            const ip = /^[0-9a-fA-F:.]{2,45}$/.test(String(ipAddress || '')) ? ipAddress : '';
            const url = `${config.IP_API_URL}/${ip}`;
            const response = await axios.get(url, { timeout: 5000 });

            if (response.data.status === 'fail') {
                throw new Error(response.data.message || "Failed to locate IP");
            }

            return {
                status: "success",
                ...response.data
            };

        } catch (error) {
            console.error("Location API Error:", error.message);
            throw new Error("Could not fetch location details");
        }
    }
};

module.exports = LocationService;