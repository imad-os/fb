// /gdrive/<file id>/<file name>?t=<Google access token>
// A Google Drive file for the TV's own player (Samsung AVPlay through My PC, MyPC.video): the TV's player cannot send Google's
// Authorization header and Google refuses a token in the address, so My PC gives the player this address and the worker passes
// the token on as the header. Range requests go straight through (seeking), the body is streamed (nothing kept, nothing logged).
// Only Google Drive downloads (files/<id>?alt=media), only GET / HEAD; the file name is only there so the player sees the extension.
const ID = /^[A-Za-z0-9_-]{10,200}$/;
const TOKEN = /^[A-Za-z0-9._~+/=-]{20,4096}$/;
const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];

export async function handleGdrive(request, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const id = decodeURIComponent(url.pathname.split("/")[2] || "");
  const tok = url.searchParams.get("t") || "";
  if (!ID.test(id) || !TOKEN.test(tok)) return new Response("Bad request", { status: 400 });
  const headers = { Authorization: "Bearer " + tok };
  const range = request.headers.get("range");
  if (range && /^bytes=\d*-\d*(,\s*\d*-\d*)*$/.test(range)) headers.Range = range;
  let res;
  try {
    res = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "?alt=media&supportsAllDrives=true&acknowledgeAbuse=false",
      { method: request.method, headers, redirect: "follow", cf: { cacheTtl: 0, cacheEverything: false } });
  } catch (e) {
    return new Response("Google Drive did not answer", { status: 502 });
  }
  const out = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  for (const k of PASS) { const v = res.headers.get(k); if (v) out.set(k, v); }
  if (!out.has("accept-ranges") && res.ok) out.set("accept-ranges", "bytes");
  // an error from Google (401: the token ran out; 403 / 404) goes back as a short text, never Google's own body
  if (!res.ok) return new Response("Google Drive: " + res.status, { status: res.status === 401 ? 401 : res.status === 404 ? 404 : res.status === 416 ? 416 : 502, headers: { "Cache-Control": "no-store" } });
  return new Response(request.method === "HEAD" ? null : res.body, { status: res.status, headers: out });
}
