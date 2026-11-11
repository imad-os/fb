// Xtream Codes compatible server on D1, several lists.
//   /xtream/player_api.php ...           the "default" list
//   /xtream/l/<list>/player_api.php ...  any list
//   /player_api.php ... (no prefix)      standard Xtream addresses: the user's own list
//                                        (the default list if they have it, else their first one)
//   .../get.php  .../xmltv.php  .../live|movie|series/<user>/<pass>/<id>.<ext>
import { json, text, str, num, now, params, extOf, LIST_ID_RE } from "./util.js";

const DEFAULT_LIST = "default";

export function parsePath(pathname) {
  let segs = pathname.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch (e) { return s; } });
  let prefix = "";
  // null = the root addresses: pick the user's list in authenticate()
  let listId = null;
  if (segs[0] === "xtream") { segs = segs.slice(1); prefix = "/xtream"; listId = DEFAULT_LIST; }
  if (segs[0] === "l" && segs.length >= 2) {
    listId = segs[1].toLowerCase();
    prefix += "/l/" + encodeURIComponent(listId);
    segs = segs.slice(2);
  }
  return { listId, rest: segs, prefix };
}

/**
 * One round trip: the list + the user + whether the user has the list.
 * reason: missing | list | wrong | disabled | expired | not-allowed
 */
export async function authenticate(env, listId, username, password) {
  username = str(username).trim(); password = str(password);
  if (!username || !password) return { ok: false, reason: "missing" };
  if (listId === null) return authenticateAny(env, username, password);
  if (!LIST_ID_RE.test(listId)) return { ok: false, reason: "list" };
  const [l, u] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, enabled, rev FROM lists WHERE id = ?").bind(listId),
    env.DB.prepare("SELECT u.*, EXISTS(SELECT 1 FROM user_lists x WHERE x.user_id = u.id AND x.list_id = ?) AS allowed FROM users u WHERE u.username = ?").bind(listId, username)
  ]);
  const list = l.results[0];
  if (!list || !list.enabled) return { ok: false, reason: "list" };
  const user = u.results[0];
  if (!user || user.password !== password) return { ok: false, reason: "wrong" };
  if (user.status && user.status !== "Active") return { ok: false, reason: "disabled" };
  if (user.exp_date && user.exp_date < now()) return { ok: false, reason: "expired" };
  if (!user.allowed) return { ok: false, reason: "not-allowed" };
  return { ok: true, user, list };
}

/** Root addresses: the user's list is the default one if they have it, else the first one that is on. */
async function authenticateAny(env, username, password) {
  const [u, l] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username),
    env.DB.prepare("SELECT l.id, l.name, l.enabled, l.rev FROM user_lists x JOIN lists l ON l.id = x.list_id JOIN users u ON u.id = x.user_id WHERE u.username = ? AND l.enabled = 1 ORDER BY (l.id = ?) DESC, l.created, l.id LIMIT 1").bind(username, DEFAULT_LIST)
  ]);
  const user = u.results[0];
  if (!user || user.password !== password) return { ok: false, reason: "wrong" };
  if (user.status && user.status !== "Active") return { ok: false, reason: "disabled" };
  if (user.exp_date && user.exp_date < now()) return { ok: false, reason: "expired" };
  const list = l.results[0];
  if (!list) return { ok: false, reason: "not-allowed" };
  return { ok: true, user, list };
}

function hostInfo(request) {
  const url = new URL(request.url);
  return { host: url.hostname, port: url.port || (url.protocol === "http:" ? "80" : "443"), proto: url.protocol.replace(":", "") };
}

function userInfo(user, request, prefix) {
  const h = hostInfo(request); const t = now();
  return {
    user_info: {
      username: user.username, password: user.password, message: "Welcome", auth: 1, status: "Active",
      exp_date: user.exp_date ? String(user.exp_date) : null, is_trial: "0", active_cons: "0",
      created_at: str(user.created_at, "0"), max_connections: str(user.max_connections, "1"),
      allowed_output_formats: ["m3u8", "ts"]
    },
    server_info: {
      url: h.host, port: h.proto === "http" ? h.port : "80", https_port: h.proto === "https" ? h.port : "443",
      server_protocol: h.proto, rtmp_port: "", timezone: "UTC", timestamp_now: t,
      time_now: new Date(t * 1000).toISOString().replace("T", " ").slice(0, 19), path: prefix
    }
  };
}

// ------------------------------------------------------------------ formatting

