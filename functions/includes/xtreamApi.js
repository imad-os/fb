"use strict";

/**
 * Xtream Codes compatible server on Firestore, with several independent lists.
 *
 * Collections (see README.md):
 *   xtream_lists/{listId}     { name, enabled, rev, note }       a list (its id is in the users' links)
 *   xtream_users/{id}         { username, password, status, exp_date, max_connections, lists: [listId] }
 *   xtream_categories/{id}    { list_id, type: live|vod|series, category_id, category_name, parent_id }
 *   xtream_streams/{id}       { list_id, type: live|vod|series|episode, stream_id, name, direct_source, ... }
 *
 * Addresses (behind the Hosting rewrite /xtream/**):
 *   /xtream/player_api.php?...            the "default" list (old links keep working)
 *   /xtream/l/<listId>/player_api.php?... any list
 *   .../get.php?username=&password=&type=m3u_plus&output=ts   M3U playlist
 *   .../xmltv.php                         empty EPG (keeps players quiet)
 *   .../live|movie|series/<user>/<pass>/<id>.<ext>            302 to the real source
 */

const DEFAULT_LIST = "default";
const LIST_TTL = 10 * 1000; // a list doc (and its rev) is read again after 10 s
const DATA_TTL = 5 * 60 * 1000; // streams / categories are kept until the list's rev changes, at most 5 min
const USER_TTL = 15 * 1000;

let logger = console;
try { logger = require("firebase-functions/logger"); } catch (e) { /* tests */ }

const cache = new Map(); // key -> { at, rev, value }

function cget(key, ttl, rev) {
    const c = cache.get(key);
    if (!c) return undefined;
    if (Date.now() - c.at > ttl) { cache.delete(key); return undefined; }
    if (rev !== undefined && c.rev !== rev) { cache.delete(key); return undefined; }
    return c.value;
}
function cset(key, value, rev) {
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), rev, value });
    return value;
}

const str = (v, d = "") => (v === undefined || v === null ? d : String(v));
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const LIST_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function catIds(v) {
    const n = Number(v);
    return Number.isFinite(n) ? [n] : [];
}

function extOf(file) {
    const i = file.lastIndexOf(".");
    return i > 0 ? file.slice(i + 1) : "";
}

