# Stream Lists on Cloudflare (Workers + D1 + GitHub Pages)

A second, independent copy of the IPTV backend that runs on Cloudflare's **free plan** (no card needed),
next to the Firebase version in the rest of this repo (that one needs Firebase's paid Blaze plan to deploy).

| Part | Where it runs |
|---|---|
| Xtream Codes server, admin API, helper APIs | a **Cloudflare Worker** (`src/`) |
| Database (lists, users, streams, categories, admins) | **Cloudflare D1** (SQLite, `migrations/`) |
| Admin sign-in | built into the Worker: admin accounts in D1, PBKDF2 password hashes, session tokens |
| Admin page | **GitHub Pages** (`admin/`, one static file, published by `.github/workflows/cloudflare-admin-pages.yml`) |

The two versions do not share data. Users and streams you add here exist only here.

## Addresses

| Address | What it does |
|---|---|
| `/player_api.php?username=U&password=P[&action=...]` | **standard Xtream address** (server = the Worker's address): the user's own list (the `default` list if they have it, else their first list that is on) |
| `/get.php`, `/xmltv.php`, `/live/U/P/<id>.<ext>`, `/movie/...`, `/series/...`, `/U/P/<id>` | the same at the root |
| `/l/<list>/player_api.php?...` (and the rest under `/l/<list>/`) | one given list (server = `https://<worker>/l/<list>`) |
| `/xtream/l/<list>/player_api.php?username=U&password=P[&action=...]` | older form, still works |
| `/xtream/l/<list>/get.php?username=U&password=P&type=m3u_plus&output=ts` | M3U playlist (`output=m3u8` = HLS addresses) |
| `/xtream/l/<list>/xmltv.php?username=U&password=P` | XMLTV channel list (ids, names, logos; no programmes) |
| `/xtream/l/<list>/live/U/P/<id>.<ext>`, `/movie/...`, `/series/...` | play: checks the user, then **302** to the real source |
| `/xtream/...` (no `/l/<list>`) | older form: the `default` list |
| `/api/...` | admin API, used by the admin page (bearer token, only from `ADMIN_ORIGINS`) |
| `/footballRequest`, `/footballRecommendations`, `/footballNews`, `/getLocation`, `/fetchSubtitles`, `/downloadSubtitle`, `/searchTrailer`, `/getRecommendations` | same helper APIs and paths as the Firebase functions |

Xtream actions: `get_user_info` (no action), `get_live_categories`, `get_vod_categories`, `get_series_categories`,
`get_live_streams`, `get_vod_streams`, `get_series` (all with optional `category_id`), `get_vod_info&vod_id=`,
`get_series_info&series_id=`, `get_short_epg` (empty).

A user is refused when the password is wrong, the status is *Disabled*, the expiry date has passed, the list is not
ticked for them, or the list is turned off. Players never see the source addresses.

## Set it up (once)

You need Node 20+ and a free Cloudflare account. In a terminal, in this `cloudflare` folder:

```sh
npm install
npx wrangler login                       # opens the browser, allow access
npx wrangler d1 create iptv              # prints a database_id
```

1. Paste that `database_id` into `wrangler.toml` (replace the zeros).
2. In `wrangler.toml`, `ADMIN_ORIGINS` must contain your GitHub Pages address (already `https://imad-os.github.io`).
3. Create the tables and set the secrets:

```sh
npx wrangler d1 migrations apply iptv --remote
npx wrangler secret put SETUP_KEY        # any long random text; used once to create the first admin
npx wrangler secret put TMDB_API_KEY     # optional: trailers + recommendations
npx wrangler secret put YOUTUBE_API_KEY  # optional: trailer fallback
npx wrangler secret put FOOTBALL_KEYS    # optional: [{"url":"https://v3.football.api-sports.io","host":"v3.football.api-sports.io","key":"..."}]
# subtitles: no secret; add the providers' keys in the admin page > Subtitles
npx wrangler deploy                      # prints https://iptv-lists.<you>.workers.dev
```

4. Admin page: GitHub repo **Settings > Pages > Source: GitHub Actions**. Optionally add a repository
   **variable** `IPTV_API` = the Worker's address (Settings > Secrets and variables > Actions > Variables) so the
   sign-in page fills it in. Run the workflow "Admin page (GitHub Pages)" once (Actions tab) or push a change.
   The page is then at `https://imad-os.github.io/fb/` (GitHub Pages on a private repo needs a paid GitHub plan).
5. Open the page, type the Worker's address, the setup key, your email and a password: that creates the first admin.
   After that the setup key no longer works (more admins: Settings > Add an admin).

Optional, automatic Worker deploys: add a repository **secret** `CLOUDFLARE_API_TOKEN` (Cloudflare dashboard >
My Profile > API Tokens > "Edit Cloudflare Workers" template, plus D1 Edit; add `CLOUDFLARE_ACCOUNT_ID` to the workflow's
env if the token sees several accounts). Then every push that changes `cloudflare/src`, `migrations` or `wrangler.toml`
applies new migrations and deploys.

### Your own domain
Workers > iptv-lists > Settings > Domains & Routes > add e.g. `tv.example.com`. Then put `https://tv.example.com` in
the admin's Settings > Public address, so the links given to users use it. On a custom domain big lists are also kept
in Cloudflare's cache (by list version), which saves D1 reads; on `*.workers.dev` the cache is off.

## Using the admin
- **Lists**: each list has its own streams, categories and link name (`/xtream/l/<name>`). Turning a list off stops all its links.
- **Users**: one account for all lists; tick the lists each user may watch. Expiry, status, max connections.
  After creating a user, a dialog shows their links and a ready-made message to send.
- **Streams**: Live TV, Movies, Series, Episodes; **Import M3U** (file or paste, categories from `group-title`,
  duplicates skipped, 500 per request).
- **Check streams** (Streams page, "Check all" / "Check N" = what the filters show): the Worker opens each source,
  reads only the reply headers (no video) and closes it; 25 streams per request, 8 requests at a time from the page,
  down ones are checked twice. Then "Turn off N down" / "Turn on N working again". A turned-off stream is hidden from
  players but stays in the admin (filter "Turned off"; the power button turns one on/off). rtmp/rtsp/udp and bare-IP
  hosts cannot be checked from Cloudflare and are never turned off by the check.
- **Football API**: the keys used by `/footballRequest`, `/footballRecommendations` (D1 table `football_keys`).
  Add / edit / delete / turn on-off / reorder; **Test** asks the provider's `/status` (free, does not use your daily
  requests): plan and requests used today, or the error (suspended, not subscribed...). RapidAPI has no `/status`:
  its test shows "Key accepted" and the quota from its headers. Keys are tried in order; on an error or a limit the
  next one is used. "Calls" counts requests made through this Worker. While the table is empty the Worker uses the
  `FOOTBALL_KEYS` secret (the page offers to copy those keys in).
- **Subtitles**: `/fetchSubtitles` asks every provider that is on at the same time (Arabic first, then English, or
  `languages: "ar,en,fr"`), `/downloadSubtitle?url=<a result's url>` returns the file as UTF-8 text (zips opened,
  Windows-1256 / 1252 converted). One file per provider in `src/subtitles/` with the same functions
  (`search`, `download`, `test`): SubDL, SubSource, OpenSubtitles.com, Wyzie Subs, Jimaku (anime) need a free key;
  OpenSubtitles through Stremio's add-on and Gestdown (Addic7ed, TV) need none. Keys are in D1 (`subtitle_keys`),
  managed on the Subtitles page (add / edit / test / on-off, several keys per provider used in order), and never sent
  to players: results carry `sub:<provider>:<id>` tokens. The page also turns providers on/off, orders them and runs a
  test search with each provider's own answer or error.
- **Scrapers**: match sites of the Yalla Shoot family, D1 table `scrapers` (add / edit / delete; days: today always,
  tomorrow / yesterday optional; category = the domain unless you name it). **The runs happen in the admin page**
  (`admin/scraper/`), by hand (**Run**, **Run all**) or at the **daily times** saved on the page (settings row `scrape`:
  times, proxy, list), while the admin is open and signed in on any page; `/api/scrape-claim` makes sure a time runs once
  even with several pages open. A run reads each site's match list (finished matches skipped), each match page, its
  servers, follows iframes and `document.write` code up to 3 levels to the `.m3u8`, and keeps a stream only if the playlist
  answers 200, is real HLS (not HTML), does not redirect to another domain, and its first segment is not an HTML page.
  The streams that work then **replace** the site's Live category in the chosen list (`/api/scrapers/<id>/save`): a refresh.
  A site that does not answer keeps its streams; a site with no working stream loses its category. Sites are read through
  the proxy if one is set (`PROXY?url=<target>&referer=<ref>`, final address in `x-final-url`, e.g. a local one at
  `http://127.0.0.1:11436/`), else through the Worker (`GET /api/fetch?url=&referer=&range=`, admins only).
  **Site templates** (one file each, `admin/scraper/templates.js` explains the shape): list pages `lists/ay-match.js`
  (`AY_Match` blocks); match pages `players/listed.js` (servers listed on the page: `#match-player` + `data-src`) and
  `players/albaplayer.js` (`/albaplayer/<slug>/?serv=N`, player address taken from the page's iframe). A new kind of
  site = a new file + one line in `templates.js`.
- **Links for users**: server address, M3U, EPG, and per user the full message.
- **Settings**: public address, admins, change password.

Changes reach players at once (every change bumps the list's version).

## Free plan limits (good to know)
100,000 requests a day, 10 ms CPU per request, 5 GB of D1 storage, 5 million D1 row reads a day.
The admin's lockout: 8 wrong passwords for an email = 15 minutes wait.

## Develop and test locally

```sh
echo 'SETUP_KEY="test-setup-key"' > .dev.vars
npm run db:local && npm run dev          # Worker on http://127.0.0.1:8787
python3 -m http.server 8000 -d admin     # admin page on http://127.0.0.1:8000
npm test                                 # full browser test (Playwright), SHOTS=<folder> for screenshots
```

## Subtitles API for apps
- `GET /subtitleProviders` -> `{ status: "success", default: "<id>" | "auto", providers: [{ id, name, usable, kinds, langs? }] }` (providers that are on).
- `POST /fetchSubtitles/` `{ movieData: { name, tmdb_id?, year?, season?, episode_num? }, movieType: "movie" | "series", provider?: "<id>" | "auto", lang?: "ar" | "en" | ... | "auto" }`
  (missing = auto: the admin's default provider, or all that are on; languages ar then en).
  Success: `{ status: "success", provider, cached, subtitles: [{ label, name, lang, url, file, provider, ... }], errors? }` (an empty list is not an error).
- `GET /downloadSubtitle/?url=<a result's url>` -> the file as UTF-8 text (`X-Subtitle-Cache: hit | miss`).
- Errors (both): `{ status: "error", code, message }` with 400 `bad_request`, 404 `unknown_provider`, 429 `limit`, 502 `provider_error`
  (the provider's exact message), 503 `no_provider` / `provider_unavailable`.
- Cache in D1: result lists 24 h (2 h if empty; not kept when a provider failed), files 30 days. Usage per key and hour
  (`subtitle_usage`, 35 days) -> charts for 24 h / 7 d / 30 d on the admin's Subtitles page.