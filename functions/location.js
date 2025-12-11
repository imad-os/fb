"use strict";

const axios = require('axios');
const config = require('./config');

const LocationService = {
    /**
     * Fetches location details for a given IP
     * @param {string} ipAddress 
     */
    getLocationByIp: async function(ipAddress) {
        if (!ipAddress) throw new Error("IP Address is required");

        try {
            // ip-api.com/json/{ip}
            const url = `${config.IP_API_URL}/${ipAddress}`;
            const response = await axios.get(url);

            if (response.data.status === 'fail') {
                throw new Error(response.data.message || "Failed to locate IP");
            }

            return {
                status: "success",
                country: response.data.country,
                countryCode: response.data.countryCode, // e.g., "US", "GB"
                city: response.data.city,
                timezone: response.data.timezone,
                lat: response.data.lat,
                lon: response.data.lon,
                query: response.data.query // The IP itself
            };

        } catch (error) {
            console.error("Location API Error:", error.message);
            throw new Error("Could not fetch location details");
        }
    }
};

module.exports = LocationService;