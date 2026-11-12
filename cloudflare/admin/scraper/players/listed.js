// Match pages that list their servers themselves (e.g. yshootx.com):
//   <iframe id="match-player" src="..."> + one <a data-src="..."> per server
import { abs } from "../util.js";

export default {
  id: "listed",
  name: "Server list on the match page (data-src / #match-player)",
  detect: (page) => /data-src="https?:/.test(page) || /id="match-player"/.test(page),

  servers(page, link) {
    const srcs = [...page.matchAll(/data-src="([^"]+)"/g)].map((m) => m[1]);
    const ifr = page.match(/<iframe[^>]+id="match-player"[^>]+src="([^"]+)"/);
    if (ifr) srcs.unshift(ifr[1]);
    return { servers: [...new Set(srcs.map((s) => abs(s, link)).filter(Boolean))].map((url) => ({ url, ref: link })) };
  }
};
