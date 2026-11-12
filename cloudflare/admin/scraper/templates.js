// The site templates the scraper knows. To support a new kind of site, add a file and list it here.
//
// LIST templates read a site's match list:
//   { id, name, days(site, scraper) -> [{ url, today }], detect(page) -> bool, parse(page) -> [match] }
//   match = { teams, time, status, channel, link, finished }
// PLAYER templates read a match page and give its servers (the first whose detect() says yes is used):
//   { id, name, detect(page, link) -> bool,
//     servers(page, link) -> { servers: [{ url, ref, n? }] }          servers to search for a .m3u8
//                          | { next: { step, url, ref } },            or read one more page first:
//     steps: { <step>(page, next) -> same as servers() } }            then steps[step] gets that page
// Every server address is then searched for a .m3u8 by engine.js (iframes followed up to 3 levels, document.write decoded)
// and the stream is checked (check.js) before it is saved.
import ayMatch from "./lists/ay-match.js";
import listed from "./players/listed.js";
import albaplayer from "./players/albaplayer.js";

export const LISTS = [ayMatch];
export const PLAYERS = [listed, albaplayer];

export const listFor = (page) => LISTS.find((t) => t.detect(page)) || LISTS[0];
export const playerFor = (page, link) => PLAYERS.find((t) => t.detect(page, link)) || PLAYERS[PLAYERS.length - 1];
export const player = (id) => PLAYERS.find((t) => t.id === id);
