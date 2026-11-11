// Football API keys: stored in D1 (table football_keys), managed from the admin page.
// The football endpoints read the keys that are on; the FOOTBALL_KEYS secret is only used while the table is empty.
import { json, str, num } from "./util.js";

const CACHE_MS = 30 * 1000;   // per Worker instance; admin changes reach every instance within 30 s
let cache = { at: 0, apis: null };

/** The keys to use, in order: [{ id, url, host, key }]. */
export async function footballApis(env) {
  if (cache.apis && Date.now() - cache.at < CACHE_MS) return cache.apis;
  let apis = [];
  let tableHasRows = false;
  try {
    const r = await env.DB.prepare("SELECT id, url, host, key, enabled FROM football_keys ORDER BY ord, id").all();
    tableHasRows = r.results.length > 0;
    apis = r.results.filter((k) => k.enabled).map(({ id, url, host, key }) => ({ id, url, host, key }));
  } catch (e) { console.error("football_keys:", e.message); }
  if (!tableHasRows) {
    try { const a = JSON.parse(env.FOOTBALL_KEYS || "[]"); if (Array.isArray(a)) apis = a; } catch (e) {}
  }
  cache = { at: Date.now(), apis };
  return apis;
}

/** Counts a call on a key (best effort: a failure here never fails the answer). */
export async function noteUse(env, api) {
  if (!api || !api.id) return;
  await env.DB.prepare("UPDATE football_keys SET used = used + 1, last_used = unixepoch() WHERE id = ?").bind(api.id).run().catch(() => {});
}

/** Calls /status of the provider with this key: plan, requests today / limit, or the error. */
export async function testKey(k) {
  const url = str(k.url).replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+(\/\S*)?$/.test(url)) return { ok: 0, note: "Wrong address" };
  try {
    const r = await fetch(url + "/status", {
      headers: { "x-rapidapi-host": str(k.host), "x-rapidapi-key": str(k.key), "x-apisports-key": str(k.key) },
      signal: AbortSignal.timeout(10000)
    });
    let d = null; try { d = await r.json(); } catch (e) {}
    // RapidAPI checks the key first and has no /status: "does not exist" = key and subscription accepted.
    // Its quota comes in headers.
    const lim = r.headers.get("x-ratelimit-requests-limit"), rem = r.headers.get("x-ratelimit-requests-remaining");
    const quota = lim ? ` · ${num(lim) - num(rem)} / ${lim} requests used` : "";
    if (r.status === 404 && d && /does not exist/i.test(str(d.message))) {
      const full = lim && num(rem) <= 0;
      return { ok: full ? 0 : 1, note: (full ? "Limit reached" : "Key accepted (RapidAPI)") + quota };
    }
    if (!r.ok) return { ok: 0, note: `HTTP ${r.status}${d && d.message ? ": " + d.message : ""}` };
    if (!d) return { ok: 0, note: "Not a JSON answer" };
    const errs = d.errors && (Array.isArray(d.errors) ? d.errors : Object.values(d.errors));
    if (errs && errs.length) return { ok: 0, note: String(errs[0]).slice(0, 200) };
    const resp = Array.isArray(d.response) ? d.response[0] : d.response;
    if (!resp) return { ok: 1, note: "Key accepted" };
    const sub = resp.subscription || {}; const req = resp.requests || {};
    const parts = [];
    if (sub.plan) parts.push(sub.plan + (sub.active === false ? " (inactive)" : ""));
    if (req.limit_day !== undefined) parts.push(`${req.current ?? "?"} / ${req.limit_day} requests today`);
    if (sub.end) parts.push("ends " + String(sub.end).slice(0, 10));
    const full = req.limit_day !== undefined && num(req.current) >= num(req.limit_day);
    return { ok: sub.active === false || full ? 0 : 1, note: (full ? "Daily limit reached · " : "") + (parts.join(" · ") || "Key accepted") };
  } catch (e) {
    return { ok: 0, note: e.name === "TimeoutError" ? "No answer in 10 s" : "Cannot reach " + url };
  }
}

