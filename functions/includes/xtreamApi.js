"use strict";

const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");


// Helper: Standard default properties for Xtream objects
// This ensures the App doesn't crash if a field is missing in Firestore
const DEFAULTS = {
    stream: {
        num: 0,
        name: "Unknown Stream",
        stream_type: "live",
        stream_id: 0,
        stream_icon: "",
        epg_channel_id: "",
        added: "0",
        category_id: "0",
        custom_sid: "",
        tv_archive: 0,
        direct_source: "",
        tv_archive_duration: 0
    },
    vod: {
        num: 0,
        name: "Unknown VOD",
        stream_type: "movie",
        stream_id: 0,
        stream_icon: "",
        rating: "0",
        rating_5based: 0,
        added: "0",
        category_id: "0",
        container_extension: "mp4",
        custom_sid: "",
        direct_source: ""
    },
    series: {
        num: 0,
        name: "Unknown Series",
        series_id: 0,
        cover: "",
        plot: "",
        cast: "",
        director: "",
        genre: "",
        releaseDate: "",
        last_modified: "0",
        rating: "0",
        rating_5based: 0,
        backdrop_path: [],
        youtube_trailer: "",
        episode_run_time: "0",
        category_id: "0"
    }
};

const XtreamService = {

    /**
     * Main handler for all Xtream requests
     */
    async handleRequest(params) {
        const { action, username, password } = params;
        this.db = getFirestore();

        // 1. Authenticate User
        const userInfo = await this.authenticateUser(username, password);
        if (!userInfo) {
            throw new Error("Authentication failed");
        }

        // 2. Route Action
        switch (action) {
            case 'get_user_info':
                return this.getUserInfo(userInfo);

            case 'get_live_categories':
                return this.getCategories('live');
            
            case 'get_vod_categories':
                return this.getCategories('vod');
            
            case 'get_series_categories':
                return this.getCategories('series');

            case 'get_live_streams':
                return this.getStreams('live', params.category_id);

            case 'get_vod_streams':
                return this.getStreams('vod', params.category_id);

            case 'get_series':
                return this.getStreams('series', params.category_id);

            case 'get_vod_info':
                return this.getVodInfo(params.vod_id || params.stream_id);

            case 'get_series_info':
                return this.getSeriesInfo(params.series_id);

            default:
                return { status: "error", message: "Unknown action" };
        }
    },

    /**
     * Authenticates user against 'xtream_users' collection
     */
    async authenticateUser(username, password) {
        if (!username || !password) return null;

        try {
            // Ensure DB is initialized if called directly
            if (!this.db) this.db = getFirestore();

            const usersRef = this.db.collection('xtream_users');
            const snapshot = await usersRef
                .where('username', '==', username)
                .where('password', '==', password)
                .limit(1)
                .get();

            if (snapshot.empty) return null;
            
            // Return the first matching user doc
            return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
        } catch (error) {
            logger.error("Auth Error", error);
            return null;
        }
    },

    /**
     * Fetch direct source for a stream (Live/VOD)
     */
    async getStreamDirectSource(username, password, streamId, typeStr) {
        this.db = getFirestore();

        // 1. Auth
        const user = await this.authenticateUser(username, password);
        if (!user) return null;

        // 2. Map URL type to DB type
        // URL 'movie' -> DB 'vod'
        // URL 'live'  -> DB 'live'
        let dbType = typeStr;
        if (typeStr === 'movie') dbType = 'vod';

        try {
            const streamsRef = this.db.collection('xtream_streams');
            const snapshot = await streamsRef
                .where('stream_id', '==', parseInt(streamId))
                .where('type', '==', dbType)
                .limit(1)
                .get();

            if (snapshot.empty) return null;

            const data = snapshot.docs[0].data();
            return data.direct_source || null;

        } catch (error) {
            logger.error("Error fetching stream source", error);
            return null;
        }
    },

    /**
     * Generates standard get_user_info response
     */
    getUserInfo(userDoc) {
        // Standard XC Server Info Mock
        const serverInfo = {
            url: "localhost",
            port: "80",
            https_port: "443",
            server_protocol: "http",
            rtmp_port: "8880",
            timestamp_now: Math.floor(Date.now() / 1000),
            time_now: new Date().toISOString(),
            timezone: "UTC"
        };

        const userInfo = {
            username: userDoc.username,
            password: userDoc.password,
            message: "Welcome",
            auth: 1,
            status: "Active",
            exp_date: userDoc.exp_date || "1999999999", // Unlimited if null
            is_trial: "0",
            active_cons: "0",
            created_at: "0",
            max_connections: userDoc.max_connections || "1",
            allowed_output_formats: ["m3u8", "ts", "rtmp"]
        };

        return {
            user_info: userInfo,
            server_info: serverInfo
        };
    },

    /**
     * Fetch categories from 'xtream_categories'
     * Filters by 'type' field in the doc (live, vod, series)
     */
    async getCategories(type) {
        try {
            const catsRef = this.db.collection('xtream_categories');
            const snapshot = await catsRef.where('type', '==', type).get();

            return snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    category_id: data.category_id || doc.id,
                    category_name: data.category_name || "Unknown Category",
                    parent_id: data.parent_id || 0
                };
            });
        } catch (error) {
            logger.error(`Error fetching ${type} categories`, error);
            return [];
        }
    },

    /**
     * Fetch streams from 'xtream_streams'
     * Filters by 'type' (live, vod, series) and optional 'category_id'
     */
    async getStreams(type, categoryId) {
        try {
            let query = this.db.collection('xtream_streams').where('type', '==', type);

            if (categoryId) {
                query = query.where('category_id', '==', categoryId);
            }

            const snapshot = await query.get();

            return snapshot.docs.map(doc => {
                const data = doc.data();
                // Merge DB data with Defaults to ensure no null crashes on TV
                const base = type === 'series' ? DEFAULTS.series : (type === 'vod' ? DEFAULTS.vod : DEFAULTS.stream);
                
                // Map Firestore fields to XC fields
                // Note: We use the doc ID as stream_id if not provided
                const id = data.stream_id || doc.id;
                
                if (type === 'series') {
                    return {
                        ...base,
                        ...data,
                        series_id: id, // Ensure series_id is set
                        name: data.name || data.title // Handle common naming mismatch
                    };
                } else {
                    return {
                        ...base,
                        ...data,
                        stream_id: id,
                        name: data.name || data.title
                    };
                }
            });
        } catch (error) {
            logger.error(`Error fetching ${type} streams`, error);
            return [];
        }
    },

    /**
     * Fetch detailed info for a single VOD
     */
    async getVodInfo(streamId) {
        if (!streamId) return {};
        
        // In a real DB, you might fetch by ID. 
        // Here we assume streamId matches the document ID or a field 'stream_id'
        // Since we need to find it first:
        try {
            const streamsRef = this.db.collection('xtream_streams');
            const snapshot = await streamsRef.where('stream_id', '==', parseInt(streamId)).limit(1).get();
            
            if (snapshot.empty) return {};
            
            const data = snapshot.docs[0].data();
            
            return {
                info: {
                    ...DEFAULTS.vod,
                    ...data,
                    movie_image: data.stream_icon || "",
                    plot: data.plot || "No description available."
                },
                movie_data: data // Some players look for this
            };

        } catch (error) {
            return {};
        }
    },

    /**
     * Fetch detailed info for a Series (Episodes, etc)
     */
    async getSeriesInfo(seriesId) {
        if (!seriesId) return {};

        try {
            // 1. Get Series Info
            const seriesQuery = await this.db.collection('xtream_streams')
                .where('stream_id', '==', parseInt(seriesId)) // Assuming stream_id holds series_id in your DB
                .where('type', '==', 'series')
                .limit(1)
                .get();

            if (seriesQuery.empty) return {};
            const seriesData = seriesQuery.docs[0].data();

            // 2. Get Episodes
            const episodesQuery = await this.db.collection('xtream_streams')
                .where('type', '==', 'episode')
                .where('series_id', '==', parseInt(seriesId))
                .orderBy('episode_num', 'asc') // Assuming you have episode_num
                .get();

            const episodes = {};
            
            episodesQuery.docs.forEach(doc => {
                const ep = doc.data();
                const seasonNum = ep.season_num || 1; // Default to season 1
                
                if (!episodes[seasonNum]) episodes[seasonNum] = [];
                
                episodes[seasonNum].push({
                    id: ep.stream_id || doc.id,
                    episode_num: ep.episode_num || 1,
                    title: ep.name || `Episode ${ep.episode_num}`,
                    container_extension: ep.container_extension || "mp4",
                    info: {
                         plot: ep.plot || ""
                    },
                    custom_sid: "",
                    added: ep.added || "0",
                    season: seasonNum,
                    direct_source: ""
                });
            });

            return {
                seasons: Object.keys(episodes).map(s => ({ season_number: s })), // Simple season list
                info: {
                    ...DEFAULTS.series,
                    ...seriesData,
                    cover: seriesData.stream_icon || ""
                },
                episodes: episodes
            };

        } catch (error) {
            logger.error("Error getting series info", error);
            return {};
        }
    }
};

module.exports = XtreamService;