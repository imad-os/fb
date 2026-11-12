// Subtitles from several providers (one file each in this folder, same functions: search / download / test).
//   searchAll(env, movieData, movieType, languages) -> what /fetchSubtitles returns to players
//   downloadToken(env, token)                        -> what /downloadSubtitle returns (UTF-8 text)
//   subtitlesApi(...)                                -> the admin page's /api/subtitles*, /api/subtitle-keys*
// Keys live in D1 (subtitle_keys) and never leave the Worker: players only get tokens (sub:<provider>:<ref>).
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

// ------------------------------------------------------------------ state (D1)
const CACHE_MS = 30 * 1000;
let cache = { at: 0, v: null };
export const resetCache = () => { cache.at = 0; };

async function state(env) {
  if (cache.v && Date.now() - cache.at < CACHE_MS) return cache.v;
  let keys = [], prefs = {};
  try { keys = (await env.DB.prepare("SELECT * FROM subtitle_keys ORDER BY ord, id").all()).results; } catch (e) { console.error("subtitle_keys:", e.message); }
  try { prefs = JSON.parse((await env.DB.prepare("SELECT value FROM settings WHERE key = 'subtitle_providers'").first("value")) || "{}"); } catch (e) {}
  const list = PROVIDERS.map((p, i) => {
    const pr = prefs[p.id] || {};
    const pk = keys.filter((k) => k.provider === p.id);
    return { p, on: pr.on !== false, ord: pr.ord ?? i, keys: pk, liveKeys: pk.filter((k) => k.enabled) };
  }).sort((a, b) => a.ord - b.ord);
  cache = { at: Date.now(), v: { list, keys, prefs } };
  return cache.v;
}
const usable = (s) => s.on && (!s.p.needsKey || s.liveKeys.length);
const noteUse = (env, k) => k && k.id ? env.DB.prepare("UPDATE subtitle_keys SET used = used + 1, last_used = unixepoch() WHERE id = ?").bind(k.id).run().catch(() => {}) : null;