const clean = (b) => {
  const url = str(b.url).trim().replace(/\/+$/, "");
  const host = str(b.host).trim() || (() => { try { return new URL(url).hostname; } catch (e) { return ""; } })();
  return { label: str(b.label).trim().slice(0, 60), url, host: host.slice(0, 200), key: str(b.key).trim().slice(0, 200), note: str(b.note).trim().slice(0, 200), enabled: b.enabled === false ? 0 : 1, ord: num(b.ord, 0) };
};

/** /api/football-keys[/<id>[/test]] and /api/football-keys/test (unsaved key). */
export async function footballKeysApi(env, m, id, action, request, bad) {
  const body = async () => { try { return await request.json(); } catch (e) { return {}; } };
  const all = async () => (await env.DB.prepare("SELECT * FROM football_keys ORDER BY ord, id").all()).results;
  const save = (kid, t) => env.DB.prepare("UPDATE football_keys SET test_ok = ?, test_note = ?, tested = unixepoch() WHERE id = ?").bind(t.ok, t.note, kid).run();
  const done = (x) => { cache.at = 0; return x; };

  if (m === "GET" && !id) {
    const keys = await all();
    let fallback = 0;
    if (!keys.length) { try { fallback = JSON.parse(env.FOOTBALL_KEYS || "[]").length; } catch (e) {} }
    return json({ keys, fallback });
  }
  if (m === "POST" && id === "test") return json(await testKey(clean(await body())));          // unsaved key from the dialog
  if (m === "POST" && id === "test-all") {
    const keys = await all();
    const res = await Promise.all(keys.map(async (k) => ({ id: k.id, ...(await testKey(k)) })));
    await Promise.all(res.map((t) => save(t.id, t)));
    return json(res);
  }
  if (m === "POST" && id === "import-secret") {                                               // one-time copy of FOOTBALL_KEYS
    if ((await all()).length) bad("There are keys already");
    let a = []; try { a = JSON.parse(env.FOOTBALL_KEYS || "[]"); } catch (e) {}
    const rows = (Array.isArray(a) ? a : []).map(clean).filter((k) => k.url && k.key);
    if (rows.length) await env.DB.batch(rows.map((k, i) => env.DB.prepare("INSERT INTO football_keys (label, url, host, key, ord) VALUES (?, ?, ?, ?, ?)").bind(`Key ${i + 1}`, k.url, k.host, k.key, i)));
    return done(json({ added: rows.length }));
  }
  if (m === "POST" && id && action === "test") {
    const k = await env.DB.prepare("SELECT * FROM football_keys WHERE id = ?").bind(num(id)).first();
    if (!k) bad("Not found", 404);
    const t = await testKey(k); await save(k.id, t);
    return json({ id: k.id, ...t });
  }
  if (m === "POST" && !id) {
    const k = clean(await body());
    if (!k.url || !k.key) bad("Enter the address and the key");
    const ord = k.ord || num(await env.DB.prepare("SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM football_keys").first("n"), 0);
    const r = await env.DB.prepare("INSERT INTO football_keys (label, url, host, key, note, enabled, ord) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(k.label, k.url, k.host, k.key, k.note, k.enabled, ord).first();
    return done(json({ ok: true, id: r.id }));
  }
  if (m === "PUT" && id) {
    const k = clean(await body());
    if (!k.url || !k.key) bad("Enter the address and the key");
    await env.DB.prepare("UPDATE football_keys SET label = ?, url = ?, host = ?, key = ?, note = ?, enabled = ?, ord = ? WHERE id = ?")
      .bind(k.label, k.url, k.host, k.key, k.note, k.enabled, k.ord, num(id)).run();
    return done(json({ ok: true }));
  }
  if (m === "DELETE" && id) {
    await env.DB.prepare("DELETE FROM football_keys WHERE id = ?").bind(num(id)).run();
    return done(json({ ok: true }));
  }
  bad("Not found", 404);
}
