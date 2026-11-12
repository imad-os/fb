// Match list pages of the "Yalla Shoot" family (yalla.golf, yshootx.com ...):
//   <div class="AY_Match live|not_started|finished"> <a href="match page"> TM_Name x2, MT_Time, MT_Stat, MT_Info
import { clean, unamp } from "../util.js";

export default {
  id: "ay-match",
  name: "AY_Match blocks (Yalla Shoot)",

  /** Pages to read for a site: today, and tomorrow / yesterday when the site asks for them. */
  days(site, sc) {
    const d = [{ url: site, today: true }];
    if (sc.tomorrow) d.push({ url: site + "matches-tomorrow" });
    if (sc.yesterday) d.push({ url: site + "matches-yesterday" });
    return d;
  },

  detect: (page) => page.includes('class="AY_Match'),

  /** -> [{ teams, time, status, channel, link, finished }] */
  parse(page) {
    const out = [];
    for (const chunk of page.split('<div class="AY_Match').slice(1)) {
      const names = [...chunk.matchAll(/class="TM_Name">([\s\S]*?)<\/div>/g)].map((m) => clean(m[1]));
      if (names.length < 2) continue;
      const cls = (chunk.match(/^([^"]*)"/) || [, ""])[1].trim();          // live / not_started / finished ...
      const link = chunk.match(/<a\s+href="([^"]+)"/);
      const time = chunk.match(/class="MT_Time">([\s\S]*?)<\/span>/);
      const stat = chunk.match(/class="MT_Stat">([\s\S]*?)<\/div>/);
      const info = chunk.match(/class="MT_Info">[\s\S]*?<span>([\s\S]*?)<\/span>/);
      out.push({
        teams: names[0] + " vs " + names[1],
        time: time ? clean(time[1]) : "", status: stat ? clean(stat[1]) : "", channel: info ? clean(info[1]) : "",
        link: link ? unamp(link[1]) : "", finished: /finished/.test(cls)
      });
    }
    return out;
  }
};
