// The helper APIs of the Firebase version, same paths and same answers:
// footballRequest, footballRecommendations, footballNews, getLocation, fetchSubtitles, downloadSubtitle,
// searchTrailer, getRecommendations. Keys come from Worker secrets (see wrangler.toml);
// football keys from D1 (admin page > Football API), see football_keys.js.
import { json, text, str, num, params } from "./util.js";
import { footballApis, noteUse } from "./football_keys.js";
import { searchForPlayers, downloadToken, publicProviders } from "./subtitles/index.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";
const BACKDROP = "https://image.tmdb.org/t/p/original";

async function getJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { "user-agent": UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(opts.timeout || 10000) });
  let data = null; try { data = await r.json(); } catch (e) { /* not JSON */ }
  return { ok: r.ok, status: r.status, data };
}
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();

// ------------------------------------------------------------------ football
const GLOBAL_LEAGUES = [1, 15, 1168];
const CONTINENT_LEAGUES = {
  EU: { CUP: [4], CL: [2], SECOND: [3, 848] }, AF: { CUP: [6], CL: [12], SECOND: [20] }, AS: { CUP: [15], CL: [17], SECOND: [18] },
  SA: { CUP: [9], CL: [13], SECOND: [11] }, NA: { CUP: [22], CL: [16], SECOND: [] }
};
const FRIENDLIES = [10, 666];
const FAVORITE_TEAMS = [85, 50, 541, 529, 23];
let apiIndex = 0;

async function footballFetch(env, endpoint, p, round = 0) {
  const apis = await footballApis(env);
  if (!apis.length) throw new Error("No football API key is on (admin page > Football API)");
  const api = apis[apiIndex % apis.length];
  const path = endpoint.startsWith("/") ? endpoint : "/" + endpoint;
  const r = await getJson(`${api.url}${path}?${qs(p)}`, { headers: { "x-rapidapi-host": api.host, "x-rapidapi-key": api.key } });
  await noteUse(env, api);
  if (!r.data) throw new Error((r.data && r.data.message) || "Failed to fetch data from Football Provider");
  // A key with errors (daily limit, suspended...): try the next keys, each at most once.
  const failed = (r.data.errors && Object.keys(r.data.errors).length) || (!r.ok && r.data.message && r.data.response === undefined);
  if (round < Math.min(apis.length - 1, 6) && failed) {
    apiIndex = (apiIndex + 1) % apis.length;
    return footballFetch(env, endpoint, p, round + 1);
  }
  return { CAI: apiIndex, REC: round, ...r.data };
}

