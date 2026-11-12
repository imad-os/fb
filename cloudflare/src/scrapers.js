// Match-site scrapers (admin page > Scrapers), for sites on the "Yalla Shoot" template.
// The crawl itself runs in the admin page (it can take a few hundred requests: too many for one Worker request
// on the free plan). The page reads the sites through /api/fetch below (or through the admin's own proxy),
// then sends the streams that work to /api/scrapers/<id>/save, which REPLACES the site's category in the list.
import { json, str, num } from "./util.js";

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

/** /api/scrapers[/<id>[/save]] */
export async function scrapersApi(env, m, parts, request, bad) {
  const id = parts[1] ? num(parts[1]) : 0;
  const action = parts[2] || "";
  const body = async () => { try { return await request.json(); } catch (e) { return {}; } };

  if (m === "GET" && !id) {
    const r = await env.DB.prepare("SELECT * FROM scrapers ORDER BY id").all();
    return json(r.results.map(row));
  }
  if (action === "save" && m === "POST" && id) return save(env, id, await body(), bad);

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

/** { list_id, items: [{ name, url }], note } -> the site's category in that list is replaced by these streams. */
async function save(env, id, b, bad) {
  const sc = await env.DB.prepare("SELECT * FROM scrapers WHERE id = ?").bind(id).first();
  if (!sc) bad("Not found", 404);
  const list = str(b.list_id);
  if (!(await env.DB.prepare("SELECT 1 FROM lists WHERE id = ?").bind(list).first())) bad("Unknown list");
  const cat = catName(sc);
  const seen = new Set();
  const items = (Array.isArray(b.items) ? b.items : []).map((i) => ({ name: str(i.name).trim().slice(0, 200) || "Match", url: str(i.url).trim() }))
    .filter((i) => /^https?:\/\/\S+$/i.test(i.url) && !seen.has(i.url) && seen.add(i.url)).slice(0, MAX_ITEMS);
  const note = str(b.note).slice(0, 300) || `${items.length} streams`;

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
    .bind(list, items.length ? cat : "", items.length, note, id));
  await env.DB.batch(stmts);
  return json({ ok: true, added: items.length, category: items.length ? cat : "" });
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
