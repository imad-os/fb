// SubDL (subdl.com) - free API key: account > API. About 2,000 searches and 50 downloads a day on the free plan.
// Search: api.subdl.com/api/v1/subtitles ; download: dl.subdl.com/subtitle/<id>.zip (a zip).
import { lang2, readJson, pickSubtitle } from "./common.js";

const API = "https://api.subdl.com/api/v1/subtitles";

export default {
  id: "subdl", name: "SubDL", site: "https://subdl.com/panel/api", needsKey: true, kinds: ["movie", "series"],

  async search(q, ctx) {
    const p = new URLSearchParams({ api_key: ctx.key, type: q.type === "series" ? "tv" : "movie", languages: q.langs.map((l) => l.toUpperCase()).join(","), subs_per_page: "30" });
    if (q.tmdb) p.set("tmdb_id", q.tmdb); else if (q.imdb) p.set("imdb_id", q.imdb); else p.set("film_name", q.title);
    if (q.type === "movie" && q.year && !q.tmdb && !q.imdb) p.set("year", q.year);
    if (q.type === "series" && q.season) p.set("season_number", q.season);
    if (q.type === "series" && q.episode) p.set("episode_number", q.episode);
    const d = await readJson(await ctx.get(`${API}?${p}`), "SubDL");
    if (d.status === false) throw new Error("SubDL: " + (d.error || d.message || "error"));
    return (d.subtitles || [])
      .filter((s) => !(q.episode && s.episode && s.episode !== q.episode && !s.full_season))
      .map((s) => {
        const ref = (String(s.url || "").match(/\/subtitle\/([\w-]+)\.zip/) || [])[1];
        return ref && { ref, name: s.release_name || s.name, lang: lang2(s.language || s.lang), release: s.release_name || "", hi: !!s.hi, by: s.author || "" };
      }).filter(Boolean);
  },

  async download(ref, ctx, q) {
    if (!/^[\w-]+$/.test(ref)) throw new Error("Bad id");
    const r = await ctx.get(`https://dl.subdl.com/subtitle/${ref}.zip${ctx.key ? "?api_key=" + encodeURIComponent(ctx.key) : ""}`);
    if (!r.ok) throw new Error(`SubDL download: HTTP ${r.status}`);
    return pickSubtitle(new Uint8Array(await r.arrayBuffer()), ref + ".zip", q);
  },

  async test(ctx) {
    const d = await readJson(await ctx.get(`${API}?${new URLSearchParams({ api_key: ctx.key, tmdb_id: "27205", type: "movie", languages: "AR", subs_per_page: "5" })}`), "SubDL");
    if (d.status === false) return { ok: 0, note: String(d.error || d.message || "Refused") };
    return { ok: 1, note: `Key works · ${(d.subtitles || []).length} Arabic subtitles for Inception` };
  }
};
