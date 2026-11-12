// Match-site scrapers (admin page > Scrapers): the sites (D1 table scrapers) and saving a run's streams.
// The runs themselves happen in the admin page (cloudflare/admin/scraper/: one file per site template), which reads the
// sites through /api/fetch below (or the admin's own proxy) and sends the streams that work to /api/scrapers/<id>/save.
import { json, str, num, now } from "./util.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15000;

const MAX_ITEMS = 1000;

/** "yalla.golf/" or "https://yalla.golf" -> "https://yalla.golf/" (origin + path ending in /), or "". */
export function normSite(s) {
  s = str(s).trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.origin + u.pathname.replace(/\/*$/, "/");
  } catch (e) { return ""; }
}

export const catName = (sc) => str(sc.name).trim() || new URL(sc.url).host;

function row(r) {
  return { ...r, tomorrow: !!r.tomorrow, yesterday: !!r.yesterday, enabled: !!r.enabled, category: catName(r) };
}

/** /api/scrapers[/<id>] */
export async function scrapersApi(env, m, parts, request, bad) {
  const id = parts[1] ? num(parts[1]) : 0;
  const body = async () => { try { return await request.json(); } catch (e) { return {}; } };

  if (parts[2] === "save" && m === "POST" && id) {
    const sc = await env.DB.prepare("SELECT * FROM scrapers WHERE id = ?").bind(id).first();
    if (!sc) bad("Not found", 404);
    const b = await body();
    if (!(await env.DB.prepare("SELECT 1 FROM lists WHERE id = ?").bind(str(b.list_id)).first())) bad("Unknown list");
    const added = await saveSite(env, sc, str(b.list_id), Array.isArray(b.items) ? b.items : [], str(b.note) || "");
    return json({ ok: true, added, category: added ? catName(sc) : "" });
  }
  if (m === "GET" && !id) {
    const r = await env.DB.prepare("SELECT * FROM scrapers ORDER BY id").all();
    return json(r.results.map(row));
  }

  if ((m === "POST" && !id) || (m === "PUT" && id)) {
    const b = await body();
    const url = normSite(b.url);
    if (!url) bad("Enter the site's address, like https://yalla.golf/");
    const d = [url, str(b.name).trim().slice(0, 100), b.tomorrow ? 1 : 0, b.yesterday ? 1 : 0, b.enabled === false ? 0 : 1, str(b.note).slice(0, 200)];
    try {
      if (m === "POST") {
        const r = await env.DB.prepare("INSERT INTO scrapers (url, name, tomorrow, yesterday, enabled, note) VALUES (?, ?, ?, ?, ?, ?) RETURNING *").bind(...d).first();
        return json(row(r));
      }
      await env.DB.prepare("UPDATE scrapers SET url = ?, name = ?, tomorrow = ?, yesterday = ?, enabled = ?, note = ? WHERE id = ?").bind(...d, id).run();
      return json(row(await env.DB.prepare("SELECT * FROM scrapers WHERE id = ?").bind(id).first()));
    } catch (e) {
      if (/UNIQUE/.test(e.message)) bad("This site is already in the list", 409);
      throw e;
    }
  }
  if (m === "DELETE" && id) {
    const sc = await env.DB.prepare("SELECT * FROM scrapers WHERE id = ?").bind(id).first();
    if (!sc) bad("Not found", 404);
    const stmts = [env.DB.prepare("DELETE FROM scrapers WHERE id = ?").bind(id)];
    // ?streams=1: also remove what its last run wrote
    if (new URL(request.url).searchParams.get("streams") === "1" && sc.last_list && sc.last_cat) stmts.unshift(...clearCat(env, sc.last_list, [sc.last_cat]));
    await env.DB.batch(stmts);
    return json({ ok: true });
  }
  bad("Not found", 404);
}

/** Statements that delete the live categories with these names in the list, and their streams. */
function clearCat(env, list, names) {
  const n = JSON.stringify([...new Set(names.filter(Boolean))]);
  return [
    env.DB.prepare(`DELETE FROM streams WHERE list_id = ?1 AND type = 'live' AND category_id IN
      (SELECT id FROM categories WHERE list_id = ?1 AND type = 'live' AND name IN (SELECT value FROM json_each(?2)))`).bind(list, n),
    env.DB.prepare("DELETE FROM categories WHERE list_id = ?1 AND type = 'live' AND name IN (SELECT value FROM json_each(?2))").bind(list, n),
    env.DB.prepare("UPDATE lists SET rev = rev + 1, updated = unixepoch() WHERE id = ?").bind(list)
  ];
}

/** Replaces the scraper's category in the list by these streams ([{ name, url }]); used by scraper/job.js. */
export async function saveSite(env, sc, list, items0, note) {
  const cat = catName(sc);
  const seen = new Set();
  const items = (items0 || []).map((i) => ({ name: str(i.name).trim().slice(0, 200) || "Match", url: str(i.url).trim() }))
    .filter((i) => /^https?:\/\/\S+$/i.test(i.url) && !seen.has(i.url) && seen.add(i.url)).slice(0, MAX_ITEMS);
  if (!(await env.DB.prepare("SELECT 1 FROM lists WHERE id = ?").bind(list).first())) throw new Error("Unknown list " + list);
  const stmts = clearCat(env, list, [cat, sc.last_list === list ? sc.last_cat : ""]);
  if (sc.last_list && sc.last_list !== list && sc.last_cat) stmts.push(...clearCat(env, sc.last_list, [sc.last_cat]));
  if (items.length) {
    const base = num(await env.DB.prepare("SELECT MAX(num) AS n FROM streams WHERE list_id = ?").bind(list).first("n"), 0);
    stmts.push(
      env.DB.prepare("INSERT INTO categories (list_id, type, name) VALUES (?, 'live', ?)").bind(list, cat),
      env.DB.prepare(`INSERT INTO streams (list_id, type, name, source, ext, num, category_id)
        SELECT ?1, 'live', json_extract(value, '$.name'), json_extract(value, '$.url'), '', ?3 + key + 1,
          (SELECT MAX(id) FROM categories WHERE list_id = ?1 AND type = 'live' AND name = ?4)
        FROM json_each(?2)`).bind(list, JSON.stringify(items), base, cat)
    );
  }
  stmts.push(env.DB.prepare("UPDATE scrapers SET last_run = unixepoch(), last_list = ?, last_cat = ?, last_count = ?, last_note = ? WHERE id = ?")
    .bind(list, items.length ? cat : "", items.length, str(note).slice(0, 300), sc.id));
  await env.DB.batch(stmts);
  return items.length;
}

// ---- schedule settings (settings row "scrape"): { on, times: ["17:00", ...], proxy, list_id }.
// The admin page runs all the sites that are on at these times (its own clock) while it is open.
// /api/scrape-claim { slot: "2026-11-12 17:00" } -> { ok } true only for the first page that asks, so two open pages
// (or two computers) do not run the same time twice.
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
export async function scrapeSettingsApi(env, m, res, request, bad) {
  let b = {}; try { b = await request.json(); } catch (e) {}
  if (res === "scrape-claim" && m === "POST") {
    const slot = str(b.slot);
    if (!/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(slot)) bad("Wrong slot");
    const r = await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind("scrape_slot:" + slot, String(now())).run();
    const old = new Date(Date.parse(slot.slice(0, 10)) - 3 * 86400000).toISOString().slice(0, 10);
    await env.DB.prepare("DELETE FROM settings WHERE key LIKE 'scrape_slot:%' AND key < ?").bind("scrape_slot:" + old).run();
    return json({ ok: r.meta.changes === 1 });
  }
  if (m === "GET") {
    let v = {}; try { v = JSON.parse(await env.DB.prepare("SELECT value FROM settings WHERE key = 'scrape'").first("value") || "{}"); } catch (e) {}
    return json({ on: true, times: [], proxy: "", list_id: "default", ...v });
  }
  if (m === "PUT") {
    const times = [...new Set((Array.isArray(b.times) ? b.times : []).map((t) => {
      const x = TIME_RE.exec(str(t).trim()); if (!x) bad("Times look like 17:00 or 19:30"); return x[1].padStart(2, "0") + ":" + x[2];
    }))].sort().slice(0, 48);
    const proxy = str(b.proxy).trim();
    if (proxy && !/^https?:\/\/\S+$/i.test(proxy)) bad("The proxy is an address like http://127.0.0.1:11436/");
    const list = str(b.list_id);
    if (!(await env.DB.prepare("SELECT 1 FROM lists WHERE id = ?").bind(list).first())) bad("Choose the list");
    const s = { on: b.on !== false, times, proxy, list_id: list };
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('scrape', ?)").bind(JSON.stringify(s)).run();
    return json(s);
  }
  bad("Not found", 404);
}

/**
 * GET /api/fetch?url=&referer=&range=  (admins only): one request to a match site, from Cloudflare,
 * so the admin page can read sites that send no CORS headers. Same shape as a scraper proxy:
 * the upstream status and body, the address after redirects in x-final-url.
 */
export async function proxyFetch(url, bad) {
  const target = str(url.searchParams.get("url"));
  let u;
  try { u = new URL(target); } catch (e) { bad("Wrong address"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") bad("Only http and https");
  const headers = { "User-Agent": UA, Accept: "*/*", "Accept-Language": "en,ar;q=0.8,fr;q=0.6" };
  const referer = str(url.searchParams.get("referer"));
  if (/^https?:\/\//i.test(referer)) { headers.Referer = referer; try { headers.Origin = new URL(referer).origin; } catch (e) {} }
  const range = str(url.searchParams.get("range"));
  if (/^bytes=\d+-\d*$/.test(range)) headers.Range = range;
  let r;
  try {
    r = await fetch(u.toString(), { headers, redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    return json({ error: "No answer from " + u.host }, 502, { "x-proxied": "1", "x-final-url": u.toString() });
  }
  const status = r.status >= 200 && r.status <= 599 ? r.status : 502;
  const out = new Headers({ "x-proxied": "1", "x-final-url": r.url || u.toString(), "Cache-Control": "no-store" });
  for (const k of ["content-type", "content-range"]) { const v = r.headers.get(k); if (v) out.set(k, v); }
  const noBody = [204, 205, 304].includes(status);
  if (noBody) { try { await r.body?.cancel(); } catch (e) {} }
  return new Response(noBody ? null : r.body, { status, headers: out });
}
