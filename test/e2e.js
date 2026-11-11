// End-to-end check against the LOCAL emulators: node test/e2e.js [shotsDir]
// Needs: firebase emulators:start --config firebase.emulators.json --project demo-iptv, then node test/seed.js
"use strict";
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:5000";
const shots = process.argv[2] || __dirname + "/shots";
let fails = 0;
const check = (ok, what) => { console.log((ok ? "PASS " : "FAIL ") + what); if (!ok) fails++; };

const M3U = `#EXTM3U
#EXTINF:-1 tvg-id="bein1" tvg-logo="https://picsum.photos/seed/b1/80" group-title="Sports",Sport One HD
https://cdn.example.com/sport1/index.m3u8
#EXTINF:-1 tvg-id="bein2" tvg-logo="https://picsum.photos/seed/b2/80" group-title="Sports",Sport Two HD
https://cdn.example.com/sport2/index.m3u8
#EXTINF:-1 tvg-logo="https://picsum.photos/seed/n1/80" group-title="News",World News 24
https://cdn.example.com/news/live.m3u8
#EXTINF:-1 tvg-logo="https://picsum.photos/seed/m1/80" group-title="Films",The Long Match (2024)
https://cdn.example.com/films/long-match.mp4
#EXTINF:-1 group-title="Sports",<img src=x onerror=alert(1)>
https://cdn.example.com/sport3/index.m3u8
`;

