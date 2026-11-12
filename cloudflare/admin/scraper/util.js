// Small text helpers shared by the scraper templates.

export const clean = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'")
  .replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

export const unamp = (s) => String(s || "").replace(/&amp;/g, "&");

/** Absolute address of `href` seen on the page at `base`, or "". */
export function abs(href, base) {
  try { const u = new URL(unamp(href), base); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch (e) { return ""; }
}

export const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch (e) { return ""; } };

/** Some players hide their code in document.write("\x3c\x21..."): the decoded text. */
export function decodeWrites(page) {
  const out = [];
  for (const m of page.matchAll(/document\.write\("((?:[^"\\]|\\.)*)"\)/g)) {
    const s = m[1].replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    out.push(s.replace(/\\\//g, "/").replace(/\\"/g, '"'));
  }
  return out.join("\n");
}

/** The page as the stream finder reads it: \/ unescaped + document.write code decoded. */
export const readable = (page) => page.replace(/\\\//g, "/") + "\n" + decodeWrites(page);

export const M3U8_RE = /https?:\/\/[^"'\s\\<>]+?\.m3u8[^"'\s\\<>]*/i;

export function iframes(text) {
  return [...text.matchAll(/<iframe[^>]+src=["']([^"']+)/gi)].map((m) => m[1]);
}
