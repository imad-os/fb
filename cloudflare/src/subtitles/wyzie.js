// Wyzie Subs (sub.wyzie.io) - free API key: sub.wyzie.io/redeem (email check). Free: 1,000 requests a day;
// a search costs 1 request per source asked, a download 1. It gathers several subtitle sites (4 on the free plan).
import { lang2, readJson, pickSubtitle } from "./common.js";

const API = "https://sub.wyzie.io";
const FREE_SOURCES = "charlie,oscar,quebec,xray";

export default {
  id: "wyzie", name: "Wyzie Subs", site: "https://sub.wyzie.io/redeem", needsKey: true, kinds: ["movie", "series"],

  async search(q, ctx) {
    const id = q.imdb || q.tmdb;
    if (!id) return [];                                      // Wyzie needs an IMDb or TMDB id
    const p = new URLSearchParams({ id, language: q.langs.join(","), format: "srt,vtt,ass,ssa", source: FREE_SOURCES, key: ctx.key });
    if (q.type === "series") { if (!q.season || !q.episode) return []; p.set("season", q.season); p.set("episode", q.episode); }
    const d = await readJson(await ctx.get(`${API}/search?${p}`), "Wyzie");
    return (Array.isArray(d) ? d : d.data || []).filter((s) => s.url).map((s) => ({
      ref: s.url, name: s.release || s.fileName || s.media || s.display, lang: lang2(s.language || s.display), release: s.release || "",
      hi: !!s.isHearingImpaired, by: s.source || ""
    }));
  },

  async download(ref, ctx, q) {
    let u; try { u = new URL(ref); } catch (e) { throw new Error("Bad id"); }
    if (!/(^|\.)wyzie\.(io|ru)$/.test(u.hostname)) throw new Error("Bad id");
    if (!u.searchParams.has("key") && ctx.key) u.searchParams.set("key", ctx.key);
    const r = await ctx.get(u.toString());
    if (!r.ok) throw new Error(`Wyzie download: HTTP ${r.status}`);
    return pickSubtitle(new Uint8Array(await r.arrayBuffer()), "wyzie.srt", q);
  },

  async test(ctx) {
    const d = await readJson(await ctx.get(`${API}/search?${new URLSearchParams({ id: "tt1375666", language: "ar", key: ctx.key })}`), "Wyzie");
    const n = (Array.isArray(d) ? d : d.data || []).length;
    return { ok: 1, note: `Key works · ${n} Arabic subtitles for Inception` };
  }
};
