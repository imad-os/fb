// Subtitles from several providers (one file each in this folder, same functions: search / download / test).
//   searchForPlayers(env, p)  -> what /fetchSubtitles returns: { status, provider, cached, subtitles, errors? } (+ HTTP status)
//   downloadToken(env, token) -> what /downloadSubtitle returns (UTF-8 text)
//   publicProviders(env)      -> /subtitleProviders (which providers a player can ask for, and the default)
//   subtitlesApi(...)         -> the admin page's /api/subtitles*, /api/subtitle-keys*, /api/subtitles-test
// Keys live in D1 (subtitle_keys) and never leave the Worker: players only get tokens (sub:<provider>:<ref>).
// Cache (D1 subtitle_cache): result lists 24 h (2 h when nothing was found), files 30 days -> fewer provider calls.
// Usage (D1 subtitle_usage): searches / downloads / errors per provider, key and hour -> charts in the admin.
import { json, str, num } from "../util.js";
import { makeQuery, resolveIds, getter, readToken, makeToken, toText, LANG_NAME } from "./common.js";
import subdl from "./subdl.js";
import subsource from "./subsource.js";
import opensubtitles from "./opensubtitles.js";
import wyzie from "./wyzie.js";
import jimaku from "./jimaku.js";
import stremio from "./stremio.js";
import gestdown from "./gestdown.js";

export const PROVIDERS = [subdl, subsource, opensubtitles, wyzie, stremio, gestdown, jimaku];
const byId = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));
const SEARCH_BUDGET_MS = 12000;   // the whole search; a slow provider is left out, the others still answer
const MAX_RESULTS = 80;
const TTL_FOUND = 24 * 3600, TTL_EMPTY = 2 * 3600, TTL_FILE = 30 * 86400;
const MAX_CACHED_FILE = 900 * 1024;
const USAGE_DAYS = 35;

// ------------------------------------------------------------------ state (D1)
const STATE_MS = 30 * 1000;
let memo = { at: 0, v: null };
export const resetState = () => { memo.at = 0; };

async function state(env) {
  if (memo.v && Date.now() - memo.at < STATE_MS) return memo.v;
  let keys = [], prefs = {};
  try { keys = (await env.DB.prepare("SELECT * FROM subtitle_keys ORDER BY ord, id").all()).results; } catch (e) { console.error("subtitle_keys:", e.message); }
  try { prefs = JSON.parse((await env.DB.prepare("SELECT value FROM settings WHERE key = 'subtitle_providers'").first("value")) || "{}"); } catch (e) {}
  const list = PROVIDERS.map((p, i) => {
    const pr = prefs[p.id] || {};
    const pk = keys.filter((k) => k.provider === p.id);
    return { p, on: pr.on !== false, ord: pr.ord ?? i, keys: pk, liveKeys: pk.filter((k) => k.enabled) };
  }).sort((a, b) => a.ord - b.ord);
  const def = byId[prefs._default] ? prefs._default : "all";
  memo = { at: Date.now(), v: { list, keys, prefs, def } };
  return memo.v;
}
const usable = (s) => !!(s.on && (!s.p.needsKey || s.liveKeys.length));

// ------------------------------------------------------------------ usage (one D1 batch per request)
function usageLog() {
  const ev = new Map();
  return {
    add(provider, keyId, kind) {
      const k = `${provider}|${keyId || 0}`;
      const e = ev.get(k) || { provider, keyId: keyId || 0, searches: 0, downloads: 0, errors: 0 };
      e[kind]++; ev.set(k, e);
    },
    async flush(env) {
      if (!ev.size) return;
      const hour = Math.floor(Date.now() / 3600000);
      const st = [...ev.values()].map((e) => env.DB.prepare(`INSERT INTO subtitle_usage (provider, key_id, hour, searches, downloads, errors) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, key_id, hour) DO UPDATE SET searches = searches + excluded.searches, downloads = downloads + excluded.downloads, errors = errors + excluded.errors`)
        .bind(e.provider, e.keyId, hour, e.searches, e.downloads, e.errors));
      for (const e of ev.values()) if (e.keyId && (e.searches || e.downloads)) st.push(env.DB.prepare("UPDATE subtitle_keys SET used = used + ?, last_used = unixepoch() WHERE id = ?").bind(e.searches + e.downloads, e.keyId));
      if (Math.random() < 0.02) {                                         // now and then: drop old usage rows and expired cache
        st.push(env.DB.prepare("DELETE FROM subtitle_usage WHERE hour < ?").bind(hour - USAGE_DAYS * 24));
        st.push(env.DB.prepare("DELETE FROM subtitle_cache WHERE expires < unixepoch()"));
      }
      try { await env.DB.batch(st); } catch (e) { console.error("subtitle_usage:", e.message); }
    }
  };
}