async function recommendedMatches(env, country, city, continent) {
  const today = new Date().toISOString().slice(0, 10);
  country = str(country).toLowerCase(); city = str(city).toLowerCase();
  const response = await footballFetch(env, "/fixtures", { date: today });
  if (response.errors && Object.keys(response.errors).length) return response.errors;
  const local = CONTINENT_LEAGUES[continent] || { CUP: [], CL: [], SECOND: [] };
  return (response.response || []).map((match) => {
    let score = 0;
    const leagueId = match.league.id, leagueCountry = str(match.league.country).toLowerCase();
    const home = str(match.teams.home.name).toLowerCase(), away = str(match.teams.away.name).toLowerCase();
    const venue = str(match.fixture.venue && match.fixture.venue.city).toLowerCase();
    const fav = FAVORITE_TEAMS.includes(match.teams.home.id) || FAVORITE_TEAMS.includes(match.teams.away.id);
    if (GLOBAL_LEAGUES.includes(leagueId)) score = 1000;
    else if (local.CUP.includes(leagueId)) score = 900;
    else if (local.CL.includes(leagueId)) score = 800;
    else if (local.SECOND.includes(leagueId)) score = 700;
    else if (fav) score = 750;
    else if (leagueCountry === country && match.league.type === "League") score = 600 + (/Premier|1|Botola/.test(match.league.name) ? 50 : 0);
    else if (leagueCountry === country && match.league.type === "Cup") score = 500;
    else if (FRIENDLIES.includes(leagueId) && (home === country || away === country || (city && venue.includes(city)) || fav)) score = 400;
    if (city && (venue.includes(city) || home.includes(city) || away.includes(city))) score = 700;
    if (home === country || away === country) score += 900; else if (country && (home.includes(country) || away.includes(country))) score += 400;
    return { match, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 20).map(({ match: m, score }) => ({
    fixture_id: m.fixture.id, date: m.fixture.date, status: m.fixture.status.short,
    league: { name: m.league.name, country: m.league.country, logo: m.league.logo },
    home: { name: m.teams.home.name, logo: m.teams.home.logo, goals: m.goals.home },
    away: { name: m.teams.away.name, logo: m.teams.away.logo, goals: m.goals.away },
    priority_score: score
  }));
}

const CONTINENT_MAP = {
  MA: "AF", DZ: "AF", TN: "AF", EG: "AF", LY: "AF", NG: "AF", GH: "AF", CI: "AF", SN: "AF", CM: "AF", ZA: "AF", KE: "AF", TZ: "AF", UG: "AF", AO: "AF",
  GB: "EU", UK: "EU", FR: "EU", DE: "EU", IT: "EU", ES: "EU", PT: "EU", NL: "EU", BE: "EU", RU: "EU", TR: "EU", IL: "EU", KZ: "EU", UA: "EU", PL: "EU", SE: "EU", NO: "EU", DK: "EU",
  JP: "AS", KR: "AS", CN: "AS", IN: "AS", SA: "AS", QA: "AS", AE: "AS", IR: "AS", IQ: "AS", TH: "AS", AU: "AS",
  BR: "SA", AR: "SA", UY: "SA", CO: "SA", CL: "SA", PE: "SA", EC: "SA", PY: "SA", VE: "SA", BO: "SA",
  US: "NA", CA: "NA", MX: "NA", CR: "NA", PA: "NA", JM: "NA", HN: "NA", SV: "NA", GT: "NA"
};

// ------------------------------------------------------------------ location
/** The viewer's own place comes free with every Cloudflare request (request.cf); another IP asks ip-api.com. */
async function location(request, ip) {
  const self = request.headers.get("cf-connecting-ip") || "";
  if (!ip || ip === self) {
    const cf = request.cf || {};
    return {
      status: "success", query: self, country: str(cf.country && new Intl.DisplayNames(["en"], { type: "region" }).of(cf.country)), countryCode: str(cf.country),
      region: str(cf.regionCode), regionName: str(cf.region), city: str(cf.city), zip: str(cf.postalCode), lat: num(cf.latitude), lon: num(cf.longitude),
      timezone: str(cf.timezone), continentCode: str(cf.continent), isp: str(cf.asOrganization), as: cf.asn ? "AS" + cf.asn : ""
    };
  }
  if (!/^[0-9a-fA-F:.]{2,45}$/.test(ip)) throw new Error("Bad IP");
  const r = await getJson(`http://ip-api.com/json/${ip}`, { timeout: 5000 });
  if (!r.data || r.data.status === "fail") throw new Error("Could not fetch location details");
  return { status: "success", ...r.data };
}

// ------------------------------------------------------------------ subtitles
// Several providers, one file each: see ./subtitles/ (keys in D1, managed from the admin page).

// ------------------------------------------------------------------ trailers
function cleanName(raw) {
  let name = str(raw); let year = null;
  const i = name.indexOf(" - "); if (i !== -1) name = name.slice(i + 3);
  const y = name.match(/\((\d{4})\)/); if (y) { year = y[1]; name = name.replace(/\s*\(\d{4}\)\s*/, ""); }
  return { name: name.replace(/\[.*?\]/g, "").replace(/\{.*?\}/g, "").trim(), year };
}
function formatTmdb(d, video, type) {
  const movie = type === "movie" || d.title;
  return {
    found: true, id: video ? video.key : null, url: video ? `https://www.youtube.com/watch?v=${video.key}` : null,
    title: movie ? d.title : d.name, original_title: movie ? d.original_title : d.original_name, date: movie ? d.release_date : d.first_air_date,
    rating: d.vote_average ? +d.vote_average.toFixed(1) : 0, votes: d.vote_count,
    poster: d.poster_path ? IMG + d.poster_path : null, backdrop: d.backdrop_path ? BACKDROP + d.backdrop_path : null,
    thumbnail: video ? `https://img.youtube.com/vi/${video.key}/hqdefault.jpg` : null, overview: d.overview || "",
    genres: d.genres ? d.genres.map((g) => g.name) : [], source: "TMDB"
  };
}
async function tmdbDetails(env, id, type) {
  for (const t of [type, type === "movie" ? "tv" : "movie"]) {
    const r = await getJson(`${TMDB}/${t}/${id}?${qs({ api_key: env.TMDB_API_KEY, append_to_response: "videos" })}`);
    if (r.ok && r.data) {
      const v = (r.data.videos && r.data.videos.results) || [];
      const tr = v.find((x) => x.site === "YouTube" && x.type === "Trailer") || v.find((x) => x.site === "YouTube");
      return tr ? formatTmdb(r.data, tr, t) : null;
    }
  }
  return null;
}
async function searchTrailer(env, name, year, tmdbId, type) {
  if (tmdbId) { const r = await tmdbDetails(env, tmdbId, type); if (r) return r; }
  let meta = null;
  if (name) {
    const c = cleanName(name); const y = c.year || year;
    const p = { api_key: env.TMDB_API_KEY, query: c.name, page: 1 };
    if (y) p[type === "tv" ? "first_air_date_year" : "year"] = y;
    const s = await getJson(`${TMDB}/search/${type}?${qs(p)}`);
    meta = s.data && s.data.results && s.data.results[0];
    if (meta) { const r = await tmdbDetails(env, meta.id, meta.media_type || type); if (r) return r; }
  }
  const c = cleanName(name); const q = `${c.name}${c.year || year ? " " + (c.year || year) : ""} trailer`;
  const r = await getJson(`https://www.googleapis.com/youtube/v3/search?${qs({ part: "snippet", q, type: "video", maxResults: 1, key: env.YOUTUBE_API_KEY })}`);
  const it = r.data && r.data.items && r.data.items[0];
  if (it) {
    if (meta) { const f = formatTmdb(meta, { key: it.id.videoId }, meta.title ? "movie" : "tv"); f.source = "TMDB_Metadata + YouTube_Search"; return f; }
    return { found: true, id: it.id.videoId, url: `https://www.youtube.com/watch?v=${it.id.videoId}`, title: it.snippet.title, date: it.snippet.publishedAt,
      thumbnail: it.snippet.thumbnails.high.url, rating: null, poster: it.snippet.thumbnails.high.url, description: it.snippet.description, source: "YouTube_Raw" };
  }
  return { found: false, message: "No trailer found" };
}

// ------------------------------------------------------------------ recommendations
const GENRES = { Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36, Horror: 27,
  Music: 10402, Mystery: 9648, Romance: 10749, "Science Fiction": 878, "Sci-Fi": 878, "TV Movie": 10770, Thriller: 53, War: 10752, Western: 37 };
async function recommendations(env, favorites, watched, limit, type) {
  const ids = new Set(), titles = new Set();
  for (const it of [...(Array.isArray(favorites) ? favorites : []), ...(Array.isArray(watched) ? watched : [])]) {
    if (it.tmdb_id) ids.add(+it.tmdb_id);
    for (const t of [it.name, it.title]) if (t) titles.add(String(t).toLowerCase().trim());
  }
  const tally = {};
  for (const it of Array.isArray(favorites) ? favorites : []) {
    const gs = Array.isArray(it.genre) ? it.genre : typeof it.genre === "string" ? it.genre.split(",").map((s) => s.trim()) : [];
    for (const g of gs) { const id = GENRES[g] || GENRES[String(g).replace("Movies", "").trim()]; if (id) tally[id] = (tally[id] || 0) + 1; }
  }
  const top = Object.keys(tally).sort((a, b) => tally[b] - tally[a]).slice(0, 3);
  const genres = top.length ? top.join("|") : "28|18";
  const out = [];
  for (let page = 1; out.length < limit && page <= 10; page++) {
    const r = await getJson(`${TMDB}/discover/${type}?${qs({ api_key: env.TMDB_API_KEY, with_genres: genres, sort_by: "popularity.desc", "vote_count.gte": 100, page })}`);
    const items = (r.data && r.data.results) || []; if (!items.length) break;
    for (const it of items) {
      const key = String(it.title || it.name || "").toLowerCase().trim();
      if (ids.has(it.id) || titles.has(key)) continue;
      ids.add(it.id);
      out.push({ id: it.id, title: it.title || it.name, overview: it.overview, poster: it.poster_path ? IMG + it.poster_path : null, backdrop: it.backdrop_path ? BACKDROP + it.backdrop_path : null,
        rating: it.vote_average ? +it.vote_average.toFixed(1) : 0, year: str(it.release_date || it.first_air_date).split("-")[0], type });
      if (out.length >= limit) break;
    }
  }
  return out;
}

// ------------------------------------------------------------------ router
export const SERVICE_ROUTES = ["footballRequest", "footballRecommendations", "footballNews", "getLocation", "fetchSubtitles", "downloadSubtitle", "subtitleProviders", "searchTrailer", "getRecommendations"];

export async function handleService(name, request, env) {
  const url = new URL(request.url);
  const p = await params(request, url);
  try {
    switch (name) {
      case "footballRequest": {
        const endpoint = p.endpoint; const q = request.method === "GET" ? { ...p } : (p.params || {}); delete q.endpoint;
        if (!endpoint) return json({ error: "Missing 'endpoint' parameter" }, 400);
        return json(await footballFetch(env, endpoint, q));
      }
      case "footballRecommendations": {
        let { country, city, continent } = p;
        if (!country || !continent) {
          const cf = request.cf || {};
          country = country || (cf.country ? new Intl.DisplayNames(["en"], { type: "region" }).of(cf.country) : "");
          city = city || cf.city || ""; continent = continent || CONTINENT_MAP[cf.country] || "";
        }
        if (!country || !continent) return json({ status: "error", message: "Location (Country/Continent) is required and could not be detected." }, 400);
        const data = await recommendedMatches(env, country, city, continent);
        return json({ status: "success", count: data.length, data });
      }
      case "footballNews": {
        const u = `https://api.elbotola.com/newsfeed/v3/?exclude_ids=&has_copyright=True&important_matches=True&${qs({ lang: p.langue || "en", page: parseInt(p.page, 10) || 1, country_code: p.country || "MA" })}`;
        const r = await getJson(u); if (!r.data) throw new Error("Failed to fetch data from Football Provider");
        return json(r.data);
      }
      case "getLocation": return json(await location(request, p.ip || ""));
      case "fetchSubtitles": {
        // { movieData, movieType: movie | series, languages?: "ar,en", provider?: "all" | "subdl" | ... (empty = the admin's default) }
        // -> { status: "success", provider, cached, subtitles, errors? }  or  { status: "error", message, errors? } with HTTP 4xx/5xx
        const [body, status] = await searchForPlayers(env, p);
        return json(body, status);
      }
      case "subtitleProviders": return json(await publicProviders(env));
      case "downloadSubtitle": {
        // ?url=<the url/file of a search result> -> the subtitle file as UTF-8 text (zips opened, Windows-1256/1252 converted)
        if (!p.url) return json({ status: "error", code: "bad_request", message: "Missing 'url' parameter" }, 400);
        try {
          const f = await downloadToken(env, p.url);
          return new Response(f.text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `inline; filename="${encodeURIComponent(f.name)}"`, "Cache-Control": "public, max-age=86400", "X-Subtitle-Cache": f.cached ? "hit" : "miss" } });
        } catch (e) {
          if (e.status === 400) return json({ status: "error", code: "bad_request", message: "Only subtitles from a search can be downloaded here" }, 400);
          if (e.status === 429) return json({ status: "error", code: "limit", message: String(e.message || e) }, 429);
          return json({ status: "error", code: "provider_error", message: String(e.message || e) }, 502);
        }
      }
      case "searchTrailer": {
        const type = p.type === "tv" ? "tv" : "movie";
        if (!p.movie_name && !p.tmdb_id) return json({ status: "error", message: "Missing 'movie_name' or 'tmdb_id' parameter" }, 400);
        return json(await searchTrailer(env, p.movie_name, p.year, p.tmdb_id, type));
      }
      case "getRecommendations": {
        let count = parseInt(p.returnmax, 10); if (!Number.isFinite(count) || count < 1) count = 20; if (count > 100) count = 100;
        const data = await recommendations(env, p.favorites || [], p.watched || [], count, p.type === "tv" ? "tv" : "movie");
        return json({ status: "success", count: data.length, data });
      }
    }
  } catch (e) {
    return json({ status: "error", error: true, message: e.message || "Error" }, 500);
  }
  return json({ error: "Unknown" }, 404);
}
