// The scraper run, in the admin page: sites -> match list (LIST template) -> match page (PLAYER template) -> servers ->
// .m3u8 (iframes followed, document.write decoded) -> stream check -> saved per site by the Worker
// (/api/scrapers/<id>/save replaces the site's category). Add new kinds of sites in templates.js, not here.
import { makeNet } from "./net.js";
import { checkStream } from "./check.js";
import { LISTS, listFor, playerFor, player } from "./templates.js";
import { readable, M3U8_RE, iframes, abs, hostOf, unamp } from "./util.js";

const MAX_DEPTH = 3;          // iframes followed from a server page
const WORKERS = 6;            // matches read at the same time
const SKIP_EMBED = ["youtube.com", "youtu.be", "tawk.to", "facebook.com"];

async function pool(items, n, fn, stop) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length && !stop()) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/**
 * sites: [{ id, url, category, tomorrow, yesterday }]
 * o: { proxy, api, token, list_id, log(text, cls), stop() -> bool, save(siteId, { list_id, items, note }) -> Promise }
 * -> { total, saved }
 */
export async function runSites(sites, o) {
  const net = makeNet(o);
  const log = o.log, stop = o.stop || (() => false);
  const checks = new Map();                                       // the same stream is checked once per run
  const checkOnce = (u) => { if (!checks.has(u)) checks.set(u, checkStream(net, u)); return checks.get(u); };

  async function findM3u8(url, referer, depth, seen, first) {
    if (stop() || seen.has(url) || depth > MAX_DEPTH) return null;
    seen.add(url);
    if (/\.m3u8/i.test(url.split("?")[0])) return url;
    const page = await net.text(url, referer, log);
    if (!page) return null;
    const text = readable(page);
    const m = text.match(M3U8_RE);
    if (m) return unamp(m[0]);
    for (const s of iframes(text)) {
      const src = abs(s, url);
      if (!src || SKIP_EMBED.some((h) => hostOf(src).includes(h))) continue;
      if (depth === 0 && !first.src) first.src = src;
      const r = await findM3u8(src, url, depth + 1, seen, first);
      if (r) return r;
    }
    return null;
  }

  /** A player template's answer -> [{ n, url }] found streams (template steps followed). */
  async function serversOf(tpl, res, m) {
    for (let hops = 0; res && res.next && hops < 5 && !stop(); hops++) {
      const page = await net.text(res.next.url, res.next.ref, log);
      const fn = tpl.steps && tpl.steps[res.next.step];
      res = fn ? fn(page, res.next) : null;
    }
    const list = (res && res.servers) || [];
    if (!list.length) log(`    ${m.teams}: no servers on the match page`, "dim");
    const out = [];
    for (const [i, s] of list.entries()) {
      if (stop()) break;
      const n = s.n || i + 1, first = {};
      const u = await findM3u8(s.url, s.ref || m.link, 0, new Set(), first);
      if (u) out.push({ n, url: u });
      else log(`    ${m.teams} serv${n}: no stream found in ${(first.src || s.url).slice(0, 90)}`, "dim");
    }
    return out;
  }

  let total = 0, saved = 0;
  for (const sc of sites) {
    if (stop()) break;
    const site = sc.url, host = hostOf(site);
    log(`== ${host} -> category "${sc.category}" in list "${o.list_id}"`, "acc");
    const todo = []; let answered = false;
    for (const d of LISTS[0].days(site, sc)) {
      if (stop()) break;
      const page = await net.text(d.url, "", log);
      if (page && d.today) answered = true;
      const ms = page ? listFor(page).parse(page) : [];
      log(`${d.url}: ${ms.length} matches`, ms.length ? "" : "bad");
      for (const m of ms) {
        if (m.finished) { log(`- ${m.teams}: finished, skipped`, "dim"); continue; }
        const link = m.link && !m.link.endsWith("#") ? abs(m.link, site) : "";
        let root = !link;
        if (!root) { const u = new URL(link); root = u.host.toLowerCase() === host && u.pathname === "/"; }
        if (root) { log(`- ${m.teams} (${m.time}, ${m.status}): no stream page yet`, "dim"); continue; }
        todo.push({ ...m, link });
      }
    }
    if (stop()) { log("Stopped: nothing saved for " + host, "bad"); break; }
    if (!answered) { log(`${host} did not answer: its category was kept as it was`, "bad"); continue; }

    const results = await pool(todo, WORKERS, async (m) => {
      const page = await net.text(m.link, site, log);
      const tpl = playerFor(page, m.link);
      log(`> ${m.teams}  [${m.channel}]  (${tpl.id})`);
      const items = [];
      for (const s of await serversOf(tpl, tpl.servers(page, m.link), m)) {
        const [ok, why] = await checkOnce(s.url);
        log(`    ${m.teams} serv${s.n}: ${ok ? "OK  " : "BAD "}${why}  ${s.url.slice(0, 90)}`, ok ? "ok" : "bad");
        if (ok) items.push(s);
      }
      return { m, items };
    }, stop);
    if (stop()) { log("Stopped: nothing saved for " + host, "bad"); break; }

    const items = [];
    for (const { m, items: its } of results) {
      const seen = new Set();
      for (const s of its.sort((a, b) => a.n - b.n)) {
        if (seen.has(s.url)) continue; seen.add(s.url);
        items.push({ name: (m.time ? m.time + " " : "") + m.teams + " serv" + s.n, url: s.url });
      }
    }
    const note = `${todo.length} matches with a page, ${items.length} working streams`;
    await o.save(sc.id, { list_id: o.list_id, items, note });
    log(`Saved ${host}: ${note} (category "${sc.category}" replaced)`, "ok");
    total += items.length; saved++;
  }
  log(stop() ? "Stopped." : `Done: ${total} working streams from ${saved} of ${sites.length} site(s) · ${net.count} requests`, stop() ? "bad" : "ok");
  return { total, saved, requests: net.count };
}
