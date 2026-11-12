// Shared helpers for the subtitle providers (one file per provider in this folder, all with the same shape):
//
//   export default {
//     id, name, site,            // id = short name used in tokens and in the admin; site = where to get a key
//     needsKey,                  // true: works only with a key from the admin page (D1 table subtitle_keys)
//     kinds,                     // ["movie", "series"] (what it can search)
//     async search(q, ctx),      // -> [{ ref, name, lang, release, hi }]  (ref = provider's own id, a string)
//     async download(ref, ctx),  // -> { bytes: Uint8Array, name }  (a .srt/.vtt/.ass... file, zips already opened)
//     async test(ctx)            // -> { ok, note }  (a small real request with this key)
//   }
//
// q   = normalized query (see makeQuery): { type, title, year, tmdb, imdb, season, episode, langs }
// ctx = { key, env, get(url, init) } ; get() = fetch with a timeout and our User-Agent.

export const UA = "MyPC v1.0";
export const TIMEOUT_MS = 9000;

// ------------------------------------------------------------------ languages
const L3 = { ara: "ar", eng: "en", fre: "fr", fra: "fr", spa: "es", ger: "de", deu: "de", ita: "it", por: "pt", pob: "pt", tur: "tr", dut: "nl", nld: "nl",
  rus: "ru", per: "fa", fas: "fa", ind: "id", jpn: "ja", chi: "zh", zho: "zh", kor: "ko", heb: "he", gre: "el", ell: "el", pol: "pl", rum: "ro", ron: "ro",
  swe: "sv", dan: "da", nor: "no", fin: "fi", hun: "hu", cze: "cs", ces: "cs", hin: "hi", urd: "ur", may: "ms", msa: "ms", vie: "vi", tha: "th", ukr: "uk", bul: "bg" };
const LNAME = { arabic: "ar", english: "en", french: "fr", spanish: "es", german: "de", italian: "it", portuguese: "pt", "brazillian portuguese": "pt",
  "portuguese (brazil)": "pt", turkish: "tr", dutch: "nl", russian: "ru", persian: "fa", farsi: "fa", "farsi/persian": "fa", indonesian: "id", japanese: "ja",
  chinese: "zh", korean: "ko", hebrew: "he", greek: "el", polish: "pl", romanian: "ro", swedish: "sv", danish: "da", norwegian: "no", finnish: "fi",
  hungarian: "hu", czech: "cs", hindi: "hi", urdu: "ur", malay: "ms", vietnamese: "vi", thai: "th", ukrainian: "uk", bulgarian: "bg" };
export const LANG_NAME = { ar: "Arabic", en: "English", fr: "French", es: "Spanish", de: "German", it: "Italian", pt: "Portuguese", tr: "Turkish", nl: "Dutch",
  ru: "Russian", fa: "Persian", id: "Indonesian", ja: "Japanese", zh: "Chinese", ko: "Korean" };