/** Runs fn(ctx) with the provider's keys in order; the next key only when one is refused / over its limit. */
async function withKeys(env, s, fn) {
  const get = getter();
  const keys = s.p.needsKey ? s.liveKeys : [null];
  let last;
  for (const k of keys) {
    try { const r = await fn({ key: k ? k.key : "", env, get }); await noteUse(env, k); return r; }
    catch (e) { last = e; if (!(e.status === 401 || e.status === 403 || e.status === 429)) break; }
  }
  throw last || new Error("No key");
}
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: no answer in ${ms / 1000} s`)), ms))]);

// ------------------------------------------------------------------ search / download
/** One search across every provider that is on. Returns { q, providers: [{ id, name, ok, count, ms, error }], subtitles }. */
export async function searchDetailed(env, movieData, movieType, languages, onlyProvider) {
  const q = await resolveIds(env, makeQuery(movieData, movieType, languages), getter());
  const st = await state(env);
  const active = st.list.filter((s) => onlyProvider ? s.p.id === onlyProvider : usable(s)).filter((s) => s.p.kinds.includes(q.type));
  const rank = Object.fromEntries(st.list.map((s, i) => [s.p.id, i]));
  const report = [];
  const found = [];
  await Promise.all(active.map(async (s) => {
    const t0 = Date.now();
    try {
      const subs = await withTimeout(withKeys(env, s, (ctx) => s.p.search(q, ctx)), SEARCH_BUDGET_MS, s.p.name);
      const mine = subs.filter((x) => q.langs.includes(x.lang));
      mine.forEach((x) => found.push({ ...x, provider: s.p.id }));
      report.push({ id: s.p.id, name: s.p.name, ok: true, count: mine.length, ms: Date.now() - t0 });
    } catch (e) {
      report.push({ id: s.p.id, name: s.p.name, ok: false, count: 0, ms: Date.now() - t0, error: String(e.message || e).slice(0, 300) });
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
  return { q, providers: report, subtitles };
}

/** /fetchSubtitles for players (same shape as before: { status, subtitles: [{ label, lang, url, ... }] }). */
export async function searchAll(env, movieData, movieType, languages) {
  const r = await searchDetailed(env, movieData, movieType, languages);
  return r.subtitles;
}

/** A token from a search -> { text (UTF-8), name, provider }. */
export async function downloadToken(env, token) {
  const t = readToken(token);
  if (!t || !byId[t.provider]) throw Object.assign(new Error("Unknown subtitle"), { status: 400 });
  const st = await state(env);
  const s = st.list.find((x) => x.p.id === t.provider);
  const q = { season: t.season, episode: t.episode };
  const file = await withKeys(env, s, (ctx) => s.p.download(t.ref, ctx, q));
  const text = toText(file.bytes);
  // SRT / VTT have "-->", ASS / SSA "Dialogue:", MicroDVD "{123}{456}"; anything else (a link, a web page) is refused
  if (!/-->|^Dialogue:|^\{\d+\}\{\d+\}/m.test(text)) throw new Error("The provider sent a file that is not a subtitle");
  return { text, name: file.name, provider: t.provider };
}

// ------------------------------------------------------------------ admin API
async function testKey(env, provider, key) {
  const p = byId[provider]; if (!p) return { ok: 0, note: "Unknown provider" };
  if (p.needsKey && !key) return { ok: 0, note: "Enter the key" };
  try { return await withTimeout(p.test({ key, env, get: getter(12000) }), 15000, p.name); }
  catch (e) { return { ok: 0, note: String(e.message || e).slice(0, 200) }; }
}

/** /api/subtitles..., /api/subtitle-keys..., /api/subtitles-test (signed-in admins only). */
export async function subtitlesApi(env, m, parts, request, bad) {
  const [res, id, action] = parts;
  const body = async () => { try { return await request.json(); } catch (e) { return {}; } };
  const saveTest = (kid, t) => env.DB.prepare("UPDATE subtitle_keys SET test_ok = ?, test_note = ?, tested = unixepoch() WHERE id = ?").bind(t.ok, t.note, kid).run();
  const done = (x) => { resetCache(); return json(x); };

  if (res === "subtitles-test" && m === "POST") {
    const b = await body();
    if (b.download) {
      const t0 = Date.now();
      try { const f = await downloadToken(env, b.download); resetCache(); return json({ ok: true, ms: Date.now() - t0, name: f.name, chars: f.text.length, lines: (f.text.match(/-->/g) || []).length, preview: f.text.slice(0, 1500) }); }
      catch (e) { return json({ ok: false, ms: Date.now() - t0, error: String(e.message || e) }); }
    }
    const movie = b.type === "series"
      ? { name: str(b.name), series_name: str(b.name), season: num(b.season, 1), episode_num: num(b.episode, 1), series_tmdb_id: str(b.tmdb_id), imdb_id: str(b.imdb_id) }
      : { name: str(b.name), year: str(b.year), tmdb_id: str(b.tmdb_id), imdb_id: str(b.imdb_id) };
    const t0 = Date.now();
    const r = await searchDetailed(env, movie, b.type === "series" ? "series" : "movie", b.languages || "ar,en", b.provider || "");
    resetCache();
    return json({ ...r, ms: Date.now() - t0 });
  }

  if (res === "subtitles") {
    if (m === "GET" && !id) {
      const st = await state(env);
      return json({
        providers: st.list.map((s) => ({ id: s.p.id, name: s.p.name, site: s.p.site, needsKey: s.p.needsKey, kinds: s.p.kinds, on: s.on, ord: s.ord, keys: s.keys.length, liveKeys: s.liveKeys.length, usable: usable(s) })),
        keys: st.keys
      });
    }
    if (id === "providers" && action && m === "PUT") {                      // /api/subtitles/providers/<id> { on, ord }
      if (!byId[action]) bad("Unknown provider", 404);
      const b = await body(); const st = await state(env);
      const prefs = { ...st.prefs, [action]: { on: b.on !== false, ord: num(b.ord, st.list.findIndex((s) => s.p.id === action)) } };
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('subtitle_providers', ?)").bind(JSON.stringify(prefs)).run();
      return done({ ok: true });
    }
    if (id === "providers" && action && m === "POST") {                     // /api/subtitles/providers/<id>/test (first key that is on)
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
    if (m === "DELETE" && id) { await env.DB.prepare("DELETE FROM subtitle_keys WHERE id = ?").bind(num(id)).run(); return done({ ok: true }); }
  }
  bad("Not found", 404);
}
