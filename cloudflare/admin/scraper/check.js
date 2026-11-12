// Is a found stream really playing? Kept only when: HTTP 200, a real HLS playlist (not HTML), no redirect to
// another domain, and the first video segment is not an HTML page. At most 3 requests.
import { hostOf } from "./util.js";

export const CHECK_FETCHES = 3;

async function playlist(net, url) {
  let r, fin;
  try { ({ r, fin } = await net.get(url)); } catch (e) { return { err: "network error: " + (e.name === "TimeoutError" ? "no answer" : e.message) }; }
  const drop = async () => { try { await r.body?.cancel(); } catch (e) {} };
  if (!r.ok) { await drop(); return { err: "HTTP " + r.status }; }
  if (hostOf(fin) !== hostOf(url)) { await drop(); return { err: "redirects to another domain (" + hostOf(fin) + ")" }; }
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  const text = (await r.text()).replace(/^﻿/, "").trimStart();
  if (ct.includes("html") || !text.startsWith("#EXTM3U")) return { err: "not a playlist (HTML or other page)" };
  return { text, fin };
}

async function head(r, max = 2048) {
  if (!r.body) return new Uint8Array(0);
  const rd = r.body.getReader(); const parts = []; let n = 0;
  while (n < max) { const { value, done } = await rd.read(); if (done) break; parts.push(value); n += value.length; }
  try { await rd.cancel(); } catch (e) {}
  const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}

const linesOf = (t) => t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

/** -> [ok, why] */
export async function checkStream(net, url) {
  let p = await playlist(net, url);
  if (p.err) return [false, p.err];
  let lines = linesOf(p.text), cur = p.fin;
  if (lines.some((l) => l.startsWith("#EXT-X-STREAM-INF"))) {             // master playlist: check its first variant
    const sub = lines.find((l) => !l.startsWith("#"));
    if (!sub) return [false, "master playlist without variants"];
    p = await playlist(net, new URL(sub, cur).href);
    if (p.err) return [false, "variant: " + p.err];
    cur = p.fin; lines = linesOf(p.text);
  }
  const seg = lines.find((l) => !l.startsWith("#"));
  if (!seg) return [false, "playlist has no segments"];
  try {
    const { r } = await net.get(new URL(seg, cur).href, { range: "bytes=0-2047" });
    if (r.status !== 200 && r.status !== 206) { try { await r.body?.cancel(); } catch (e) {} return [false, "first segment HTTP " + r.status]; }
    const b = await head(r);
    if (!b.length) return [false, "first segment empty"];
    let i = 0; while (i < b.length && b[i] <= 32) i++;
    if (b[i] === 0x3c || b[i] === 0x7b) return [false, "first segment is an HTML page"];
  } catch (e) { return [false, "first segment: " + e.message]; }
  return [true, "ok"];
}
