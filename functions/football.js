"use strict";

const axios = require('axios'); 
const config = require('./config');

const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

const HEADERS = {
    'x-rapidapi-host': config.FOOTBALL_HOST_HEADER,
    'x-rapidapi-key': config.FOOTBALL_API_KEY,
    "user-agent" : ua,
    "authority" : "v3.football.api-sports.io",
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

    /**
     * Returns strictly recommended matches based on location AND favorite teams
     * @param {string} country - "Morocco"
     * @param {string} city - "Casablanca"
     * @param {string} continentCode - "AF"
     */
    getRecommendedMatches: async function(country, city, continentCode) {
        const today = new Date().toISOString().split('T')[0];
        country = country.toLowerCase();
        city = city.toLowerCase();
        console.log(`Fetching fixtures for ${today} | Location: ${country}, ${city} (${continentCode})`);

        const response = await this.fetchData('/fixtures', { date: today });
        const allMatches = response.response || [];
        if( Object.keys(response.errors).length ){
            return response.errors;
        }
        if (allMatches.length === 0) return [];

        // Get the relevant IDs for the user's continent
        const localContinentData = config.CONTINENT_LEAGUES[continentCode] || { CUP: [], CL: [], SECOND: [] };

        const scoredMatches = allMatches.map(match => {
            let score = 0;
            const leagueId = match.league.id;
            const leagueCountry = match.league.country.toLowerCase();
            const homeTeam = match.teams.home.name.toLowerCase();
            const awayTeam = match.teams.away.name.toLowerCase();
            const venueCity = match.fixture.venue.city || "";
            const homeTeamId = match.teams.home.id;
            const awayTeamId = match.teams.away.id;

            // 1. World Cup (Global) -> Score 1000
            if (config.GLOBAL_LEAGUES.includes(leagueId)) {
                score = 1000;
            }
            // 2. Continent Cup (MUST Match User Continent) -> Score 900
            else if (localContinentData.CUP.includes(leagueId)) {
                score = 900;
            }
            // 3. Continent Champions League (MUST Match User Continent) -> Score 800
            else if (localContinentData.CL.includes(leagueId)) {
                score = 800;
            }
            // 5. Second Continent Cup (MUST Match User Continent) -> Score 700
            else if (localContinentData.SECOND.includes(leagueId)) {
                score = 700;
            }
            // 4. FAVORITE TEAMS (Global Appeal) -> Score 750
            // This ensures Real Madrid, Liverpool etc are shown even if not in your country
            else if (config.FAVORITE_TEAMS.includes(homeTeamId) || config.FAVORITE_TEAMS.includes(awayTeamId) ) {
                score = 750;
            }
            // 6. Country League (MUST Match User Country) -> Score 600
            else if (leagueCountry === country && match.league.type === 'League') {
                score = 600;
                if (match.league.name.includes("Premier") || match.league.name.includes("1") || match.league.name.includes("Botola")) {
                    score += 50; 
                }
            }
            // 7. Country Cup (MUST Match User Country) -> Score 500
            else if (leagueCountry === country && match.league.type === 'Cup') {
                score = 500;
            }
            // 8. Friendlies (MUST involve User Country or City OR Favorite Team) -> Score 400
            else if (config.FRIENDLIES.includes(leagueId)) {
                const isNationalTeam = (homeTeam === country || awayTeam === country);
                const isLocalCity = (venueCity && city && venueCity.includes(city));
                const isFavorite = (config.FAVORITE_TEAMS.includes(homeTeam) || config.FAVORITE_TEAMS.includes(awayTeam));

                if (isNationalTeam || isLocalCity || isFavorite) {
                    score = 400;
                }
            }
            if ( 
                (venueCity && city && venueCity.includes(city)) ||
                homeTeam.includes(city)  || 
                awayTeam.includes(city)
             ){
                score = 700;
            }
            if( homeTeam === country || awayTeam === country ){
                score += 900;
            }else if( homeTeam.includes(country)  || awayTeam.includes(country) ){
                score += 400;
            }
            // If score is still 0, it means it's unrelated to User OR Favorites
            return { match, score };
        });

        // Filter out unrelated matches (Score 0)
        const relevantMatches = scoredMatches.filter(item => item.score > 0);

        // Sort by Score (High to Low)
        relevantMatches.sort((a, b) => b.score - a.score);

        // Return Top Matches
        return relevantMatches.slice(0, 20).map(item => ({
            fixture_id: item.match.fixture.id,
            date: item.match.fixture.date,
            status: item.match.fixture.status.short,
            league: {
                name: item.match.league.name,
                country: item.match.league.country,
                logo: item.match.league.logo
            },
            home: {
                name: item.match.teams.home.name,
                logo: item.match.teams.home.logo,
                goals: item.match.goals.home
            },
            away: {
                name: item.match.teams.away.name,
                logo: item.match.teams.away.logo,
                goals: item.match.goals.away
            },
            priority_score: item.score
        }));
    }
};

module.exports = FootballService;