function fmt(type, d, n) {
  const cat = String(d.category_id || 0);
  const catIds = d.category_id ? [d.category_id] : [];
  if (type === "series") {
    return {
      num: n, name: d.name, series_id: d.id, cover: d.icon, plot: d.plot, cast: "", director: "", genre: d.genre,
      releaseDate: d.year, last_modified: String(d.added), rating: d.rating, rating_5based: num(d.rating) / 2,
      backdrop_path: [], youtube_trailer: "", episode_run_time: "0", category_id: cat, category_ids: catIds
    };
  }
  if (type === "vod") {
    return {
      num: n, name: d.name, stream_type: "movie", stream_id: d.id, stream_icon: d.icon, rating: d.rating,
      rating_5based: num(d.rating) / 2, added: String(d.added), category_id: cat, category_ids: catIds,
      container_extension: d.ext || extOf(d.source) || "mp4", custom_sid: "", direct_source: ""
    };
  }
  return {
    num: n, name: d.name, stream_type: "live", stream_id: d.id, stream_icon: d.icon, epg_channel_id: d.epg_id,
    added: String(d.added), category_id: cat, category_ids: catIds, custom_sid: "", tv_archive: 0,
    direct_source: "", tv_archive_duration: 0
  };
}

const COLS = "id, name, icon, category_id, num, epg_id, ext, source, plot, year, rating, genre, added";

/**
 * The formatted rows of one type in one list. Kept in Cloudflare's cache under the list's rev,
 * so a big list costs D1 reads and JSON work only once per change (custom domains only:
 * the cache does nothing on *.workers.dev, where D1 answers every time).
 */
async function listRows(env, ctx, list, type) {
  const key = new Request(`https://cache.iptv.internal/${encodeURIComponent(list.id)}/${list.rev}/${type}`);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit.json();
  }
  const r = await env.DB.prepare(`SELECT ${COLS} FROM streams WHERE list_id = ? AND type = ? AND enabled = 1 ORDER BY num, id`).bind(list.id, type).all();
  const rows = r.results.map((d, i) => fmt(type, d, i + 1));
  if (cache) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(rows), { headers: { "Cache-Control": "max-age=86400", "Content-Type": "application/json" } })));
  return rows;
}

async function categories(env, list, type) {
  const r = await env.DB.prepare("SELECT id, name FROM categories WHERE list_id = ? AND type = ? ORDER BY ord, name").bind(list.id, type).all();
  return r.results.map((c) => ({ category_id: String(c.id), category_name: c.name, parent_id: 0 }));
}

async function streams(env, ctx, list, type, categoryId) {
  let rows = await listRows(env, ctx, list, type);
  if (categoryId !== undefined && categoryId !== "" && categoryId !== "*" && categoryId !== null) {
    const want = String(categoryId);
    rows = rows.filter((s) => s.category_id === want);
  }
  return rows;
}

async function one(env, listId, type, id) {
  const n = num(id, NaN);
  if (!Number.isInteger(n)) return null;
  return env.DB.prepare("SELECT * FROM streams WHERE id = ? AND list_id = ? AND type = ? AND enabled = 1").bind(n, listId, type).first();
}

async function vodInfo(env, list, id) {
  const d = await one(env, list.id, "vod", id);
  if (!d) return { info: {}, movie_data: {} };
  const s = fmt("vod", d, 1);
  return {
    info: {
      name: d.name, movie_image: d.icon, cover_big: d.icon, plot: d.plot, description: d.plot, genre: d.genre,
      releasedate: d.year, rating: d.rating, tmdb_id: d.tmdb_id, youtube_trailer: "", backdrop_path: [], duration: "", duration_secs: 0
    },
    movie_data: { stream_id: d.id, name: d.name, added: s.added, category_id: s.category_id, container_extension: s.container_extension, custom_sid: "", direct_source: "" }
  };
}

async function seriesInfo(env, list, id) {
  const s = await one(env, list.id, "series", id);
  if (!s) return { seasons: [], info: {}, episodes: {} };
  const r = await env.DB.prepare("SELECT * FROM streams WHERE list_id = ? AND type = 'episode' AND series_id = ? AND enabled = 1 ORDER BY season, episode, id").bind(list.id, s.id).all();
  const episodes = {};
  for (const e of r.results) {
    const season = e.season || 1;
    (episodes[season] = episodes[season] || []).push({
      id: String(e.id), episode_num: e.episode || 1, title: e.name || `Episode ${e.episode || 1}`,
      container_extension: e.ext || extOf(e.source) || "mp4", info: { plot: e.plot, movie_image: e.icon, duration: "" },
      custom_sid: "", added: String(e.added), season, direct_source: ""
    });
  }
  return {
    seasons: Object.keys(episodes).map((k) => ({ season_number: num(k, 1), name: `Season ${k}`, episode_count: episodes[k].length })),
    info: fmt("series", s, 1),
    episodes
  };
}

