// Stream check: is the source address answering? Used by the admin page ("Check streams").
// One GET per stream, from Cloudflare's network (the admin's own connection only carries ids and results).
// Only the reply headers are read; the body (video) is cancelled at once, so a check costs a few KB.
// Redirects are not followed: a 3xx means the server is up and answering (Xtream panels redirect to a token address).
// ok: 1 up, 0 down, -1 cannot be checked from Cloudflare (rtmp/rtsp/udp, bare IP hosts) - never counted as down.

const UA = "VLC/3.0.20 LibVLC/3.0.20";
const IP_HOST = /^(\d{1,3}\.){3}\d{1,3}$|^\[/;
export const CHECK_BATCH = 25;        // per request; the free plan allows 50 outgoing requests per request
const TIMEOUT_MS = 8000;

export async function checkUrl(source) {
  let u;
  try { u = new URL(source); } catch (e) { return { ok: 0, note: "bad address" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: -1, note: u.protocol.replace(":", "") };
  if (IP_HOST.test(u.hostname)) return { ok: -1, note: "IP address" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(u.toString(), {
      method: "GET", redirect: "manual", signal: ctl.signal,
      headers: { "User-Agent": UA, Accept: "*/*", Range: "bytes=0-1023" }
    });
    try { if (r.body) await r.body.cancel(); } catch (e) {}
    const s = r.status;
    return { ok: (s >= 200 && s < 400) || s === 416 ? 1 : 0, note: String(s) };
  } catch (e) {
    return { ok: 0, note: ctl.signal.aborted ? "timeout" : "no connection" };
  } finally {
    clearTimeout(timer);
  }
}

/** Checks the given stream ids (max CHECK_BATCH), saves the results, returns [{ id, ok, note }]. */
export async function checkStreams(env, ids) {
  ids = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))].slice(0, CHECK_BATCH);
  if (!ids.length) return [];
  const rows = (await env.DB.prepare("SELECT id, source FROM streams WHERE id IN (SELECT value FROM json_each(?)) AND type != 'series'")
    .bind(JSON.stringify(ids)).all()).results;
  const out = await Promise.all(rows.map(async (s) => ({ id: s.id, ...(await checkUrl(s.source)) })));
  if (out.length) {
    await env.DB.prepare(`UPDATE streams SET
        check_ok = (SELECT json_extract(value, '$.ok') FROM json_each(?1) WHERE json_extract(value, '$.id') = streams.id),
        check_note = (SELECT json_extract(value, '$.note') FROM json_each(?1) WHERE json_extract(value, '$.id') = streams.id),
        checked = unixepoch()
      WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`).bind(JSON.stringify(out)).run();
  }
  return out;
}