// ------------------------------------------------------------------ cache
async function cacheGet(env, k) {
  try { return await env.DB.prepare("SELECT v FROM subtitle_cache WHERE k = ? AND expires > unixepoch()").bind(k).first("v"); } catch (e) { return null; }
}
async function cachePut(env, k, v, ttl) {
  if (v.length > MAX_CACHED_FILE) return;
  try { await env.DB.prepare("INSERT OR REPLACE INTO subtitle_cache (k, v, expires) VALUES (?, ?, unixepoch() + ?)").bind(k, v, ttl).run(); } catch (e) { console.error("subtitle_cache:", e.message); }
}

/** Runs fn(ctx) with the provider's keys in order; the next key only when one is refused / over its limit. Logs usage. */
async function withKeys(env, s, kind, log, fn) {
  const get = getter();
  const keys = s.p.needsKey ? s.liveKeys : [null];
  if (!keys.length) throw new Error(`${s.p.name}: no key (admin page > Subtitles)`);
  let last;
  for (const k of keys) {
    try { const r = await fn({ key: k ? k.key : "", env, get }); log.add(s.p.id, k && k.id, kind); return r; }
    catch (e) { last = e; log.add(s.p.id, k && k.id, "errors"); if (!(e.status === 401 || e.status === 403 || e.status === 429)) break; }
  }
  throw last;
}
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: no answer in ${ms / 1000} s`)), ms))]);

// ------------------------------------------------------------------ search
/**
 * One search. choice = "all" (every provider that is on) or a provider id. opts.fresh skips the cache (admin test).
 * Returns { q, choice, cached, providers: [{ id, name, ok, count, ms, error }], subtitles }.
 */
export async function searchDetailed(env, movieData, movieType, languages, choice, opts = {}) {
  const st = await state(env);
  choice = choice && !["default", "auto"].includes(choice) ? choice : st.def;
  if (choice !== "all" && !byId[choice]) throw Object.assign(new Error(`Unknown subtitle provider "${choice}"`), { status: 404, code: "unknown_provider" });
  const log = opts.log || usageLog();
  let q = makeQuery(movieData, movieType, languages);
  const active = st.list.filter((s) => (choice === "all" ? usable(s) : s.p.id === choice) && s.p.kinds.includes(q.type));
  if (choice !== "all" && !active.length) {
    const s = st.list.find((x) => x.p.id === choice);
    const why = !s.p.kinds.includes(q.type) ? `${s.p.name} has no ${q.type === "series" ? "TV series" : "movies"}` : !s.on ? `${s.p.name} is turned off` : `${s.p.name} has no key yet`;
    throw Object.assign(new Error(why), { status: 503, code: "provider_unavailable" });
  }
  if (!active.length) throw Object.assign(new Error("No subtitle provider is on (admin page > Subtitles)"), { status: 503, code: "no_provider" });

  const ck = "s:" + JSON.stringify([q.type, q.tmdb || q.imdb || q.title.toLowerCase(), q.tmdb || q.imdb ? "" : q.year, q.season, q.episode, q.langs, active.map((s) => s.p.id)]);
  if (!opts.fresh) {
    const hit = await cacheGet(env, ck);
    if (hit) { log.add("cache", 0, "searches"); if (!opts.log) await log.flush(env); return { ...JSON.parse(hit), choice, cached: true }; }
  }

  q = await resolveIds(env, q, getter());
  const rank = Object.fromEntries(st.list.map((s, i) => [s.p.id, i]));
  const report = [], found = [];
  await Promise.all(active.map(async (s) => {
    const t0 = Date.now();
    try {
      const subs = await withTimeout(withKeys(env, s, "searches", log, (ctx) => s.p.search(q, ctx)), SEARCH_BUDGET_MS, s.p.name);
      const mine = subs.filter((x) => q.langs.includes(x.lang));
      mine.forEach((x) => found.push({ ...x, provider: s.p.id }));
      report.push({ id: s.p.id, name: s.p.name, ok: true, count: mine.length, ms: Date.now() - t0 });
    } catch (e) {
      report.push({ id: s.p.id, name: s.p.name, ok: false, count: 0, ms: Date.now() - t0, error: String(e.message || e).slice(0, 300), status: e.status || 0 });
    }
  }));
  const li = (l) => { const i = q.langs.indexOf(l); return i < 0 ? 99 : i; };
  found.sort((a, b) => li(a.lang) - li(b.lang) || rank[a.provider] - rank[b.provider] || (a.hi ? 1 : 0) - (b.hi ? 1 : 0));
  const subtitles = found.slice(0, MAX_RESULTS).map((x) => {
    const token = makeToken(x.provider, x.ref, q);
    const ln = LANG_NAME[x.lang] || x.lang;
    return { label: `${ln} · ${x.name}`, name: x.name, lang: x.lang, language: ln, url: token, file: token, provider: x.provider,
      providerName: byId[x.provider].name, release: x.release || "", hi: !!x.hi, by: x.by || "" };
  });
  report.sort((a, b) => rank[a.id] - rank[b.id]);
  const out = { q, providers: report, subtitles };
  // cache only answers where every provider answered (an error would otherwise stick for hours)
  if (report.every((r) => r.ok)) await cachePut(env, ck, JSON.stringify(out), subtitles.length ? TTL_FOUND : TTL_EMPTY);
  if (!opts.log) await log.flush(env);
  return { ...out, choice, cached: false };
}

/**
 * /fetchSubtitles. Body: { movieData, movieType, provider?: "<id>" | "auto" | "all", lang?: "ar" | ... | "auto", languages?: "ar,en" }.
 * provider auto/missing = the admin's default (one provider, or all that are on, in order); lang auto/missing = ar then en.
 * -> [body, httpStatus]. Success: { status: "success", provider, cached, subtitles, errors? } (an empty list is not an error).
 * Error: { status: "error", code, message, errors? } with 400 bad_request, 404 unknown_provider, 429 limit, 502 provider_error,
 * 503 no_provider / provider_unavailable.
 */
export async function searchForPlayers(env, p) {
  let movie = p.movieData; if (typeof movie === "string") { try { movie = JSON.parse(movie); } catch (e) { movie = null; } }
  if (!movie || typeof movie !== "object") return [{ status: "error", code: "bad_request", message: "Missing movieData" }, 400];
  const lang = str(p.lang || movie.lang).toLowerCase();
  const langs = p.languages || movie.languages || (lang && lang !== "auto" ? lang : "");
  try {
    const r = await searchDetailed(env, movie, p.movieType || "movie", langs, str(p.provider || movie.provider));
    const errors = r.providers.filter((x) => !x.ok).map((x) => ({ provider: x.id, name: x.name, message: x.error }));
    const base = { provider: r.choice === "all" ? "auto" : r.choice, cached: r.cached };
    if (!r.subtitles.length && errors.length && errors.length === r.providers.length) {
      const limit = r.providers.every((x) => x.status === 429);
      return [{ status: "error", code: limit ? "limit" : "provider_error", ...base, message: errors.map((e) => e.message).join(" · "), errors }, limit ? 429 : 502];
    }
    return [{ status: "success", ...base, subtitles: r.subtitles, ...(errors.length ? { errors } : {}) }, 200];
  } catch (e) {
    return [{ status: "error", code: e.code || "server_error", message: String(e.message || e) }, e.status || 500];
  }
}

/** /subtitleProviders: the providers that are on (usable = has a key or needs none) and the default ("auto" = all of them). */
export async function publicProviders(env) {
  const st = await state(env);
  return {
    status: "success", default: st.def === "all" ? "auto" : st.def,
    providers: st.list.filter((s) => s.on).map((s) => ({ id: s.p.id, name: s.p.name, usable: usable(s), kinds: s.p.kinds, ...(s.p.id === "jimaku" ? { langs: ["ja"] } : {}) }))
  };
}

// ------------------------------------------------------------------ download
/** A token from a search -> { text (UTF-8), name, provider, cached }. */
export async function downloadToken(env, token, opts = {}) {
  const t = readToken(token);
  if (!t || !byId[t.provider]) throw Object.assign(new Error("Unknown subtitle"), { status: 400 });
  const log = usageLog();
  const ck = "d:" + token;
  if (!opts.fresh) {
    const hit = await cacheGet(env, ck);
    if (hit) { const i = hit.indexOf("\n"); log.add("cache", 0, "downloads"); await log.flush(env); return { name: hit.slice(0, i), text: hit.slice(i + 1), provider: t.provider, cached: true }; }
  }
  const st = await state(env);
  const s = st.list.find((x) => x.p.id === t.provider);
  const q = { season: t.season, episode: t.episode };
  try {
    const file = await withKeys(env, s, "downloads", log, (ctx) => s.p.download(t.ref, ctx, q));
    const text = toText(file.bytes);
    // SRT / VTT have "-->", ASS / SSA "Dialogue:", MicroDVD "{123}{456}"; anything else (a link, a web page) is refused
    if (!/-->|^Dialogue:|^\{\d+\}\{\d+\}/m.test(text)) throw new Error("The provider sent a file that is not a subtitle");
    const name = String(file.name || "subtitle.srt").replace(/[\r\n]/g, " ");
    await cachePut(env, ck, name + "\n" + text, TTL_FILE);
    return { text, name, provider: t.provider, cached: false };
  } finally { await log.flush(env); }
}

// ------------------------------------------------------------------ admin API
async function testKey(env, provider, key) {
  const p = byId[provider]; if (!p) return { ok: 0, note: "Unknown provider" };
  if (p.needsKey && !key) return { ok: 0, note: "Enter the key" };
  try { return await withTimeout(p.test({ key, env, get: getter(12000) }), 15000, p.name); }
  catch (e) { return { ok: 0, note: String(e.message || e).slice(0, 200) }; }
}

/** Usage buckets for a chart. range: 24h (hours) | 7d | 30d (days). who: "all" | "key:<id>" | "provider:<id>" | "cache". */
async function usage(env, range, who) {
  const hours = range === "24h" ? 24 : range === "7d" ? 168 : 720;
  const now = Math.floor(Date.now() / 3600000);
  const from = now - hours + 1;
  let where = "hour >= ?", args = [from];
  if (/^key:\d+$/.test(who)) { where += " AND key_id = ?"; args.push(+who.slice(4)); }
  else if (/^provider:[a-z0-9_-]+$/.test(who)) { where += " AND provider = ?"; args.push(who.slice(9)); }
  else if (who === "cache") { where += " AND provider = 'cache'"; }
  else where += " AND provider != 'cache'";
  const rows = (await env.DB.prepare(`SELECT hour, SUM(searches) s, SUM(downloads) d, SUM(errors) e FROM subtitle_usage WHERE ${where} GROUP BY hour`).bind(...args).all()).results;
  const byHour = new Map(rows.map((r) => [r.hour, r]));
  const buckets = [];
  if (range === "24h") {
    for (let h = from; h <= now; h++) { const r = byHour.get(h) || {}; buckets.push({ t: h * 3600, searches: r.s || 0, downloads: r.d || 0, errors: r.e || 0 }); }
  } else {
    // days in UTC
    const days = range === "7d" ? 7 : 30;
    const today = Math.floor(now / 24);
    for (let d = today - days + 1; d <= today; d++) buckets.push({ t: d * 86400, searches: 0, downloads: 0, errors: 0 });
    for (const r of rows) { const b = buckets[Math.floor(r.hour / 24) - (today - days + 1)]; if (b) { b.searches += r.s || 0; b.downloads += r.d || 0; b.errors += r.e || 0; } }
  }
  const sum = (k) => buckets.reduce((n, b) => n + b[k], 0);
  return { range, who, buckets, total: { searches: sum("searches"), downloads: sum("downloads"), errors: sum("errors") } };
}

/** /api/subtitles..., /api/subtitle-keys..., /api/subtitles-test (signed-in admins only). */
export async function subtitlesApi(env, m, parts, request, bad) {
  const [res, id, action] = parts;
  const url = new URL(request.url);
  const body = async () => { try { return await request.json(); } catch (e) { return {}; } };
  const saveTest = (kid, t) => env.DB.prepare("UPDATE subtitle_keys SET test_ok = ?, test_note = ?, tested = unixepoch() WHERE id = ?").bind(t.ok, t.note, kid).run();
  const done = (x) => { resetState(); return json(x); };
  const setPrefs = async (fn) => {
    const st = await state(env); const prefs = fn({ ...st.prefs });
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('subtitle_providers', ?)").bind(JSON.stringify(prefs)).run();
  };

  if (res === "subtitles-test" && m === "POST") {
    const b = await body();
    if (b.download) {
      const t0 = Date.now();
      try { const f = await downloadToken(env, b.download, { fresh: !!b.fresh }); resetState(); return json({ ok: true, ms: Date.now() - t0, cached: f.cached, name: f.name, chars: f.text.length, lines: (f.text.match(/-->/g) || []).length, preview: f.text.slice(0, 1500) }); }
      catch (e) { return json({ ok: false, ms: Date.now() - t0, error: String(e.message || e) }); }
    }
    const movie = b.type === "series"
      ? { name: str(b.name), series_name: str(b.name), season: num(b.season, 1), episode_num: num(b.episode, 1), series_tmdb_id: str(b.tmdb_id), imdb_id: str(b.imdb_id) }
      : { name: str(b.name), year: str(b.year), tmdb_id: str(b.tmdb_id), imdb_id: str(b.imdb_id) };
    const t0 = Date.now();
    try {
      const r = await searchDetailed(env, movie, b.type === "series" ? "series" : "movie", b.languages || "ar,en", str(b.provider), { fresh: !!b.fresh });
      resetState();
      return json({ ...r, ms: Date.now() - t0 });
    } catch (e) { return json({ error: String(e.message || e), ms: Date.now() - t0 }); }
  }

  if (res === "subtitles") {
    if (m === "GET" && !id) {
      const st = await state(env);
      const day = Math.floor(Date.now() / 3600000);
      const sums = (await env.DB.prepare(`SELECT provider, key_id,
          SUM(CASE WHEN hour > ?1 - 24 THEN searches + downloads ELSE 0 END) d1, SUM(CASE WHEN hour > ?1 - 168 THEN searches + downloads ELSE 0 END) d7,
          SUM(searches + downloads) d30, SUM(CASE WHEN hour > ?1 - 24 THEN errors ELSE 0 END) e1
        FROM subtitle_usage WHERE hour > ?1 - 720 GROUP BY provider, key_id`).bind(day).all()).results;
      const cacheStats = await env.DB.prepare("SELECT COUNT(*) n, COALESCE(SUM(LENGTH(v)), 0) bytes, SUM(k LIKE 's:%') searches, SUM(k LIKE 'd:%') files FROM subtitle_cache WHERE expires > unixepoch()").first();
      const u = (p, k) => sums.filter((r) => r.provider === p && (k === undefined || r.key_id === k)).reduce((a, r) => ({ d1: a.d1 + r.d1, d7: a.d7 + r.d7, d30: a.d30 + r.d30, e1: a.e1 + r.e1 }), { d1: 0, d7: 0, d30: 0, e1: 0 });
      return json({
        default: st.def,
        providers: st.list.map((s) => ({ id: s.p.id, name: s.p.name, site: s.p.site, needsKey: s.p.needsKey, kinds: s.p.kinds, on: s.on, ord: s.ord, keys: s.keys.length, liveKeys: s.liveKeys.length, usable: usable(s), usage: u(s.p.id) })),
        keys: st.keys.map((k) => ({ ...k, usage: u(k.provider, k.id) })),
        cache: { ...cacheStats, hits: u("cache") }
      });
    }
    if (id === "usage" && m === "GET") return json(await usage(env, url.searchParams.get("range") || "7d", url.searchParams.get("who") || "all"));
    if (id === "default" && m === "PUT") {                                  // { provider: "all" | id }
      const b = await body(); const v = str(b.provider);
      if (v !== "all" && !byId[v]) bad("Unknown provider");
      await setPrefs((p) => ({ ...p, _default: v }));
      return done({ ok: true });
    }
    if (id === "cache" && m === "DELETE") {
      const r = await env.DB.prepare("DELETE FROM subtitle_cache").run();
      return done({ ok: true, deleted: r.meta.changes });
    }
    if (id === "providers" && action && m === "PUT") {                      // /api/subtitles/providers/<id> { on, ord }
      if (!byId[action]) bad("Unknown provider", 404);
      const b = await body(); const st = await state(env);
      await setPrefs((p) => ({ ...p, [action]: { on: b.on !== false, ord: num(b.ord, st.list.findIndex((s) => s.p.id === action)) } }));
      return done({ ok: true });
    }
    if (id === "providers" && action && m === "POST") {                     // /api/subtitles/providers/<id> = test (first key that is on)
      const st = await state(env); const s = st.list.find((x) => x.p.id === action); if (!s) bad("Unknown provider", 404);
      const k = s.liveKeys[0];
      if (s.p.needsKey && !k) return json({ ok: 0, note: "No key yet: add one below" });
      const t = await testKey(env, action, k ? k.key : ""); if (k) await saveTest(k.id, t);
      return done(t);
    }
  }

  if (res === "subtitle-keys") {
    const clean = (b) => {
      const provider = str(b.provider); if (!byId[provider] || !byId[provider].needsKey) bad("Choose a provider that uses a key");
      const key = str(b.key).trim(); if (!key) bad("Enter the key");
      return { provider, key: key.slice(0, 300), label: str(b.label).trim().slice(0, 60), note: str(b.note).trim().slice(0, 200), enabled: b.enabled === false ? 0 : 1, ord: num(b.ord, 0) };
    };
    if (m === "POST" && id === "test") { const b = await body(); return json(await testKey(env, str(b.provider), str(b.key).trim())); }
    if (m === "POST" && id === "test-all") {
      const keys = (await env.DB.prepare("SELECT * FROM subtitle_keys").all()).results;
      const out = await Promise.all(keys.map(async (k) => ({ id: k.id, ...(await testKey(env, k.provider, k.key)) })));
      await Promise.all(out.map((t) => saveTest(t.id, t)));
      return done(out);
    }
    if (m === "POST" && id && action === "test") {
      const k = await env.DB.prepare("SELECT * FROM subtitle_keys WHERE id = ?").bind(num(id)).first(); if (!k) bad("Not found", 404);
      const t = await testKey(env, k.provider, k.key); await saveTest(k.id, t);
      return done({ id: k.id, ...t });
    }
    if (m === "POST" && !id) {
      const k = clean(await body());
      const ord = k.ord || num(await env.DB.prepare("SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM subtitle_keys").first("n"), 0);
      const r = await env.DB.prepare("INSERT INTO subtitle_keys (provider, label, key, note, enabled, ord) VALUES (?, ?, ?, ?, ?, ?) RETURNING id").bind(k.provider, k.label, k.key, k.note, k.enabled, ord).first();
      return done({ ok: true, id: r.id });
    }
    if (m === "PUT" && id) {
      const k = clean(await body());
      await env.DB.prepare("UPDATE subtitle_keys SET provider = ?, label = ?, key = ?, note = ?, enabled = ?, ord = ? WHERE id = ?").bind(k.provider, k.label, k.key, k.note, k.enabled, k.ord, num(id)).run();
      return done({ ok: true });
    }
    if (m === "DELETE" && id) { await env.DB.batch([env.DB.prepare("DELETE FROM subtitle_keys WHERE id = ?").bind(num(id)), env.DB.prepare("DELETE FROM subtitle_usage WHERE key_id = ?").bind(num(id))]); return done({ ok: true }); }
  }
  bad("Not found", 404);
}
