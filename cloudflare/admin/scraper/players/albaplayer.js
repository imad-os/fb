// Match pages with one player at /albaplayer/<slug>/ and its servers at ?serv=N (e.g. yalla.golf -> xi.yallamo.xyz).
// The player address comes from the page's own iframe (the player slug can differ from the page slug:
// page /b-1/ -> player /albaplayer/bein-1/); guessed from the page slug when there is none.
import { abs } from "../util.js";

export default {
  id: "albaplayer",
  name: "albaplayer ?serv=N",
  detect: () => true,                       // last in the list: the fallback

  servers(page, link) {
    const im = page.match(/<iframe[^>]+src=["']([^"']*\/albaplayer\/[^"']*)["']/i);
    let player = im ? abs(im[1], link).split("?")[0] : "";
    if (!player) {
      const u = new URL(link);
      player = u.origin + "/albaplayer/" + u.pathname.replace(/\/+$/, "").split("/").pop() + "/";
    }
    return { next: { step: "player", url: player, ref: link } };   // read the player first: it links its servers
  },

  steps: {
    player(page, t) {
      let nums = [...new Set([...page.matchAll(/[?&]serv=(\d+)/g)].map((m) => +m[1]))].sort((a, b) => a - b);
      if (!nums.length) nums = [1];
      return { servers: nums.map((n) => ({ url: t.url + "?serv=" + n, ref: t.ref, n })) };
    }
  }
};