const m3uEsc = (s) => str(s).replace(/"/g, "'").replace(/[\r\n]+/g, " ");

async function m3u(env, ctx, list, p, base) {
  const u = encodeURIComponent(str(p.username)); const pw = encodeURIComponent(str(p.password));
  const liveExt = p.output === "m3u8" || p.output === "hls" ? "m3u8" : "ts";
  const cats = {};
  for (const t of ["live", "vod"]) (await categories(env, list, t)).forEach((c) => { cats[t + c.category_id] = c.category_name; });
  const out = ["#EXTM3U"];
  for (const s of await listRows(env, ctx, list, "live")) {
    out.push(`#EXTINF:-1 tvg-id="${m3uEsc(s.epg_channel_id)}" tvg-name="${m3uEsc(s.name)}" tvg-logo="${m3uEsc(s.stream_icon)}" group-title="${m3uEsc(cats["live" + s.category_id] || "")}",${m3uEsc(s.name)}`);
    out.push(`${base}/live/${u}/${pw}/${s.stream_id}.${liveExt}`);
  }
  if (p.type !== "m3u") {
    for (const s of await listRows(env, ctx, list, "vod")) {
      out.push(`#EXTINF:-1 tvg-name="${m3uEsc(s.name)}" tvg-logo="${m3uEsc(s.stream_icon)}" group-title="${m3uEsc(cats["vod" + s.category_id] || "")}",${m3uEsc(s.name)}`);
      out.push(`${base}/movie/${u}/${pw}/${s.stream_id}.${s.container_extension}`);
    }
  }
  return out.join("\n") + "\n";
}

// ------------------------------------------------------------------ http

export async function handleXtream(request, env, ctx) {
  const url = new URL(request.url);
  const { listId, rest, prefix } = parsePath(url.pathname);
  const first = rest[0] || "";

  const isStream = (rest.length === 4 && ["live", "movie", "series"].includes(first)) || (rest.length === 3 && !first.includes("."));
  if (isStream) {
    const [type, username, password, file] = rest.length === 4 ? rest : ["live", ...rest];
    const auth = await authenticate(env, listId, username, password);
    if (!auth.ok) return text("Access denied: " + auth.reason, auth.reason === "list" ? 404 : 403);
    const dbType = type === "movie" ? "vod" : type === "series" ? "episode" : "live";
    const row = await one(env, auth.list.id, dbType, file.split(".")[0]);
    if (!row || !row.source) return text("Stream source not found", 404);
    return new Response(null, { status: 302, headers: { Location: row.source, "Cache-Control": "no-store" } });
  }

  const p = await params(request, url);

  if (first === "xmltv.php") {
    // The channel list (tvg-id, name, logo) so players can match an outside guide; no programmes are stored here.
    const auth = await authenticate(env, listId, p.username, p.password);
    if (!auth.ok) return text("Access denied: " + auth.reason, auth.reason === "list" ? 404 : 401);
    const x = (v) => str(v).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
    const seen = new Set(); let body = "";
    for (const s of await listRows(env, ctx, auth.list, "live")) {
      if (!s.epg_channel_id || seen.has(s.epg_channel_id)) continue; seen.add(s.epg_channel_id);
      body += `  <channel id="${x(s.epg_channel_id)}"><display-name>${x(s.name)}</display-name>${s.stream_icon ? `<icon src="${x(s.stream_icon)}"/>` : ""}</channel>\n`;
    }
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="iptv-lists">\n${body}</tv>\n`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
  }

  if (first === "get.php") {
    const auth = await authenticate(env, listId, p.username, p.password);
    if (!auth.ok) return text("#EXTM3U\n# Access denied: " + auth.reason + "\n", auth.reason === "list" ? 404 : 401);
    const body = await m3u(env, ctx, auth.list, p, url.origin + prefix);
    return new Response(body, { headers: { "Content-Type": "audio/x-mpegurl; charset=utf-8", "Content-Disposition": `inline; filename="${auth.list.id}.m3u"` } });
  }

  if (first && first !== "player_api.php" && first !== "panel_api.php") return json({ status: "error", message: "Unknown address" }, 404);
  if (!p.action && !(p.username && p.password)) return json({ status: "error", message: "Missing 'action' parameter" }, 400);

  const auth = await authenticate(env, listId, p.username, p.password);
  if (!auth.ok) return json({ user_info: { auth: 0, status: auth.reason }, status: "error", message: "Authentication failed" }, 401);
  const list = auth.list;
  switch (p.action || "get_user_info") {
    case "get_user_info": return json(userInfo(auth.user, request, prefix));
    case "get_live_categories": return json(await categories(env, list, "live"));
    case "get_vod_categories": return json(await categories(env, list, "vod"));
    case "get_series_categories": return json(await categories(env, list, "series"));
    case "get_live_streams": return json(await streams(env, ctx, list, "live", p.category_id));
    case "get_vod_streams": return json(await streams(env, ctx, list, "vod", p.category_id));
    case "get_series": return json(await streams(env, ctx, list, "series", p.category_id));
    case "get_vod_info": return json(await vodInfo(env, list, p.vod_id || p.stream_id));
    case "get_series_info": return json(await seriesInfo(env, list, p.series_id));
    case "get_short_epg": case "get_simple_data_table": return json({ epg_listings: [] });
    default: return json({ status: "error", message: "Unknown action" });
  }
}
