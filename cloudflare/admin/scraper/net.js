// Requests to the match sites from the admin page. Sites send no CORS headers, so a page cannot read them directly:
//   proxy set:   PROXY?url=<target>&referer=<ref>  (Range header passed on; final address in x-final-url)
//   no proxy:    the Worker's /api/fetch (signed-in admins only), same answer shape.
const TIMEOUT_MS = 15000;

export function makeNet({ proxy, api, token }) {
  proxy = String(proxy || "").trim();
  if (proxy && !/^https?:\/\//i.test(proxy)) proxy = "http://" + proxy;
  const net = { proxy, count: 0 };

  /** -> { r, fin }  (throws on network errors) */
  net.get = async (url, o = {}) => {
    net.count++;
    const sig = AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
    if (proxy) {
      const p = proxy + (proxy.includes("?") ? "&" : "?") + "url=" + encodeURIComponent(url) + (o.referer ? "&referer=" + encodeURIComponent(o.referer) : "");
      const r = await fetch(p, { headers: o.range ? { Range: o.range } : {}, cache: "no-store", signal: sig });
      return { r, fin: r.headers.get("x-final-url") || url };
    }
    const q = "url=" + encodeURIComponent(url) + (o.referer ? "&referer=" + encodeURIComponent(o.referer) : "") + (o.range ? "&range=" + encodeURIComponent(o.range) : "");
    const r = await fetch(api + "/api/fetch?" + q, { headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: sig });
    if (!r.headers.get("x-proxied")) {
      let msg = "Error " + r.status; try { msg = (await r.json()).error || msg; } catch (e) {}
      const err = new Error(r.status === 401 ? "Sign in again" : msg); err.auth = r.status === 401; throw err;
    }
    return { r, fin: r.headers.get("x-final-url") || url };
  };

  /** Page text, "" when it fails (the reason goes to log()). */
  net.text = async (url, referer, log) => {
    try {
      const { r } = await net.get(url, { referer });
      if (r.ok) return await r.text();
      try { await r.body?.cancel(); } catch (e) {}
      log && log("  ! " + url + " -> HTTP " + r.status, "dim");
    } catch (e) {
      if (e.auth) throw e;
      log && log("  ! " + url + " -> " + (e.name === "TimeoutError" ? "no answer" : e.message) +
        (proxy ? "  (through the proxy " + proxy + ": is it running?)" : ""), "dim");
    }
    return "";
  };
  return net;
}
