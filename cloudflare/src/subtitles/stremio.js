// OpenSubtitles through Stremio's public add-on (opensubtitles-v3.strem.io) - no key needed.
// Unofficial: it can change or stop at any time. Needs the IMDb id (found from TMDB by the Worker).
import { lang2, readJson, pickSubtitle } from "./common.js";

const API = "https://opensubtitles-v3.strem.io/subtitles";

export default {
  id: "stremio", name: "OpenSubtitles (Stremio, no key)", site: "https://www.opensubtitles.org", needsKey: false, kinds: ["movie", "series"],

  async search(q, ctx) {
    if (!q.imdb) return [];
    const path = q.type === "series" ? `series/${q.imdb}:${q.season || 1}:${q.episode || 1}` : `movie/${q.imdb}`;
    const d = await readJson(await ctx.get(`${API}/${path}.json`), "Stremio OpenSubtitles");
    const want = new Set(q.langs);
    return (d.subtitles || []).map((s) => ({ ref: s.url, name: s.movieReleaseName || s.subtitleFileName || `Subtitle ${s.id}`, lang: lang2(s.lang), release: s.movieReleaseName || "", hi: false, by: "OpenSubtitles" }))
      .filter((s) => s.ref && want.has(s.lang));
  },

  async download(ref, ctx, q) {
    let u; try { u = new URL(ref); } catch (e) { throw new Error("Bad id"); }
    if (!/(^|\.)strem\.io$/.test(u.hostname)) throw new Error("Bad id");
    const r = await ctx.get(u.toString());
    if (!r.ok) throw new Error(`Stremio OpenSubtitles download: HTTP ${r.status}`);
    return pickSubtitle(new Uint8Array(await r.arrayBuffer()), "opensubtitles.srt", q);
  },

  async test(ctx) {
    const d = await readJson(await ctx.get(`${API}/movie/tt1375666.json`), "Stremio OpenSubtitles");
    const all = d.subtitles || [];
    return { ok: all.length ? 1 : 0, note: `Works without a key · Inception: ${all.length} subtitles, ${all.filter((s) => s.lang === "ara").length} Arabic` };
  }
};