function m3uEscape(s) {
    return str(s).replace(/"/g, "'").replace(/[\r\n]+/g, " ");
}

const XtreamService = {
    db: null,
    DEFAULT_LIST,

    /** Tests pass an in-memory Firestore; the function uses firebase-admin. */
    useDb(db) { this.db = db; cache.clear(); },
    clearCache() { cache.clear(); },
    _db() {
        if (!this.db) this.db = require("firebase-admin/firestore").getFirestore();
        return this.db;
    },

    // ------------------------------------------------------------------ paths

    /**
     * '/xtream/l/sports/player_api.php' -> { listId: 'sports', rest: ['player_api.php'], prefix: '/xtream/l/sports' }
     */
    parsePath(path) {
        let segs = str(path).split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch (e) { return s; } });
        let prefix = "";
        if (segs[0] === "xtream") { segs = segs.slice(1); prefix = "/xtream"; }
        let listId = DEFAULT_LIST;
        if (segs[0] === "l" && segs.length >= 2) {
            listId = segs[1].toLowerCase();
            prefix += "/l/" + encodeURIComponent(listId);
            segs = segs.slice(2);
        }
        return { listId, rest: segs, prefix };
    },

    baseUrl(req, prefix) {
        const h = (req.headers || {});
        const host = h["x-forwarded-host"] || h.host || "localhost";
        const proto = (h["x-forwarded-proto"] || "https").split(",")[0].trim();
        return `${proto}://${String(host).split(",")[0].trim()}${prefix}`;
    },

    // ------------------------------------------------------------------ http

    async handleHttp(req, res) {
        const { listId, rest, prefix } = this.parsePath(req.path || req.url || "");
        const params = Object.assign({}, req.query || {}, (req.body && typeof req.body === "object") ? req.body : {});
        const first = rest[0] || "";

        try {
            // Stream: /live/u/p/1.ts, /movie/u/p/2.mp4, /series/u/p/3.mkv, and /u/p/1 (short live form)
            const isStream = (rest.length === 4 && ["live", "movie", "series"].includes(first)) ||
                (rest.length === 3 && !first.includes("."));
            if (isStream) {
                const [type, username, password, file] = rest.length === 4 ? rest : ["live", ...rest];
                const streamId = file.split(".")[0];
                const auth = await this.authenticate(listId, username, password);
                if (!auth.ok) { res.status(auth.reason === "list" ? 404 : 403).send("Access denied: " + auth.reason); return; }
                const src = await this.getStreamDirectSource(listId, streamId, type);
                if (!src) { res.status(404).send("Stream source not found"); return; }
                res.set("Cache-Control", "no-store");
                res.redirect(302, src);
                return;
            }

            if (first === "get.php") {
                const auth = await this.authenticate(listId, params.username, params.password);
                if (!auth.ok) { res.status(auth.reason === "list" ? 404 : 401).send("#EXTM3U\n# Access denied: " + auth.reason + "\n"); return; }
                const text = await this.buildM3u(listId, params, this.baseUrl(req, prefix));
                res.set("Content-Type", "audio/x-mpegurl; charset=utf-8");
                res.set("Content-Disposition", `inline; filename="${listId}.m3u"`);
                res.status(200).send(text);
                return;
            }

            if (first === "xmltv.php") {
                res.set("Content-Type", "application/xml; charset=utf-8");
                res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="xtream-firestore"></tv>\n');
                return;
            }

            if (first && first !== "player_api.php" && first !== "panel_api.php") {
                res.status(404).send({ status: "error", message: "Unknown address" });
                return;
            }

            if (!params.action && !(params.username && params.password)) {
                res.status(400).send({ status: "error", message: "Missing 'action' parameter" });
                return;
            }
            const auth = await this.authenticate(listId, params.username, params.password);
            if (!auth.ok) {
                res.status(401).send({ user_info: { auth: 0, status: auth.reason }, status: "error", message: "Authentication failed" });
                return;
            }
            const data = await this.handleAction(listId, params.action || "get_user_info", params, auth.user, req, prefix);
            res.status(200).send(data);
        } catch (error) {
            logger.error("Xtream error", error);
            res.status(500).send({ status: "error", message: "Server error" });
        }
    },

    async handleAction(listId, action, params, user, req, prefix) {
        switch (action) {
            case "get_user_info": return this.getUserInfo(user, req, prefix);
            case "get_live_categories": return this.getCategories(listId, "live");
            case "get_vod_categories": return this.getCategories(listId, "vod");
            case "get_series_categories": return this.getCategories(listId, "series");
            case "get_live_streams": return this.getStreams(listId, "live", params.category_id);
            case "get_vod_streams": return this.getStreams(listId, "vod", params.category_id);
            case "get_series": return this.getStreams(listId, "series", params.category_id);
            case "get_vod_info": return this.getVodInfo(listId, params.vod_id || params.stream_id);
            case "get_series_info": return this.getSeriesInfo(listId, params.series_id);
            case "get_short_epg":
            case "get_simple_data_table": return { epg_listings: [] };
            default: return { status: "error", message: "Unknown action" };
        }
    },

    // ------------------------------------------------------------------ lists + users

    async getList(listId) {
        if (!LIST_ID_RE.test(listId)) return null;
        const hit = cget("list:" + listId, LIST_TTL);
        if (hit !== undefined) return hit;
        const snap = await this._db().collection("xtream_lists").doc(listId).get();
        let list = snap.exists ? { id: listId, ...snap.data() } : null;
        // The default list works before it has a document (old setups).
        if (!list && listId === DEFAULT_LIST) list = { id: DEFAULT_LIST, name: "Default", rev: 0 };
        return cset("list:" + listId, list);
    },

    userLists(user) {
        return Array.isArray(user.lists) ? user.lists : [DEFAULT_LIST];
    },

    /**
     * @returns {{ ok: boolean, reason?: string, user?: object }}
     * reason: missing | list | wrong | disabled | expired | not-allowed
     */
    async authenticate(listId, username, password) {
        username = str(username).trim();
        password = str(password);
        if (!username || !password) return { ok: false, reason: "missing" };

        const list = await this.getList(listId);
        if (!list || list.enabled === false) return { ok: false, reason: "list" };

        let user = cget("user:" + username, USER_TTL);
        if (user === undefined) {
            const snap = await this._db().collection("xtream_users").where("username", "==", username).limit(5).get();
            const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            user = cset("user:" + username, docs);
        }
        const found = user.find((u) => str(u.password) === password);
        if (!found) return { ok: false, reason: "wrong" };
        if (found.status && found.status !== "Active") return { ok: false, reason: "disabled" };
        const exp = num(found.exp_date, 0);
        if (exp > 0 && exp * 1000 < Date.now()) return { ok: false, reason: "expired" };
        if (!this.userLists(found).includes(listId)) return { ok: false, reason: "not-allowed" };
        return { ok: true, user: found, list };
    },

    getUserInfo(user, req, prefix) {
        const h = (req && req.headers) || {};
        const hostPort = String(h["x-forwarded-host"] || h.host || "localhost").split(",")[0].trim();
        const proto = String(h["x-forwarded-proto"] || "https").split(",")[0].trim();
        const m = hostPort.match(/^(.*?)(?::(\d+))?$/);
        const host = m[1];
        const port = m[2] || (proto === "http" ? "80" : "443");
        const now = Math.floor(Date.now() / 1000);
        return {
            user_info: {
                username: user.username,
                password: user.password,
                message: "Welcome",
                auth: 1,
                status: "Active",
                exp_date: user.exp_date ? str(user.exp_date) : null,
                is_trial: "0",
                active_cons: "0",
                created_at: str(user.created_at, "0"),
                max_connections: str(user.max_connections, "1"),
                allowed_output_formats: ["m3u8", "ts"]
            },
            server_info: {
                url: host,
                port: proto === "http" ? port : "80",
                https_port: proto === "https" ? port : "443",
                server_protocol: proto,
                rtmp_port: "",
                timezone: "UTC",
                timestamp_now: now,
                time_now: new Date(now * 1000).toISOString().replace("T", " ").slice(0, 19),
                path: prefix || ""
            }
        };
    },

    // ------------------------------------------------------------------ data

    /** All docs of one type in one list, cached until the list's rev changes. */
    async _all(listId, coll, type) {
        const list = await this.getList(listId);
        const rev = list ? num(list.rev, 0) : 0;
        const key = `${coll}:${listId}:${type}`;
        const hit = cget(key, DATA_TTL, rev);
        if (hit !== undefined) return hit;
        const snap = await this._db().collection(coll).where("list_id", "==", listId).where("type", "==", type).get();
        const rows = snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
        return cset(key, rows, rev);
    },

    async getCategories(listId, type) {
        const rows = await this._all(listId, "xtream_categories", type);
        return rows
            .slice()
            .sort((a, b) => num(a.order, 0) - num(b.order, 0) || str(a.category_name).localeCompare(str(b.category_name)))
            .map((d) => ({
                category_id: str(d.category_id || d._id),
                category_name: d.category_name || "Unknown Category",
                parent_id: num(d.parent_id, 0)
            }));
    },

    async getStreams(listId, type, categoryId) {
        let rows = await this._all(listId, "xtream_streams", type);
        if (categoryId !== undefined && categoryId !== null && categoryId !== "" && categoryId !== "*") {
            const want = str(categoryId);
            rows = rows.filter((d) => str(d.category_id) === want);
        }
        rows = rows.slice().sort((a, b) => num(a.num, 0) - num(b.num, 0) || num(a.stream_id, 0) - num(b.stream_id, 0));
        return rows.map((d, i) => this.formatStream(type, d, i + 1));
    },

    formatStream(type, d, n) {
        const id = num(d.stream_id, 0);
        const name = d.name || d.title || "";
        const cat = str(d.category_id, "0");
        if (type === "series") {
            return {
                num: n, name, series_id: id,
                cover: d.cover || d.stream_icon || "",
                plot: str(d.plot), cast: str(d.cast), director: str(d.director), genre: str(d.genre),
                releaseDate: str(d.releaseDate || d.year), last_modified: str(d.added, "0"),
                rating: str(d.rating, "0"), rating_5based: num(d.rating, 0) / 2,
                backdrop_path: Array.isArray(d.backdrop_path) ? d.backdrop_path : (d.backdrop_path ? [d.backdrop_path] : []),
                youtube_trailer: str(d.youtube_trailer), episode_run_time: str(d.episode_run_time, "0"),
                category_id: cat, category_ids: catIds(cat)
            };
        }
        if (type === "vod") {
            return {
                num: n, name, stream_type: "movie", stream_id: id, stream_icon: str(d.stream_icon),
                rating: str(d.rating, "0"), rating_5based: num(d.rating, 0) / 2, added: str(d.added, "0"),
                category_id: cat, category_ids: catIds(cat),
                container_extension: d.container_extension || extOf(str(d.direct_source).split("?")[0]) || "mp4",
                custom_sid: "", direct_source: ""
            };
        }
        return {
            num: n, name, stream_type: "live", stream_id: id, stream_icon: str(d.stream_icon),
            epg_channel_id: str(d.epg_channel_id), added: str(d.added, "0"),
            category_id: cat, category_ids: catIds(cat),
            custom_sid: "", tv_archive: 0, direct_source: "", tv_archive_duration: 0
        };
    },

    async _one(listId, type, streamId) {
        const id = num(streamId, NaN);
        if (!Number.isFinite(id)) return null;
        if (type !== "episode") {
            const rows = await this._all(listId, "xtream_streams", type);
            return rows.find((d) => num(d.stream_id, NaN) === id) || null;
        }
        const key = `ep:${listId}:${id}`;
        const hit = cget(key, DATA_TTL);
        if (hit !== undefined) return hit;
        const snap = await this._db().collection("xtream_streams")
            .where("list_id", "==", listId).where("type", "==", "episode").where("stream_id", "==", id).limit(1).get();
        return cset(key, snap.empty ? null : { _id: snap.docs[0].id, ...snap.docs[0].data() });
    },

    /** URL type (live, movie, series) -> the real source address, or null. */
    async getStreamDirectSource(listId, streamId, urlType) {
        const type = urlType === "movie" ? "vod" : (urlType === "series" ? "episode" : "live");
        const d = await this._one(listId, type, streamId);
        return (d && d.direct_source) || null;
    },

    async getVodInfo(listId, streamId) {
        const d = await this._one(listId, "vod", streamId);
        if (!d) return { info: {}, movie_data: {} };
        const s = this.formatStream("vod", d, 1);
        return {
            info: {
                name: s.name, movie_image: s.stream_icon, cover_big: s.stream_icon,
                plot: d.plot || "", description: d.plot || "", genre: str(d.genre), cast: str(d.cast), director: str(d.director),
                releasedate: str(d.releaseDate || d.year), duration: str(d.duration), duration_secs: num(d.duration_secs, 0),
                rating: s.rating, tmdb_id: str(d.tmdb_id), youtube_trailer: str(d.youtube_trailer),
                backdrop_path: d.backdrop_path ? [].concat(d.backdrop_path) : []
            },
            movie_data: {
                stream_id: s.stream_id, name: s.name, added: s.added, category_id: s.category_id,
                container_extension: s.container_extension, custom_sid: "", direct_source: ""
            }
        };
    },

    async getSeriesInfo(listId, seriesId) {
        const series = await this._one(listId, "series", seriesId);
        if (!series) return { seasons: [], info: {}, episodes: {} };
        const sid = num(series.stream_id, 0);
        const key = `eps:${listId}:${sid}`;
        const list = await this.getList(listId);
        let eps = cget(key, DATA_TTL, num(list && list.rev, 0));
        if (eps === undefined) {
            const snap = await this._db().collection("xtream_streams")
                .where("list_id", "==", listId).where("type", "==", "episode").where("series_id", "==", sid).get();
            eps = cset(key, snap.docs.map((d) => ({ _id: d.id, ...d.data() })), num(list && list.rev, 0));
        }
        const episodes = {};
        eps.slice()
            .sort((a, b) => num(a.season_num, 1) - num(b.season_num, 1) || num(a.episode_num, 1) - num(b.episode_num, 1))
            .forEach((ep) => {
                const season = num(ep.season_num, 1);
                (episodes[season] = episodes[season] || []).push({
                    id: str(ep.stream_id),
                    episode_num: num(ep.episode_num, 1),
                    title: ep.name || `Episode ${num(ep.episode_num, 1)}`,
                    container_extension: ep.container_extension || extOf(str(ep.direct_source).split("?")[0]) || "mp4",
                    info: { plot: str(ep.plot), movie_image: str(ep.stream_icon), duration: str(ep.duration) },
                    custom_sid: "", added: str(ep.added, "0"), season, direct_source: ""
                });
            });
        const info = this.formatStream("series", series, 1);
        return {
            seasons: Object.keys(episodes).map((s) => ({ season_number: num(s, 1), name: `Season ${s}`, episode_count: episodes[s].length })),
            info: { ...info, cover: info.cover },
            episodes
        };
    },

    async buildM3u(listId, params, base) {
        const u = encodeURIComponent(str(params.username));
        const p = encodeURIComponent(str(params.password));
        const liveExt = params.output === "m3u8" || params.output === "hls" ? "m3u8" : "ts";
        const withVod = params.type !== "m3u" ; // m3u_plus (default) = live + movies
        const lines = ["#EXTM3U"];
        const cats = {};
        for (const t of ["live", "vod"]) (await this.getCategories(listId, t)).forEach((c) => { cats[t + ":" + c.category_id] = c.category_name; });
        for (const s of await this.getStreams(listId, "live")) {
            lines.push(`#EXTINF:-1 tvg-id="${m3uEscape(s.epg_channel_id)}" tvg-name="${m3uEscape(s.name)}" tvg-logo="${m3uEscape(s.stream_icon)}" group-title="${m3uEscape(cats["live:" + s.category_id] || "")}",${m3uEscape(s.name)}`);
            lines.push(`${base}/live/${u}/${p}/${s.stream_id}.${liveExt}`);
        }
        if (withVod) {
            for (const s of await this.getStreams(listId, "vod")) {
                lines.push(`#EXTINF:-1 tvg-name="${m3uEscape(s.name)}" tvg-logo="${m3uEscape(s.stream_icon)}" group-title="${m3uEscape(cats["vod:" + s.category_id] || "")}",${m3uEscape(s.name)}`);
                lines.push(`${base}/movie/${u}/${p}/${s.stream_id}.${s.container_extension}`);
            }
        }
        return lines.join("\n") + "\n";
    }
};

module.exports = XtreamService;
