// Small helpers shared by every route.

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });

export const text = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });

export const str = (v, d = "") => (v === undefined || v === null ? d : String(v));
export const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export const now = () => Math.floor(Date.now() / 1000);

export const LIST_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Query string + JSON or form body, merged (body wins), like Express' req.query + req.body. */
export async function params(request, url) {
  const out = Object.fromEntries(url.searchParams);
  if (request.method === "POST" || request.method === "PUT") {
    const type = request.headers.get("content-type") || "";
    try {
      if (type.includes("application/json")) Object.assign(out, await request.json());
      else if (type.includes("form")) Object.assign(out, Object.fromEntries(await request.formData()));
    } catch (e) { /* empty or broken body */ }
  }
  return out;
}

export function extOf(addr) {
  const p = str(addr).split("?")[0].split("#")[0];
  const i = p.lastIndexOf(".");
  const e = i > p.lastIndexOf("/") ? p.slice(i + 1).toLowerCase() : "";
  return /^[a-z0-9]{2,5}$/.test(e) ? e : "";
}

const enc = new TextEncoder();
export function b64url(bytes) {
  let s = ""; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function sha256(s) { return b64url(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
export function randomToken(n = 32) { return b64url(crypto.getRandomValues(new Uint8Array(n))); }

/** Constant time string compare. */
export function same(a, b) {
  a = str(a); b = str(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return d === 0;
}
