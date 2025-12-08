"use strict";

const SubtitleFetcher = {
    // Defines the domain
    domain: "iptv-subtitle.geekspro.us",
    
    // Encoded replacement domain
    targetDomainEncoded: 'ZXhvYXBwLnR2', // "exoapp.tv"

    get apiBaseUrl() {
        return `https://${this.domain}`;
    },

    get apiUrl() {
        return `https://${this.domain}/api/get-subtitles`;
    },

    // Node.js compatible URL fixer
    fixUrl(url) {
        const replacement = Buffer.from(this.targetDomainEncoded, 'base64').toString('utf-8');
        return url.replace(this.domain, replacement);
    },

    /**
     * Parse the request and fetch list of subtitles
     * Returns a Promise that resolves to the subtitles array
     */
    fetchSubtitles: async function(movieData, movieType) {
        if (!movieData) {
            throw new Error("No media data provided");
        }

        let subtitleRequestData = {};

        if (movieType === 'movie') {
            let originalName = movieData.name || '';
            let cleanedName = originalName;
            
            // Extract Year
            const yearMatch = cleanedName.match(/\((\d{4})\)/);
            let extractedYear = null;
            if (yearMatch) {
                extractedYear = parseInt(yearMatch[1]);
                cleanedName = cleanedName.replace(/\s*\(\d{4}\)\s*/, '').trim();
            }

            // Cleanup patterns (Common release tags)
            cleanedName = cleanedName.replace(/\s*\b(HD|4K|1080p|720p|480p|BluRay|BRRip|WEB-DL|WEBRip|DVDRip|CAMRip|TS|TC|HDTV|PDTV|XviD|x264|x265|HEVC|DivX|AC3|AAC|MP3|Dubbed|Subbed|MultiAudio)\b\s*/gi, ' ').trim();
            cleanedName = cleanedName.replace(/\[.*?\]/g, '').trim();
            cleanedName = cleanedName.replace(/\{.*?\}/g, '').trim();

            subtitleRequestData = { movie_name: cleanedName };
            if (movieData.tmdb_id) subtitleRequestData.tmdb_id = movieData.tmdb_id;
            if (extractedYear) subtitleRequestData.year = extractedYear;
            else if (movieData.year) subtitleRequestData.year = movieData.year;

        } else {
            // Series Logic
            if (movieData.season && movieData.episode_num) {
                let seriesName = movieData.series_name || movieData.name || "";
                seriesName = seriesName.replace(/S\d+/i, '').trim();

                const s = String(movieData.season).padStart(2, '0');
                const e = String(movieData.episode_num).padStart(2, '0');

                subtitleRequestData = {
                    movie_name: `${seriesName} S${s}E${e}`
                };
                if (movieData.series_tmdb_id) subtitleRequestData.tmdb_id = movieData.series_tmdb_id;
            } else {
                // Fallback parsing
                const episodeName = movieData.title || movieData.name || movieData.episode_name || '';
                const parsed = this.parseEpisodeName(episodeName);

                if (parsed.season_number && parsed.episode_number) {
                    subtitleRequestData = {
                        season_number: parseInt(parsed.season_number),
                        episode_number: parseInt(parsed.episode_number),
                    };
                    if (parsed.series_name) {
                        subtitleRequestData.movie_name = `${parsed.series_name} S${String(parsed.season_number).padStart(2, '0')}E${String(parsed.episode_number).padStart(2, '0')}`;
                    }
                } else {
                    subtitleRequestData = { movie_name: episodeName };
                }
            }
        }

        // Perform the API Request
        return this.makeSubtitleRequest(subtitleRequestData);
    },

    makeSubtitleRequest: async function(requestData) {
        requestData.langage = 'ar';
        requestData.lang = 'ar'; 

        const targetUrl = this.fixUrl(this.apiUrl);
        
        try {
            const response = await fetch(targetUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

            const result = await response.json();
            
            if (result.status === "success" && result.subtitles && result.subtitles.length > 0) {
                return result.subtitles;
            } else {
                return []; // Return empty array if none found
            }
        } catch (error) {
            console.error("Subtitle API Error:", error);
            throw error;
        }
    },

    /**
     * Downloads the subtitle content.
     * Note: "Setting" the subtitle (Tizen API) must happen on the client side.
     * This function only fetches the content stream.
     */
    downloadSubtitleContent: async function(url) {
        const fullUrl = url.startsWith('http') ? url : this.apiBaseUrl + url;
        const fixedUrl = this.fixUrl(fullUrl);

        console.log("Proxying download for:", fixedUrl);

        const response = await fetch(fixedUrl);
        if (!response.ok) throw new Error(`Download Failed: ${response.status}`);
        
        // Return the text content (SRT/VTT data)
        return await response.text(); 
    },

    parseEpisodeName: function(episodeName) {
        var result = { series_name: null, season_number: null, episode_number: null };
        if (!episodeName) return result;
        var cleanedName = episodeName.trim();
        var match = cleanedName.match(/^(.+?)\s+S(\d{1,2})\s*E(\d{1,2})/i);
        if (match) {
            result.series_name = match[1].trim();
            result.season_number = parseInt(match[2]);
            result.episode_number = parseInt(match[3]);
        }
        return result;
    }
};

module.exports = SubtitleFetcher;