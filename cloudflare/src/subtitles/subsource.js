// SubSource (subsource.net) - free API key: Dashboard > API. Free: 60 requests/min, 1,800/hour, 7,200/day.
// Auth: X-API-Key header. Search a title -> movieId (a series has one movieId per season) -> subtitles -> /download (a zip).
import { lang2, LANG_NAME, readJson, pickSubtitle, isEpisode } from "./common.js";

const API = "https://api.subsource.net/api/v1";
const H = (ctx) => ({ "X-API-Key": ctx.key });

async function findTitle(q, ctx) {
  let list = [];
  if (q.imdb) list = (await readJson(await ctx.get(`${API}/movies/search?searchType=imdb&imdb=${q.imdb}`, { headers: H(ctx) }), "SubSource")).data || [];
  if (!list.length && q.title) list = (await readJson(await ctx.get(`${API}/movies/search?searchType=text&q=${encodeURIComponent(q.title)}`, { headers: H(ctx) }), "SubSource")).data || [];
  const series = q.type === "series";
  list = list.filter((m) => series ? /series|tv/i.test(m.type || "") : !/series|tv/i.test(m.type || ""));
  if (q.imdb) { const same = list.filter((m) => m.imdbId === q.imdb); if (same.length) list = same; }
  if (series && q.season) list = list.filter((m) => !m.season || +m.season === +q.season);
  if (!series && q.year) list.sort((a, b) => Math.abs((a.releaseYear || 0) - q.year) - Math.abs((b.releaseYear || 0) - q.year));
  return list[0] || null;
}

export default {
  id: "subsource", name: "SubSource", site: "https://subsource.net", needsKey: true, kinds: ["movie", "series"],

  async search(q, ctx) {
    const m = await findTitle(q, ctx);
    if (!m) return [];
    const out = [];
    for (const l of q.langs.slice(0, 3)) {
      const name = (LANG_NAME[l] || l).toLowerCase();
      const d = await readJson(await ctx.get(`${API}/subtitles?movieId=${m.movieId}&language=${encodeURIComponent(name)}&limit=30`, { headers: H(ctx) }), "SubSource");
      for (const s of d.data || []) {
        const release = (s.releaseInfo || []).join(" / ");
        if (q.type === "series" && q.episode && !isEpisode(release, q.season, q.episode) && /E\d/i.test(release)) continue;
        // some uploads are only a text file with a link (mega.nz...) or idx/sub images: the preview shows it
        if (s.preview && !/-->|Dialogue:|^\{\d+\}/m.test(s.preview)) continue;
        out.push({ ref: String(s.subtitleId), name: release || m.title, lang: lang2(s.language), release, hi: !!s.hearingImpaired, by: ((s.contributors || [])[0] || {}).displayname || "" });
      }
    }
    return out;
  },

  async download(ref, ctx, q) {
    if (!/^\d+$/.test(ref)) throw new Error("Bad id");
    const r = await ctx.get(`${API}/subtitles/${ref}/download`, { headers: H(ctx) });
    if (!r.ok) { const t = await r.text(); throw new Error(`SubSource download: HTTP ${r.status} ${t.slice(0, 100)}`); }
    return pickSubtitle(new Uint8Array(await r.arrayBuffer()), ref + ".zip", q);
  },

  async test(ctx) {
    const r = await ctx.get(`${API}/movies/search?searchType=imdb&imdb=tt1375666`, { headers: H(ctx) });
    const d = await readJson(r, "SubSource");
    const left = r.headers.get("x-ratelimit-remaining-day"), lim = r.headers.get("x-ratelimit-limit-day");
    return { ok: d.success === false ? 0 : 1, note: d.success === false ? String(d.message || "Refused") : `Key works${lim ? ` · ${left} / ${lim} requests left today` : ""}` };
  }
};
