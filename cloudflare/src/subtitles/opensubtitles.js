// OpenSubtitles.com (official REST API) - free API key: opensubtitles.com > profile > API consumers > New consumer.
// Free: searching, and 5 downloads a day per key without a user login (VIP raises it).
import { lang2, readJson, pickSubtitle } from "./common.js";

const API = "https://api.opensubtitles.com/api/v1";
const H = (ctx, json) => ({ "Api-Key": ctx.key, Accept: "application/json", ...(json ? { "Content-Type": "application/json" } : {}) });

export default {
  id: "opensubtitles", name: "OpenSubtitles.com", site: "https://www.opensubtitles.com/en/consumers", needsKey: true, kinds: ["movie", "series"],

  async search(q, ctx) {
    const p = new URLSearchParams();
    // keys in alphabetical order, as the API asks (it redirects otherwise)
    const set = {};
    if (q.type === "series") {
      if (q.episode) set.episode_number = q.episode;
      if (q.imdb) set.parent_imdb_id = q.imdb.replace(/^tt/, ""); else if (q.tmdb) set.parent_tmdb_id = q.tmdb; else set.query = q.title;
      if (q.season) set.season_number = q.season;
      set.type = "episode";
    } else {
      if (q.imdb) set.imdb_id = q.imdb.replace(/^tt/, ""); else if (q.tmdb) set.tmdb_id = q.tmdb; else set.query = q.title;
      set.type = "movie";
      if (!q.imdb && !q.tmdb && q.year) set.year = q.year;
    }
    set.languages = [...q.langs].sort().join(",");
    Object.keys(set).sort().forEach((k) => p.set(k, set[k]));
    const d = await readJson(await ctx.get(`${API}/subtitles?${p}`, { headers: H(ctx) }), "OpenSubtitles");
    return (d.data || []).map((x) => {
      const a = x.attributes || {}; const f = (a.files || [])[0];
      return f && { ref: String(f.file_id), name: a.release || f.file_name, lang: lang2(a.language), release: a.release || "", hi: !!a.hearing_impaired, by: (a.uploader || {}).name || "" };
    }).filter(Boolean);
  },

  async download(ref, ctx, q) {
    if (!/^\d+$/.test(ref)) throw new Error("Bad id");
    const d = await readJson(await ctx.get(`${API}/download`, { method: "POST", headers: H(ctx, true), body: JSON.stringify({ file_id: +ref }) }), "OpenSubtitles");
    if (!d.link) throw new Error("OpenSubtitles: " + (d.message || "no download link") + (d.remaining !== undefined ? ` (${d.remaining} downloads left)` : ""));
    const r = await ctx.get(d.link);
    if (!r.ok) throw new Error(`OpenSubtitles file: HTTP ${r.status}`);
    return pickSubtitle(new Uint8Array(await r.arrayBuffer()), d.file_name || ref + ".srt", q);
  },

  async test(ctx) {
    const r = await ctx.get(`${API}/subtitles?imdb_id=1375666&languages=ar`, { headers: H(ctx) });
    const d = await readJson(r, "OpenSubtitles");
    return { ok: 1, note: `Key works · ${d.total_count ?? (d.data || []).length} Arabic subtitles for Inception · free plan: 5 downloads a day` };
  }
};