(async () => {
  const browser = await chromium.launch();
  // No internet in some test machines: SDK_DIR = the same Firebase 12.6.0 bundled from npm (see README "Tests").
  const route = async (ctx) => { if (process.env.SDK_DIR) await ctx.route("https://www.gstatic.com/firebasejs/12.6.0/*", (r) => r.fulfill({ path: process.env.SDK_DIR + "/" + r.request().url().split("/").pop(), contentType: "text/javascript" })); };
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 2 });
  await route(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => { errors.push("alert: " + d.message()); d.dismiss(); });

  await page.goto(BASE + "/");
  check(page.url().endsWith("/admin.html"), "/ redirects to admin.html");
  await page.waitForSelector("#login:not([hidden])");
  await page.screenshot({ path: shots + "/1-login.png" });
  await page.fill("#email", "admin@test.local");
  await page.fill("#password", "admin123");
  await page.click("#login-btn");
  await page.waitForSelector("#migrate", { timeout: 15000 });
  await page.screenshot({ path: shots + "/2-migration-banner.png" });
  await page.click("#migrate");
  await page.waitForSelector("text=Done:", { timeout: 15000 });
  await page.waitForSelector("td >> text=Old News HD");
  check(true, "old streams moved into Default and listed");

  // new list
  await page.click('a[data-page="lists"]');
  await page.click("#add-list");
  await page.fill("#l-name", "Sports Pack");
  check(await page.inputValue("#l-id") === "sports-pack", "link name made from the list name");
  await page.click("#dlg-foot [data-primary]");
  await page.waitForSelector(".list-card.on >> text=Sports Pack");

  // import into the new list
  await page.click('a[data-page="streams"]');
  await page.waitForSelector("#import");
  await page.click("#import");
  await page.fill("#m-text", M3U);
  await page.click("#dlg-foot [data-primary]");
  await page.waitForSelector("text=Imported 5 streams", { timeout: 20000 });
  await page.waitForSelector("td >> text=Sport One HD");
  await page.waitForTimeout(800);
  await page.screenshot({ path: shots + "/3-streams-live.png" });
  check(!errors.some((e) => e.startsWith("alert")), "M3U names are shown as text (no script runs)");

  // user only for the new list
  await page.click('a[data-page="users"]');
  await page.click("#add-user");
  await page.fill("#u-name", "sam");
  await page.fill("#u-pass", "sam-pass-1");
  await page.click('[data-add="3m"]');
  await page.click("#dlg-foot [data-primary]");
  await page.waitForSelector("#dlg-title >> text=Links for sam");
  await page.waitForTimeout(300);
  await page.screenshot({ path: shots + "/4-user-links.png" });
  await page.click("#dlg-foot button");

  // a second user in both lists
  await page.click("#add-user");
  await page.fill("#u-name", "both");
  await page.fill("#u-pass", "both-pass");
  await page.check('input[name=u-list][value="default"]');
  await page.click("#dlg-foot [data-primary]");
  await page.waitForSelector("#dlg-title >> text=Links for both");
  await page.click("#dlg-foot button");
  await page.click('[data-all="1"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: shots + "/5-users-all.png" });

  await page.click('a[data-page="links"]');
  await page.selectOption("#lu", { label: "sam" });
  await page.waitForSelector("pre.share");
  await page.screenshot({ path: shots + "/6-links-page.png", fullPage: true });
  const server = await page.textContent(".copy code");
  check(server === BASE + "/xtream/l/sports-pack", "server address of the list: " + server);

  await page.click('a[data-page="lists"]');
  await page.waitForSelector(".list-card >> text=Sports Pack");
  await page.waitForTimeout(500);
  await page.screenshot({ path: shots + "/7-lists.png" });

  // phone width
  const phone = await ctx.newPage(); // same sign-in
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(BASE + "/admin.html#users");
  await phone.waitForSelector("td >> text=sam");
  await phone.screenshot({ path: shots + "/8-phone-users.png" });
  const sw = await phone.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= 390, "no sideways scroll on a phone (" + sw + ")");

  // the server, as a player sees it
  const j = async (u) => { const r = await fetch(BASE + u, { redirect: "manual" }); let b = await r.text(); try { b = JSON.parse(b); } catch (e) {} return { s: r.status, b, loc: r.headers.get("location") }; };
  let r = await j("/xtream/player_api.php?username=olduser&password=oldpass&action=get_live_categories");
  check(r.s === 200 && r.b.length === 1 && r.b[0].category_name === "News", "old link + old user still works after the move");
  r = await j("/xtream/l/sports-pack/player_api.php?username=olduser&password=oldpass");
  check(r.s === 401 && r.b.user_info.status === "not-allowed", "old user cannot open Sports Pack");
  r = await j("/xtream/l/sports-pack/player_api.php?username=sam&password=sam-pass-1&action=get_live_streams");
  check(r.s === 200 && r.b.length === 4 && r.b.every((s) => s.direct_source === ""), "sam sees the 4 live channels of Sports Pack, no source address");
  const cats = (await j("/xtream/l/sports-pack/player_api.php?username=sam&password=sam-pass-1&action=get_live_categories")).b;
  const sportsCat = cats.find((c) => c.category_name === "Sports");
  r = await j(`/xtream/l/sports-pack/player_api.php?username=sam&password=sam-pass-1&action=get_live_streams&category_id=${sportsCat.category_id}`);
  check(r.b.length === 3, "category filter (string id from the player) finds 3 sports channels");
  r = await j("/xtream/player_api.php?username=sam&password=sam-pass-1");
  check(r.s === 401, "sam cannot open the Default list");
  const live = (await j("/xtream/l/sports-pack/player_api.php?username=sam&password=sam-pass-1&action=get_live_streams")).b[0];
  r = await j(`/xtream/l/sports-pack/live/sam/sam-pass-1/${live.stream_id}.ts`);
  check(r.s === 302 && r.loc === "https://cdn.example.com/sport1/index.m3u8", "stream address redirects to the source: " + r.loc);
  r = await j(`/xtream/l/sports-pack/live/sam/wrong/${live.stream_id}.ts`);
  check(r.s === 403, "wrong password cannot play");
  r = await j(`/xtream/l/sports-pack/live/olduser/oldpass/${live.stream_id}.ts`);
  check(r.s === 403, "user without the list cannot play");
  r = await j("/xtream/l/sports-pack/get.php?username=both&password=both-pass&type=m3u_plus&output=ts");
  check(r.s === 200 && /#EXTM3U/.test(r.b) && (r.b.match(/#EXTINF/g) || []).length === 5 && r.b.includes("/xtream/l/sports-pack/movie/both/both-pass/"), "M3U playlist: 4 channels + 1 movie, our addresses");
  r = await j("/xtream/l/sports-pack/player_api.php?username=both&password=both-pass&action=get_vod_streams");
  const vod = r.b[0];
  r = await j(`/xtream/l/sports-pack/player_api.php?username=both&password=both-pass&action=get_vod_info&vod_id=${vod.stream_id}`);
  check(r.b.movie_data && r.b.movie_data.stream_id === vod.stream_id && r.b.movie_data.container_extension === "mp4", "get_vod_info");
  r = await j("/xtream/player_api.php?username=expired&password=x1");
  check(r.s === 401 && r.b.user_info.status === "expired", "an expired user is refused");
  r = await j("/xtream/l/nope/player_api.php?username=both&password=both-pass");
  check(r.s === 401 && r.b.user_info.status === "list", "unknown list is refused");

  // turn the list off from the admin, then the link stops
  await page.click('[data-edit-list="sports-pack"]');
  await page.uncheck("#l-on");
  await page.click("#dlg-foot [data-primary]");
  await page.waitForSelector(".list-card >> text=Off");
  await new Promise((ok) => setTimeout(ok, 11000)); // server reads the list again after 10 s
  r = await j("/xtream/l/sports-pack/player_api.php?username=sam&password=sam-pass-1");
  check(r.s === 401 && r.b.user_info.status === "list", "a list turned off stops within 10 s");

  check(errors.filter((e) => !e.startsWith("alert")).length === 0, "no page errors " + errors.join(" | "));
  await browser.close();
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
