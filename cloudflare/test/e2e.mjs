// End-to-end test: a local Worker (wrangler dev + local D1) and the admin page in Chromium.
//   npm test            (SHOTS=<folder> saves screenshots)
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, rm, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STATE = path.join(ROOT, ".wrangler", "e2e");
const API = "http://127.0.0.1:8787", ADMIN = "http://127.0.0.1:8000";
const SHOTS = process.env.SHOTS || "";
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };

// --- start the Worker on an empty database
await rm(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply iptv --local --persist-to ${STATE}`, { cwd: ROOT, stdio: "ignore", env: { ...process.env, CI: "1" } });
const wr = spawn("npx", ["wrangler", "dev", "--port", "8787", "--ip", "127.0.0.1", "--persist-to", STATE, "--var", "SETUP_KEY:test-setup-key"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = ""; wr.stdout.on("data", (d) => log += d); wr.stderr.on("data", (d) => log += d);
for (let i = 0; i < 60; i++) { try { await fetch(API + "/"); break; } catch (e) { await new Promise((r) => setTimeout(r, 500)); } }

// --- serve the admin page (like GitHub Pages)
const srv = createServer(async (req, res) => {
  const p = new URL(req.url, ADMIN).pathname; const f = path.join(ROOT, "admin", p === "/" ? "index.html" : p);
  try { const b = await readFile(f); res.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" }); res.end(b); }
  catch (e) { res.writeHead(404); res.end(); }
}).listen(8000, "127.0.0.1");

const browser = await chromium.launch();
const done = async () => { await browser.close(); srv.close(); try { process.kill(-wr.pid); } catch (e) {} };
try {
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => ok(false, "page error " + e.message));
  const dlgBtn = (t) => page.locator("#dlg-foot button", { hasText: t }).click();
  const closeDlg = async () => { await page.click("#dlg-x"); await page.waitForSelector("#dlg:not([open])", { state: "attached" }); };

  console.log("Sign-in");
  await page.goto(ADMIN);
  await page.fill("#api", API); await page.locator("#api").dispatchEvent("change");
  await page.waitForSelector("#f-key:not([hidden])");
  ok(await page.textContent("#login-title") === "Create the first admin", "setup mode when no admin");
  await shot(page, "01-setup");
  await page.fill("#setup-key", "wrong-key"); await page.fill("#email", "admin@test.local"); await page.fill("#password", "admin12345");
  await page.click("#login-btn");
  await page.waitForFunction(() => document.querySelector("#login-err").textContent);
  ok(!(await page.isVisible("#app")), "wrong setup key refused");
  await page.fill("#setup-key", "test-setup-key"); await page.click("#login-btn");
  await page.waitForSelector("#app:not([hidden])");
  ok(await page.textContent("#who") === "admin@test.local", "first admin created and signed in");
  const st = await (await fetch(API + "/api/status")).json();
  ok(st.hasAdmin && !st.setup === false || st.hasAdmin, "status says an admin exists");
  const again = await fetch(API + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "test-setup-key", email: "x@y.z", password: "12345678" }) });
  ok(again.status >= 400, "setup refused once an admin exists");

  console.log("Lists");
  await page.click("a[data-page=lists]"); await page.waitForSelector("#add-list");
  await page.click("#add-list"); await page.fill("#l-name", "Sports"); ok(await page.inputValue("#l-id") === "sports", "link name from the list name");
  await dlgBtn("Create list"); await page.waitForSelector(".list-card:has-text('Sports')");
  ok((await page.locator(".list-card").count()) === 2, "two lists");
  ok(await page.inputValue("#list-select") === "sports", "new list is the current one");

  console.log("Import M3U into Sports");
  await page.click("a[data-page=streams]"); await page.waitForSelector("#import");
  await page.click("#import");
  await page.fill("#m-text", `#EXTM3U
#EXTINF:-1 tvg-id="bein1" tvg-logo="https://example.com/b1.png" group-title="Football",Sport One HD
https://src.example.com/live/sport1.m3u8
#EXTINF:-1 group-title="Football",Sport Two
https://src.example.com/live/sport2.ts
#EXTINF:-1 group-title="News",News 24
https://src.example.com/live/news.m3u8
#EXTINF:-1 group-title="Films",Big Movie
https://src.example.com/movie/big.mp4
#EXTINF:-1 group-title="News",Dup
https://src.example.com/live/news.m3u8`);
  await dlgBtn("Import"); await page.waitForSelector("#dlg:not([open])", { state: "attached" });
  await page.waitForSelector("td .name:has-text('Sport One HD')");
  ok((await page.locator("tbody tr").count()) === 3, "3 live channels (duplicate skipped)");
  await shot(page, "02-streams");
  await page.click("[data-type=vod]"); await page.waitForSelector("td .name:has-text('Big Movie')");
  ok(true, "movie guessed from .mp4");
  await page.click("#import"); await page.fill("#m-text", "#EXTM3U\n#EXTINF:-1 group-title=\"News\",News 24\nhttps://src.example.com/live/news.m3u8\n");
  await dlgBtn("Import"); await page.waitForSelector("#dlg:not([open])", { state: "attached" });
  await page.click("[data-type=live]"); await page.waitForSelector("td .name:has-text('News 24')");
  ok((await page.locator("tbody tr").count()) === 3, "re-import skips addresses already there");

  console.log("Series + episode");
  await page.click("[data-type=series]"); await page.click("#add-stream");
  await page.fill("#s-name", "My Show"); await dlgBtn("Add"); await page.waitForSelector("td .name:has-text('My Show')");
  await page.click("[data-type=episode]"); await page.click("#add-stream");
  await page.selectOption("#s-series", { label: "My Show" }); await page.fill("#s-name", "Pilot"); await page.fill("#s-src", "https://src.example.com/series/pilot.mkv");
  await dlgBtn("Add"); await page.waitForSelector("td .name:has-text('Pilot')");
  ok(true, "series and episode added");

  console.log("Categories");
  await page.click("a[data-page=categories]"); await page.waitForSelector("td.name:has-text('Football')");
  ok((await page.locator("tbody tr").count()) === 2, "Football + News created by the import");

  console.log("Users");
  await page.click("a[data-page=users]"); await page.waitForSelector("#add-user");
  await page.click("#add-user"); await page.fill("#u-name", "ali"); await page.fill("#u-pass", "pw123");
  await dlgBtn("Create user");
  await page.waitForSelector("#dlg-title:has-text('Links for ali')");
  const share = await page.textContent("pre.share");
  ok(share.includes("Server: " + API + "\n") && share.includes("pw123"), "one-list user gets the plain root server");
  await shot(page, "03-share");
  await closeDlg();
  await page.click("#add-user"); await page.fill("#u-name", "omar"); await page.fill("#u-pass", "pw456");
  await page.uncheck("input[name=u-list][value=sports]"); await page.check("input[name=u-list][value=default]");
  await dlgBtn("Create user"); await page.waitForSelector("#dlg-title:has-text('Links for omar')"); await closeDlg();
  await page.click("#add-user"); await page.fill("#u-name", "old"); await page.fill("#u-pass", "pw789"); await page.fill("#u-exp", "2020-01-01");
  await dlgBtn("Create user"); await page.waitForSelector("#dlg-title:has-text('Links for old')"); await closeDlg();
  await page.click("[data-all='1']"); await page.waitForSelector("td .name:has-text('omar')");
  ok((await page.locator("tbody tr").count()) === 3, "all users listed");
  ok(await page.locator("tr:has-text('old') .badge.warn").count() === 1, "expired user flagged");
  await shot(page, "04-users");

  console.log("Links page");
  await page.click("a[data-page=links]"); await page.selectOption("#lu", { label: "ali" });
  await page.waitForSelector("pre.share");
  await shot(page, "05-links");

  console.log("Xtream server");
  const X = API + "/xtream/l/sports";
  const j = async (u) => (await fetch(u)).json();
  const info = await j(`${X}/player_api.php?username=ali&password=pw123`);
  ok(info.user_info && info.user_info.auth === 1 && info.server_info.port === "8787", "ali signs in to sports");
  ok((await j(`${X}/player_api.php?username=ali&password=bad`)).user_info.auth === 0, "wrong password refused");
  ok((await j(`${X}/player_api.php?username=omar&password=pw456`)).user_info.auth === 0, "omar has no sports access");
  ok((await j(`${API}/xtream/player_api.php?username=omar&password=pw456`)).user_info.auth === 1, "omar gets the default list via /xtream");
  ok((await j(`${X}/player_api.php?username=old&password=pw789`)).user_info.auth === 0, "expired user refused");
  const cats = await j(`${X}/player_api.php?username=ali&password=pw123&action=get_live_categories`);
  ok(cats.length === 2 && cats.some((c) => c.category_name === "Football"), "live categories");
  const live = await j(`${X}/player_api.php?username=ali&password=pw123&action=get_live_streams`);
  ok(live.length === 3 && live.some((s) => s.epg_channel_id === "bein1"), "live streams with EPG id");
  ok(!JSON.stringify(live).includes("src.example.com"), "source addresses hidden from players");
  const fb = cats.find((c) => c.category_name === "Football");
  ok((await j(`${X}/player_api.php?username=ali&password=pw123&action=get_live_streams&category_id=${fb.category_id}`)).length === 2, "filter by category");
  const vod = await j(`${X}/player_api.php?username=ali&password=pw123&action=get_vod_streams`);
  ok(vod.length === 1 && vod[0].container_extension === "mp4", "movies");
  const vi = await j(`${X}/player_api.php?username=ali&password=pw123&action=get_vod_info&vod_id=${vod[0].stream_id}`);
  ok(vi.movie_data && vi.movie_data.name === "Big Movie", "vod info");
  const ser = await j(`${X}/player_api.php?username=ali&password=pw123&action=get_series`);
  ok(ser.length === 1, "series");
  const si = await j(`${X}/player_api.php?username=ali&password=pw123&action=get_series_info&series_id=${ser[0].series_id}`);
  const eps = Object.values(si.episodes || {}).flat();
  ok(eps.length === 1 && eps[0].title === "Pilot" && eps[0].container_extension === "mkv", "series info with the episode");
  const sid = live.find((s) => s.name === "Sport One HD").stream_id;
  let r = await fetch(`${X}/live/ali/pw123/${sid}.m3u8`, { redirect: "manual" });
  ok(r.status === 302 && r.headers.get("location") === "https://src.example.com/live/sport1.m3u8", "live play redirects to the source");
  r = await fetch(`${X}/movie/ali/pw123/${vod[0].stream_id}.mp4`, { redirect: "manual" });
  ok(r.status === 302, "movie play redirects");
  r = await fetch(`${X}/series/ali/pw123/${eps[0].id}.mkv`, { redirect: "manual" });
  ok(r.status === 302 && r.headers.get("location").endsWith("pilot.mkv"), "episode play redirects");
  r = await fetch(`${X}/live/omar/pw456/${sid}.m3u8`, { redirect: "manual" });
  ok(r.status !== 302, "omar cannot play a sports channel");
  r = await fetch(`${API}/xtream/live/omar/pw456/${sid}.m3u8`, { redirect: "manual" });
  ok(r.status !== 302, "a sports channel is not reachable through the default list");
  const m3u = await (await fetch(`${X}/get.php?username=ali&password=pw123&type=m3u_plus&output=ts`)).text();
  ok(m3u.startsWith("#EXTM3U") && m3u.includes('group-title="Football"') && m3u.includes(`${X}/live/ali/pw123/${sid}.ts`) && m3u.includes("/movie/ali/pw123/"), "M3U playlist");
  ok(!m3u.includes("src.example.com"), "M3U hides sources");
  const m3u8 = await (await fetch(`${X}/get.php?username=ali&password=pw123&type=m3u_plus&output=m3u8`)).text();
  ok(m3u8.includes(`/live/ali/pw123/${sid}.m3u8`), "M3U (HLS) uses .m3u8");
  r = await fetch(`${X}/get.php?username=ali&password=bad`);
  ok(r.status === 401 || r.status === 403, "M3U refused with a wrong password");
  const xml = await (await fetch(`${X}/xmltv.php?username=ali&password=pw123`)).text();
  ok(xml.includes("<tv") && xml.includes('id="bein1"'), "XMLTV lists the channels");

  console.log("Standard root addresses");
  ok((await j(`${API}/player_api.php?username=ali&password=pw123`)).user_info.auth === 1, "root player_api.php: ali gets his only list");
  const rootLive = await j(`${API}/player_api.php?username=ali&password=pw123&action=get_live_streams`);
  ok(rootLive.length === 3, "root lists ali's sports channels");
  r = await fetch(`${API}/live/ali/pw123/${sid}.ts`, { redirect: "manual" });
  ok(r.status === 302, "root play address redirects");
  r = await fetch(`${API}/ali/pw123/${sid}`, { redirect: "manual" });
  ok(r.status === 302, "short play address redirects");
  ok((await (await fetch(`${API}/get.php?username=ali&password=pw123&type=m3u_plus&output=ts`)).text()).includes(`${API}/live/ali/pw123/${sid}.ts`), "root M3U uses root play addresses");
  ok((await j(`${API}/player_api.php?username=omar&password=pw456`)).user_info.auth === 1, "root: omar gets the default list");
  ok((await j(`${API}/player_api.php?username=omar&password=pw456&action=get_live_streams`)).length === 0, "root: omar sees no sports channels");
  r = await fetch(`${API}/live/omar/pw456/${sid}.ts`, { redirect: "manual" });
  ok(r.status !== 302, "root: omar cannot play a sports channel");
  ok((await j(`${API}/l/sports/player_api.php?username=ali&password=pw123`)).user_info.auth === 1, "/l/<list> without /xtream works");
  ok((await j(`${API}/player_api.php?username=old&password=pw789`)).user_info.auth === 0, "root: expired user refused");

  console.log("Turning a list off");
  await page.click("a[data-page=lists]"); await page.click("[data-edit-list=sports]");
  await page.uncheck("#l-on"); await dlgBtn("Save"); await page.waitForSelector(".list-card:has-text('Sports') .badge.err");
  ok((await j(`${X}/player_api.php?username=ali&password=pw123`)).user_info.auth === 0, "list off = links stop");
  await page.click("[data-edit-list=sports]"); await page.check("#l-on"); await dlgBtn("Save"); await page.waitForSelector(".list-card:has-text('Sports') .badge.ok");
  ok((await j(`${X}/player_api.php?username=ali&password=pw123`)).user_info.auth === 1, "list on again");
  await shot(page, "06-lists");

  console.log("Changes reach players at once");
  await page.click("a[data-page=streams]"); await page.click("[data-type=live]"); await page.waitForSelector("td .name:has-text('News 24')");
  await page.locator("tr:has-text('News 24') [data-del]").click(); await dlgBtn("Delete");
  await page.waitForSelector("td .name:has-text('News 24')", { state: "detached" });
  ok((await j(`${X}/player_api.php?username=ali&password=pw123&action=get_live_streams`)).length === 2, "deleted channel gone for players");

  console.log("Settings, sign out, sign in");
  await page.click("a[data-page=settings]"); await page.fill("#st-base", "https://tv.example.com"); await page.click("#st-save");
  await page.waitForSelector(".toast:has-text('Saved')");
  await page.click("a[data-page=links]"); await page.waitForSelector(".copy code");
  ok((await page.textContent(".copy code")) === "https://tv.example.com/l/sports", "links use the public address");
  await page.click("a[data-page=settings]"); await page.fill("#st-base", ""); await page.click("#st-save"); await page.waitForSelector(".toast:has-text('Saved')");
  await shot(page, "07-settings");
  await page.click("#btn-out"); await page.waitForSelector("#login:not([hidden])");
  ok(await page.textContent("#login-title") === "Stream Lists", "plain sign-in once an admin exists");
  await page.fill("#email", "admin@test.local"); await page.fill("#password", "wrongpass1"); await page.click("#login-btn");
  await page.waitForFunction(() => document.querySelector("#login-err").textContent);
  ok(!(await page.isVisible("#app")), "wrong password refused");
  await page.fill("#password", "admin12345"); await page.click("#login-btn"); await page.waitForSelector("#app:not([hidden])");
  ok(true, "signed in again");
  r = await fetch(API + "/api/users");
  ok(r.status === 401, "admin API needs a token");
  r = await fetch(API + "/api/users", { headers: { origin: "https://evil.example" } });
  ok(r.headers.get("access-control-allow-origin") !== "https://evil.example", "admin API not open to other sites");

  console.log("Subtitles test");
  await page.click("a[data-page=subtitles]"); await page.waitForSelector("#sb-go");
  ok((await page.textContent("#view")).includes("SubDL"), "providers listed");
  await page.fill("#sb-name", "Inception"); await page.fill("#sb-year", "2010"); await page.click("#sb-go");
  await page.waitForSelector("#sb-out:not([hidden])");
  ok((await page.textContent("#sb-out")).length > 20, "movie search shows a result per provider (offline here: their errors)");
  await page.click("[data-st=series]"); await page.waitForSelector("#sb-season");
  await page.fill("#sb-name", "My Show"); await page.fill("#sb-season", "2"); await page.fill("#sb-ep", "5"); await page.click("#sb-go");
  await page.waitForSelector("#sb-out:not([hidden])");
  ok(true, "series search runs");
  await shot(page, "10-subtitles");
  r = await fetch(API + "/api/subtitles-test", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  ok(r.status === 401, "subtitle test needs an admin");

  console.log("Scrapers (fake match sites of both templates)");
  {
    const A = "http://127.0.0.1:8002", B = "http://127.0.0.1:8003";
    const fx = { down: false, goodBroken: false };
    const match = (cls, a, b, href, time) => `<div class="AY_Match ${cls}"><a href="${href}" title="x"></a><div class="TM_Name">${a}</div><span class="MT_Time">${time}</span><div class="MT_Stat">Soon</div><div class="MT_Info"><ul><li><span>beIN 1</span></li></ul></div><div class="TM_Name">${b}</div></div>`;
    const send = (res, code, body, type = "text/html") => { res.writeHead(code, { "content-type": type }); res.end(body); };
    const stream = (p, res) => {
      if (p.pathname === "/live/bad.m3u8") return send(res, 200, "<html>blocked</html>"), true;
      if (p.pathname === "/live/moved.m3u8") { res.writeHead(302, { location: A + "/live/good/v.m3u8" }); res.end(); return true; }
      if (p.pathname === "/live/good/master.m3u8") return send(res, 200, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nv.m3u8\n", "application/vnd.apple.mpegurl"), true;
      if (p.pathname === "/live/good/v.m3u8") return send(res, 200, "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg0.ts\n", "application/vnd.apple.mpegurl"), true;
      if (p.pathname === "/live/good/seg0.ts") return (fx.goodBroken ? send(res, 200, "<html>ad</html>") : send(res, 200, Buffer.alloc(4096, 0x47), "video/mp2t")), true;
      return false;
    };
    // template A: albaplayer ?serv=N, player slug different from the page slug (read from the page's iframe)
    const siteA = createServer((req, res) => {
      const p = new URL(req.url, A);
      if (fx.down && (p.pathname === "/" || p.pathname.startsWith("/matches"))) return send(res, 500, "down");
      if (p.pathname === "/") return send(res, 200, match("live", "Raja", "Wydad", A + "/match/derby/", "21:00") + match("not_started", "Team &amp; Co", "Later FC", "#", "23:00") + match("finished", "Old", "Game", "/match/old/", "15:00"));
      if (p.pathname === "/matches-tomorrow") return send(res, 200, match("not_started", "Fus", "Far", "/match/tom/", "18:00"));
      if (p.pathname === "/match/derby/") return send(res, 200, `<iframe src="/albaplayer/bein-1/?serv=1"></iframe>`);
      if (p.pathname === "/match/tom/") return send(res, 200, `<p>no player iframe here</p>`);
      if (p.pathname === "/albaplayer/bein-1/") {
        if (p.searchParams.get("serv") === "2") return send(res, 200, `<script>var src="${A.replace(/\//g, "\\/")}\\/live\\/bad.m3u8";</script>`);
        if (p.searchParams.get("serv") === "1") return send(res, 200, `<a href="?serv=1">1</a><a href="?serv=2">2</a><iframe src="/embed/one"></iframe><iframe src="https://www.youtube.com/embed/x"></iframe>`);
        return send(res, 200, `<a href="?serv=1">1</a><a href="?serv=2">2</a>`);
      }
      if (p.pathname === "/embed/one") {
        if (req.headers.referer !== A + "/albaplayer/bein-1/?serv=1") return send(res, 403, "no referer");
        const hidden = `<script>player.load("${A}/live/good/master.m3u8")</script>`.split("").map((c) => "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
        return send(res, 200, `<script>document.write("${hidden}")</script>`);
      }
      if (p.pathname === "/albaplayer/tom/") return send(res, 200, `<iframe src="${A}/embed/two"></iframe>`);
      if (p.pathname === "/embed/two") return send(res, 200, `<script>src: 'http://localhost:8002/live/moved.m3u8'</script>`);
      if (stream(p, res)) return;
      send(res, 404, "nope");
    }).listen(8002, "127.0.0.1");
    // template B: the match page lists its servers (#match-player + data-src)
    const siteB = createServer((req, res) => {
      const p = new URL(req.url, B);
      if (p.pathname === "/") return send(res, 200, match("live", "Asfi", "Tanger", "/m/asfi-tanger/", "20:00"));
      if (p.pathname === "/m/asfi-tanger/") return send(res, 200, `<iframe id="match-player" src="/p/1"></iframe><a data-src="${B}/p/1">S1</a><a data-src="${B}/p/2">S2</a><a data-src="${B}/p/3">S3</a>`);
      if (p.pathname === "/p/1") return send(res, 200, `<iframe src="/p/1/inner"></iframe>`);
      if (p.pathname === "/p/1/inner") return send(res, 200, `<video src="${A}/live/good/master.m3u8"></video>`);
      if (p.pathname === "/p/2") return send(res, 200, `<script>hls.loadSource("${B}/live/bad.m3u8")</script>`);
      if (p.pathname === "/p/3") return send(res, 200, `<p>nothing</p>`);
      if (stream(p, res)) return;
      send(res, 404, "nope");
    }).listen(8003, "127.0.0.1");

    const tok = await page.evaluate(() => localStorage.getItem("xa_token"));
    const api = (p, o = {}) => fetch(API + "/api/" + p, { ...o, headers: { authorization: "Bearer " + tok, "content-type": "application/json" } }).then((x) => x.json());
    const catOf = async (name) => (await api("categories?list=sports")).filter((c) => c.name === name);
    const streamsOf = async (name) => { const ids = (await catOf(name)).map((c) => c.id); return (await api("streams?list=sports&type=live")).filter((s) => ids.includes(s.category_id)); };
    const waitDone = async () => {
      await page.waitForFunction(() => !Scr.running && /Done:|Stopped|ERROR/.test(Scr.log.map((x) => x[0]).join("\n")), null, { timeout: 90000 });
      await page.waitForSelector("[data-scr-run]:not([disabled])");
    };
    const runA = async () => { await page.locator("[data-scr-run]").first().click(); await waitDone(); };

    r = await fetch(API + "/api/fetch?url=" + encodeURIComponent(A + "/"));
    ok(r.status === 401, "the fetch proxy needs an admin");
    await page.click("a[data-page=scrapers]"); await page.waitForSelector("#scr-add");
    await page.selectOption("#scr-list", "sports"); await page.click("#scr-save"); await page.waitForSelector("#toasts .toast:has-text('Saved')");
    await page.click("#scr-add"); await page.fill("#sc-url", A); await page.check("#sc-tom");
    await dlgBtn("Add site"); await page.waitForSelector("[data-scr-run]");
    ok((await page.textContent("#view")).includes("Category: 127.0.0.1:8002"), "site added, category = its domain");
    await runA();
    let logText = await page.textContent("#scr-log");
    ok(/Raja vs Wydad serv1: OK/.test(logText) && /serv2: BAD not a playlist/.test(logText), "albaplayer: player read from the page's iframe, hidden (document.write) stream found; HTML playlist refused");
    ok(/redirects to another domain/.test(logText), "stream redirecting to another domain refused (player guessed from the slug)");
    ok(/no stream page yet/.test(logText) && /Old vs Game: finished, skipped/.test(logText), "match without a page and finished match skipped");
    let ss = await streamsOf("127.0.0.1:8002");
    ok(ss.length === 1 && ss[0].source === A + "/live/good/master.m3u8" && ss[0].name === "21:00 Raja vs Wydad serv1", "one working stream saved in the site's category (" + ss.map((s) => s.name).join(", ") + ")");
    await shot(page, "11-scrapers");
    await runA();
    ok((await catOf("127.0.0.1:8002")).length === 1 && (await streamsOf("127.0.0.1:8002")).length === 1, "second run replaces the category (no duplicates)");
    fx.down = true; await runA();
    ok((await page.textContent("#scr-log")).includes("did not answer") && (await streamsOf("127.0.0.1:8002")).length === 1, "site down: its streams are kept");
    fx.down = false; fx.goodBroken = true; await runA();
    ok((await catOf("127.0.0.1:8002")).length === 0, "no working stream any more: category removed");
    fx.goodBroken = false;

    console.log("Scrapers: second template + Run all");
    await page.click("#scr-add"); await page.fill("#sc-url", B); await dlgBtn("Add site"); await page.waitForSelector("text=Category: 127.0.0.1:8003");
    await page.click("#scr-all"); await waitDone();
    logText = await page.textContent("#scr-log");
    ok(/\(listed\)/.test(logText) && /Asfi vs Tanger serv1: OK/.test(logText) && /Asfi vs Tanger serv2: BAD/.test(logText) && /serv3: no stream found/.test(logText), "listed servers: iframe followed, bad one refused, empty one reported");
    ok((await streamsOf("127.0.0.1:8003")).length === 1 && (await streamsOf("127.0.0.1:8002")).length === 1, "Run all: both sites saved (same stream kept once per site)");

    console.log("Scrapers: schedule (runs in the open admin page)");
    await page.fill("#scr-time", "23:59"); await page.click("#scr-addt"); await page.waitForSelector('[data-scr-rmt="23:59"]');
    await page.fill("#scr-proxy", "http://127.0.0.1:11436/"); await page.click("#scr-save"); await page.waitForSelector("#toasts .toast:has-text('Saved')");
    let set = await api("scrape-settings");
    ok(set.times.includes("23:59") && set.list_id === "sports" && set.proxy === "http://127.0.0.1:11436/", "times, proxy and list saved in the database");
    await page.reload(); await page.waitForSelector("#scr-proxy");
    ok(await page.inputValue("#scr-proxy") === "http://127.0.0.1:11436/" && (await page.textContent("#view")).includes("23:59"), "shown again after a reload");
    r = await api("scrape-settings", { method: "PUT", body: JSON.stringify({ ...set, times: ["25:00"] }) });
    ok(/Times look like/.test(r.error || ""), "wrong time refused");
    // a time due now (set without the page, so it is not marked as already past)
    const nowHm = await page.evaluate(() => hm());
    await api("scrape-settings", { method: "PUT", body: JSON.stringify({ ...set, proxy: "", times: [nowHm] }) });
    const ran = () => page.evaluate(() => Scr.log.map((x) => x[0]).join("\n"));
    await page.evaluate(() => { Scr.setAt = 0; Scr.log = []; return scrTick(); });
    await page.waitForFunction(() => !Scr.running && /Done:/.test(Scr.log.map((x) => x[0]).join("\n")), null, { timeout: 90000 });
    ok(/Scheduled run \(/.test(await ran()) && /Done: 2 working streams from 2 of 2/.test(await ran()), "due time runs all the sites that are on");
    await page.evaluate(() => { Scr.setAt = 0; Scr.log = []; return scrTick(); });
    await page.waitForTimeout(500);
    ok((await ran()) === "", "a time runs once a day");
    const today = await page.evaluate(() => ymd());
    r = await api("scrape-claim", { method: "POST", body: JSON.stringify({ slot: today + " " + nowHm }) });
    ok(r.ok === false, "another open page or computer does not run the same time again");
    await api("scrape-settings", { method: "PUT", body: JSON.stringify({ ...set, proxy: "", times: [] }) });

    await page.click("a[data-page=lists]"); await page.click("a[data-page=scrapers]"); await page.waitForSelector("[data-scr-edit]");
    await page.locator("[data-scr-edit]").first().click(); await page.fill("#sc-name", "Yalla"); await dlgBtn("Save"); await page.waitForSelector("#view:has-text('Category: Yalla')");
    await runA();
    ok((await catOf("127.0.0.1:8002")).length === 0 && (await catOf("Yalla")).length === 1, "renamed: the old category is replaced by the new one");
    await page.locator("[data-scr-del]").first().click(); await page.waitForSelector("#scr-del-streams"); await dlgBtn("Delete");
    await page.waitForFunction(() => !document.querySelector("#view").textContent.includes("Category: Yalla"));
    ok((await catOf("Yalla")).length === 0, "deleting the site can delete its streams");
    siteA.close(); siteB.close();
  }

  console.log("Phone width");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const pp = await phone.newPage();
  await pp.addInitScript(([a, t]) => { localStorage.setItem("xa_api", a); localStorage.setItem("xa_token", t); localStorage.setItem("xa_list", "sports"); }, [API, await page.evaluate(() => localStorage.getItem("xa_token"))]);
  await pp.goto(ADMIN + "/#streams"); await pp.waitForSelector("td .name");
  const over = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 0, "no sideways scroll on a phone (" + over + ")");
  await shot(pp, "08-phone");
  await pp.click("a[data-page=links]"); await pp.selectOption("#lu", { label: "ali" }); await pp.waitForSelector("pre.share");
  ok(await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, "links page fits a phone");
  await shot(pp, "09-phone-links");
} catch (e) { console.error(e); fails++; console.error(log.slice(-3000)); }
await done();
console.log(fails ? `${fails} FAILED` : "All passed");
process.exit(fails ? 1 : 0);
