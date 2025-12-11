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

    /**
     * Returns top 10 recommended matches based on user location
     * @param {string} country - User's Country (e.g. "England")
     * @param {string} city - User's City (e.g. "London")
     */
    getRecommendedMatches: async function(country, city) {
        // 1. Get Today's Date in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];

        console.log(`Fetching fixtures for ${today} | User: ${country}, ${city}`);

        // 2. Fetch ALL matches for today (More efficient than 10 separate calls)
        const response = await this.fetchData('/fixtures', { date: today });
        const allMatches = response.response || [];

        if (allMatches.length === 0) return [];

        // 3. Score each match based on priority
        const scoredMatches = allMatches.map(match => {
            let score = 0;
            const leagueId = match.league.id;
            const leagueCountry = match.league.country;
            const homeTeam = match.teams.home.name;
            const awayTeam = match.teams.away.name;
            const venueCity = match.fixture.venue.city || "";

            // --- PRIORITY LOGIC ---

            // 1. World Cup
            if (config.FOOTBALL_PRIORITY_LEAGUES.WORLD_CUP.includes(leagueId)) {
                score += 1000; 
                console.log("herer")
            }
            // 2. Continent Cup (Euro, Asian Cup...)
            else if (config.FOOTBALL_PRIORITY_LEAGUES.CONTINENT_CUP.includes(leagueId)) {
                score += 900;
                console.log("herer 3 ")
            }
            // 3. Champions League (UCL, CAF CL...)
            else if (config.FOOTBALL_PRIORITY_LEAGUES.CHAMPIONS_LEAGUE.includes(leagueId)) {
                score += 800;
                console.log("herer 3.5 , ", leagueId)
            }
            // 4. Second Cup of Continent (Europa...)
            else if (config.FOOTBALL_PRIORITY_LEAGUES.CONTINENT_SECOND.includes(leagueId)) {
                score += 700;
                console.log("herer 4 ", leagueId)
            }
            // 5. Country League (Premier League, etc.) - Must match User Country
            else if (leagueCountry === country && match.league.type === 'League') {
                score += 600;
                console.log("herer 5 ")
                // Boost for Top Tier leagues (usually contain "Premier" or "1" in name)
                if (match.league.name.includes("Premier") || match.league.name.includes("Liga 1")) {
                    score += 50; 
                }
            }
            // 6. Country Cup - Must match User Country
            else if (leagueCountry === country && match.league.type === 'Cup') {
                score += 500;
                console.log("herer 6 ")
            }
            // 7. Friendlies (Current City or National Team)
            else if (config.FOOTBALL_PRIORITY_LEAGUES.FRIENDLIES.includes(leagueId)) {
                // Check if Home or Away team matches User Country (National Team) OR User City (Local Club)
                const isNationalTeam = (homeTeam === country || awayTeam === country);
                const isLocalCity = (venueCity.includes(city) || homeTeam.includes(city) || awayTeam.includes(city));
                
                if (isNationalTeam || isLocalCity) {
                    score += 400;
                } else {
                    score += 10; // Irrelevant friendly
                }

                console.log("herer 7 ")
            } else {
                // Standard match (score based on importance or ignore)
                score += 20; 
            }

            return { match, score };
        });

        // 4. Sort by Score (Descending)
        scoredMatches.sort((a, b) => b.score - a.score);

        // 5. Return Top 10 (Formatted Cleanly)
        return scoredMatches.slice(0, 10).map(item => {
            const m = item.match;
            return {
                fixture_id: m.fixture.id,
                date: m.fixture.date,
                status: m.fixture.status.short,
                league: {
                    name: m.league.name,
                    country: m.league.country,
                    logo: m.league.logo
                },
                home: {
                    name: m.teams.home.name,
                    logo: m.teams.home.logo,
                    goals: m.goals.home
                },
                away: {
                    name: m.teams.away.name,
                    logo: m.teams.away.logo,
                    goals: m.goals.away
                },
                // Debug info to see why it was recommended
                priority_score: item.score 
            };
        });
    }
};

module.exports = FootballService;