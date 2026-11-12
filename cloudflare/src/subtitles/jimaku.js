// Jimaku (jimaku.cc) - anime subtitles, mostly Japanese. Free API key: jimaku.cc > account > API key.
// Only asked when Japanese ("ja") is one of the wanted languages.
import { readJson, pickSubtitle, isEpisode } from "./common.js";

const API = "https://jimaku.cc/api";
const H = (ctx) => ({ Authorization: ctx.key });

export default {
  id: "jimaku", name: "Jimaku (anime)", site: "https://jimaku.cc/login", needsKey: true, kinds: ["movie", "series"],

  async search(q, ctx) {
    if (!q.langs.includes("ja")) return [];
    const p = new URLSearchParams({ anime: "true" });
    if (q.tmdb) p.set("tmdb_id", (q.type === "series" ? "tv:" : "movie:") + q.tmdb); else p.set("query", q.title);
    let entries = await readJson(await ctx.get(`${API}/entries/search?${p}`, { headers: H(ctx) }), "Jimaku");
    if (!entries.length && q.tmdb) entries = await readJson(await ctx.get(`${API}/entries/search?${new URLSearchParams({ anime: "true", query: q.title })}`, { headers: H(ctx) }), "Jimaku");
    const e = entries[0];
    if (!e) return [];
    const fp = q.type === "series" && q.episode ? `?episode=${q.episode}` : "";
    const files = await readJson(await ctx.get(`${API}/entries/${e.id}/files${fp}`, { headers: H(ctx) }), "Jimaku");
    return files.filter((f) => f.url && (!q.episode || isEpisode(f.name, q.season, q.episode) || fp))
      .slice(0, 30).map((f) => ({ ref: f.url, name: f.name, lang: "ja", release: f.name, hi: false, by: e.english_name || e.name || "" }));
  },

  async download(ref, ctx, q) {
    let u; try { u = new URL(ref); } catch (e) { throw new Error("Bad id"); }
    if (u.hostname !== "jimaku.cc") throw new Error("Bad id");
    const r = await ctx.get(u.toString(), { headers: H(ctx) });
    if (!r.ok) throw new Error(`Jimaku download: HTTP ${r.status}`);
    return pickSubtitle(new Uint8Array(await r.arrayBuffer()), decodeURIComponent(u.pathname.split("/").pop() || "jimaku.srt"), q);
  },

  async test(ctx) {
    const d = await readJson(await ctx.get(`${API}/entries/search?anime=true&query=Frieren`, { headers: H(ctx) }), "Jimaku");
    return { ok: 1, note: `Key works · ${d.length} entries for "Frieren"` };
  }
};