/** Any language form (ar, ara, AR, Arabic, "Farsi/Persian") -> ISO 639-1 ("ar"); unknown -> lowercased input. */
export function lang2(x) {
  const s = String(x || "").trim().toLowerCase();
  if (!s) return "";
  if (s.length === 2) return s;
  if (L3[s]) return L3[s];
  if (LNAME[s]) return LNAME[s];
  const first = s.split(/[\s(/,-]/)[0];
  return LNAME[first] || L3[first] || s;
}

// ------------------------------------------------------------------ query
const JUNK = /\s*\b(HD|FHD|UHD|4K|2160p|1080p|720p|480p|BluRay|BRRip|BDRip|WEB-?DL|WEBRip|DVDRip|CAMRip|HDCAM|TS|TC|HDTV|PDTV|XviD|x264|x265|HEVC|H\.?264|DivX|AC3|AAC|MP3|Dubbed|Subbed|MultiAudio|MULTI|VOSTFR)\b\s*/gi;

/** Player input (movieData, movieType, languages) -> { type, title, year, tmdb, imdb, season, episode, langs }. */
export function makeQuery(movie, type, languages) {
  movie = movie || {};
  const q = { type: type === "series" || type === "tv" || type === "episode" ? "series" : "movie", title: "", year: null, tmdb: "", imdb: "", season: null, episode: null };
  let name = String(q.type === "series" ? (movie.series_name || movie.name || movie.title || "") : (movie.name || movie.title || ""));
  const y = name.match(/\((\d{4})\)/); if (y) { q.year = +y[1]; name = name.replace(/\s*\(\d{4}\)\s*/, " "); }
  if (q.type === "series") {
    q.season = parseInt(movie.season ?? movie.season_number, 10) || null;
    q.episode = parseInt(movie.episode_num ?? movie.episode ?? movie.episode_number, 10) || null;
    const m = name.match(/^(.+?)\s+S(\d{1,2})\s*E(\d{1,3})/i);
    if (m) { name = m[1]; q.season = q.season || +m[2]; q.episode = q.episode || +m[3]; }
    name = name.replace(/\bS\d{1,2}\b.*$/i, "");
    q.tmdb = String(movie.series_tmdb_id || movie.tmdb_id || movie.tmdb || "").trim();
  } else {
    q.tmdb = String(movie.tmdb_id || movie.tmdb || "").trim();
  }
  q.title = name.replace(JUNK, " ").replace(/\[.*?\]|\{.*?\}/g, " ").replace(/^[A-Z]{2,3}\s*[-|:]\s*/, "").replace(/\s+/g, " ").trim();
  q.year = q.year || parseInt(movie.year, 10) || null;
  q.imdb = String(movie.imdb_id || movie.imdb || "").trim();
  if (q.imdb && !/^tt\d+$/.test(q.imdb)) q.imdb = /^\d+$/.test(q.imdb) ? "tt" + q.imdb : "";
  if (!/^\d+$/.test(q.tmdb)) q.tmdb = "";
  const want = Array.isArray(languages) ? languages : String(languages || "").split(/[\s,]+/);
  q.langs = [...new Set(want.map(lang2).filter((l) => /^[a-z]{2}$/.test(l)))];
  if (!q.langs.length) q.langs = ["ar", "en"];
  return q;
}

/** Fills q.tmdb / q.imdb from TMDB (the Worker's TMDB_API_KEY) when they are missing. Never throws. */
export async function resolveIds(env, q, get) {
  if (!env.TMDB_API_KEY || (q.tmdb && q.imdb)) return q;
  const kind = q.type === "series" ? "tv" : "movie";
  const base = "https://api.themoviedb.org/3";
  const k = `api_key=${encodeURIComponent(env.TMDB_API_KEY)}`;
  try {
    if (!q.tmdb && q.title) {
      const yr = q.year ? (kind === "tv" ? `&first_air_date_year=${q.year}` : `&year=${q.year}`) : "";
      const r = await get(`${base}/search/${kind}?${k}&query=${encodeURIComponent(q.title)}${yr}`);
      const d = r.ok ? await r.json() : null;
      const hit = d && d.results && d.results[0];
      if (hit) { q.tmdb = String(hit.id); q.year = q.year || parseInt((hit.release_date || hit.first_air_date || "").slice(0, 4), 10) || null; }
    }
    if (q.tmdb && !q.imdb) {
      const r = await get(`${base}/${kind}/${q.tmdb}/external_ids?${k}`);
      const d = r.ok ? await r.json() : null;
      if (d && /^tt\d+$/.test(d.imdb_id || "")) q.imdb = d.imdb_id;
    }
  } catch (e) { /* ids stay empty: providers fall back to the title */ }
  return q;
}

export const pad2 = (n) => String(n).padStart(2, "0");
/** "S01E02" / "1x02" / "E02" style match of an episode in a file or release name. */
export function isEpisode(name, season, episode) {
  if (!episode) return true;
  const s = String(name || "");
  const re = new RegExp(`(?:S0*${season || 1}\\s*[.\\-_ ]?E0*${episode}(?!\\d))|(?:\\b0*${season || 1}x0*${episode}(?!\\d))|(?:\\bE(?:P|pisode)?\\s*0*${episode}(?!\\d))`, "i");
  return re.test(s);
}

// ------------------------------------------------------------------ zip
const SUB_EXT = ["srt", "vtt", "ass", "ssa", "sub", "smi", "txt"];
const extOf = (n) => (String(n).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
export const isSubName = (n) => SUB_EXT.includes(extOf(n));

async function inflateRaw(data) {
  const ds = new DecompressionStream("deflate-raw");
  const out = new Response(new Blob([data]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** Reads a ZIP (stored or deflate). Returns [{ name, bytes() }] for files. */
export function unzipEntries(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Not a zip file");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = [];
  for (let n = 0; n < count && p + 46 <= u8.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    const lnlen = dv.getUint16(local + 26, true), lxlen = dv.getUint16(local + 28, true);
    const start = local + 30 + lnlen + lxlen;
    const data = u8.subarray(start, start + csize);
    out.push({ name, bytes: async () => { if (method === 0) return data.slice(); if (method === 8) return inflateRaw(data); throw new Error("Unsupported zip method " + method); } });
  }
  return out;
}

/** Bytes of a subtitle download: a zip -> the best subtitle file inside (episode match, .srt first); else the bytes as they are. */
export async function pickSubtitle(bytes, name, q) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipEntries(bytes).filter((f) => isSubName(f.name) && !/__MACOSX\//.test(f.name));
    if (!files.length) throw new Error("No subtitle file in the archive");
    const score = (f) => (q && q.episode && isEpisode(f.name, q.season, q.episode) ? 100 : 0) + (10 - SUB_EXT.indexOf(extOf(f.name)));
    files.sort((a, b) => score(b) - score(a));
    return { bytes: await files[0].bytes(), name: files[0].name.split("/").pop() };
  }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")));
    return { bytes: new Uint8Array(await out.arrayBuffer()), name: String(name || "subtitle.srt").replace(/\.gz$/i, "") };
  }
  return { bytes, name: name || "subtitle.srt" };
}

// ------------------------------------------------------------------ text encoding
// Many Arabic files are Windows-1256 and many French/Spanish ones Windows-1252; players get UTF-8 from us.
const W1256 = "\u20ac\u067e\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0679\u2039\u0152\u0686\u0698\u0688\u06af\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u06a9\u2122\u0691\u203a\u0153\u200c\u200d\u06ba\u00a0\u060c\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7\u00a8\u00a9\u06be\u00ab\u00ac\u00ad\u00ae\u00af\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7\u00b8\u00b9\u061b\u00bb\u00bc\u00bd\u00be\u061f\u06c1\u0621\u0622\u0623\u0624\u0625\u0626\u0627\u0628\u0629\u062a\u062b\u062c\u062d\u062e\u062f\u0630\u0631\u0632\u0633\u0634\u0635\u0636\u00d7\u0637\u0638\u0639\u063a\u0640\u0641\u0642\u0643\u00e0\u0644\u00e2\u0645\u0646\u0647\u0648\u00e7\u00e8\u00e9\u00ea\u00eb\u0649\u064a\u00ee\u00ef\u064b\u064c\u064d\u064e\u00f4\u064f\u0650\u00f7\u0651\u00f9\u0652\u00fb\u00fc\u200e\u200f\u06d2";
const W1252 = "\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178\u00a0\u00a1\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7\u00a8\u00a9\u00aa\u00ab\u00ac\u00ad\u00ae\u00af\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7\u00b8\u00b9\u00ba\u00bb\u00bc\u00bd\u00be\u00bf\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf\u00d0\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u00d7\u00d8\u00d9\u00da\u00db\u00dc\u00dd\u00de\u00df\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e6\u00e7\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef\u00f0\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u00f7\u00f8\u00f9\u00fa\u00fb\u00fc\u00fd\u00fe\u00ff";
function decodeSingle(u8, table) { let s = ""; for (const b of u8) s += b < 128 ? String.fromCharCode(b) : table[b - 128]; return s; }

/** Subtitle bytes in any of UTF-8 / UTF-16 / Windows-1256 / Windows-1252 -> UTF-8 text. */
export function toText(u8, langHint) {
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return new TextDecoder().decode(u8.subarray(3));
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) { const sw = new Uint8Array(u8.length - 2); for (let i = 2; i + 1 < u8.length; i += 2) { sw[i - 2] = u8[i + 1]; sw[i - 1] = u8[i]; } return new TextDecoder("utf-16le").decode(sw); }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch (e) { /* not UTF-8 */ }
  const ar = decodeSingle(u8, W1256);
  const arabic = (ar.match(/[؀-ۿ]/g) || []).length;
  let high = 0; for (const b of u8) if (b >= 0xc0) high++;
  if (langHint === "ar" || langHint === "fa" || (high && arabic >= high * 0.6)) return ar;
  return decodeSingle(u8, W1252);
}

// ------------------------------------------------------------------ tokens
// What players get as a subtitle "url": sub:<provider>:<ref>[:<season>x<episode>]. Downloads go back through the Worker,
// so keys never leave it and nothing else can be fetched with it.
const b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
export function makeToken(provider, ref, q) {
  return `sub:${provider}:${b64u(String(ref))}${q && q.episode ? `:${q.season || 1}x${q.episode}` : ""}`;
}
export function readToken(t) {
  const m = String(t || "").match(/^sub:([a-z0-9_-]+):([A-Za-z0-9_-]+)(?::(\d+)x(\d+))?$/);
  if (!m) return null;
  try { return { provider: m[1], ref: unb64u(m[2]), season: m[3] ? +m[3] : null, episode: m[4] ? +m[4] : null }; } catch (e) { return null; }
}

/** fetch() with a timeout and our User-Agent. */
export function getter(timeout = TIMEOUT_MS) {
  return (url, init = {}) => fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json, */*", ...(init.headers || {}) }, signal: AbortSignal.timeout(init.timeout || timeout) });
}

/** Reads a JSON answer; a non-2xx answer becomes an Error with the provider's own message. */
export async function readJson(r, what) {
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch (e) {}
  if (!r.ok) {
    const msg = d && (d.message || d.error || d.details || (d.errors && JSON.stringify(d.errors))) || t.slice(0, 120) || r.statusText;
    const e = new Error(`${what || "Provider"}: HTTP ${r.status} ${String(msg).slice(0, 160)}`.trim()); e.status = r.status; throw e;
  }
  if (d === null) throw new Error(`${what || "Provider"}: not a JSON answer`);
  return d;
}
