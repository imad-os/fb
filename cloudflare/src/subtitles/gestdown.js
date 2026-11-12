// Gestdown (api.gestdown.info) - Addic7ed's subtitles through a free API, no key needed. TV series only, mostly English.
import { LANG_NAME, readJson, pickSubtitle } from "./common.js";

const API = "https://api.gestdown.info";

export default {
  id: "gestdown", name: "Gestdown / Addic7ed (TV, no key)", site: "https://www.gestdown.info", needsKey: false, kinds: ["series"],

  async search(q, ctx) {
    if (q.type !== "series" || !q.season || !q.episode || !q.title) return [];
    const d = await readJson(await ctx.get(`${API}/shows/search/${encodeURIComponent(q.title)}`), "Gestdown");
    const shows = d.shows || [];
    const show = (q.tmdb && shows.find((s) => String(s.tmdbId) === q.tmdb)) || shows[0];
    if (!show) return [];
    const out = [];
    for (const l of q.langs.slice(0, 3)) {
      const name = LANG_NAME[l]; if (!name) continue;
      const r = await ctx.get(`${API}/subtitles/get/${show.id}/${q.season}/${q.episode}/${encodeURIComponent(name)}`);
      if (r.status === 404) continue;
      const s = await readJson(r, "Gestdown");
      for (const x of s.matchingSubtitles || []) if (x.completed !== false && x.downloadUri)
        out.push({ ref: x.downloadUri, name: `${show.name} S${String(q.season).padStart(2, "0")}E${String(q.episode).padStart(2, "0")} ${x.version || ""}`.trim(), lang: l, release: x.version || "", hi: !!x.hearingImpaired, by: "Addic7ed" });
    }
    return out;
  },

  async download(ref, ctx, q) {
    if (!/^\/subtitles\/download\/[\w-]+$/.test(ref)) throw new Error("Bad id");
    const r = await ctx.get(API + ref);
    if (!r.ok) throw new Error(`Gestdown download: HTTP ${r.status}`);
    return pickSubtitle(new Uint8Array(await r.arrayBuffer()), "addic7ed.srt", q);
  },

  async test(ctx) {
    const d = await readJson(await ctx.get(`${API}/shows/search/Breaking%20Bad`), "Gestdown");
    return { ok: (d.shows || []).length ? 1 : 0, note: `Works without a key · ${(d.shows || []).length} shows for "Breaking Bad"` };
  }
};
