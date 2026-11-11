# IPTV backend (Firebase project `iptv-8b60c`)

Cloud Functions (region `europe-west1`) + Firebase Hosting for the TV apps:

| Address (Hosting) | Function | What it does |
|---|---|---|
| `/admin.html` (and `/`) | (static) | **Stream Lists admin**: lists, users, streams, categories, links for users |
| `/xtream/...` | `xtreamRequest` | Xtream Codes compatible server on Firestore, several lists |
| `/footballRequest?endpoint=/fixtures&date=...` | `footballRequest` | API-Football proxy with key rotation (raw JSON) |
| `/footballRecommendations?country=&city=&continent=` | `footballRecommendations` | Today's matches that matter to the viewer |
| `/footballNews?langue=&country=&page=` | `footballNews` | Football news feed |
| `/getLocation?ip=` | `getLocation` | IP location (the caller's IP when none is given) |
| `/fetchSubtitles` (POST `{movieData, movieType}`) | `fetchSubtitles` | Arabic subtitles search |
| `/downloadSubtitle?url=` | `downloadSubtitle` | Subtitle file download (only from the subtitle service) |
| `/searchTrailer?movie_name=&year=&tmdb_id=&type=` | `searchTrailer` | Trailer + TMDB details |
| `/getRecommendations` (POST `{favorites, watched, returnmax, type}`) | `getRecommendations` | TMDB recommendations |

Every function is also reachable directly at `https://europe-west1-iptv-8b60c.cloudfunctions.net/<name>` (CORS open).

## Stream lists (Xtream server)

### Ideas
- A **list** is an independent catalog: its own channels, movies, series, episodes and categories, and its own address.
- A **user** (username + password) is one account for all lists; the admin ticks which lists each user may watch.
  The same account opens only the lists that are ticked.
- A user is refused when: wrong password, status *Disabled*, past the expiry date, the list is not ticked for them,
  or the list is turned off (Lists > Edit > "Users can watch this list").
- Players never see the real stream addresses: stream URLs go through the function, which checks the user every time
  and answers with a redirect (302) to the real source.

### Addresses to give users
For a list whose link name is `sports` (Admin > **Links for users** shows them all with Copy buttons and a ready message):

| What | Address |
|---|---|
| Xtream Codes server (IPTV Smarters, TiviMate, Speedy...) | `https://<host>/xtream/l/sports` + username + password |
| M3U playlist (live + movies) | `https://<host>/xtream/l/sports/get.php?username=U&password=P&type=m3u_plus&output=ts` |
| M3U, HLS | same with `output=m3u8` |
| Live channels only | same with `type=m3u` |
| EPG | `https://<host>/xtream/l/sports/xmltv.php?username=U&password=P` (empty for now) |

`<host>` = Admin > Settings > Public address (empty = the admin page's own address, e.g. `iptv-8b60c.web.app`).
The old address `https://<host>/xtream` (no `/l/...`) still works and means the **Default** list.

### API (what players call)
`<server>/player_api.php?username=&password=&action=...`
- no action: `user_info` + `server_info` (real host / port / protocol now, was `localhost:80`)
- `get_live_categories`, `get_vod_categories`, `get_series_categories`
- `get_live_streams`, `get_vod_streams`, `get_series` (optional `category_id`)
- `get_vod_info&vod_id=`, `get_series_info&series_id=` (seasons + episodes)
- `get_short_epg`, `get_simple_data_table`: empty `epg_listings`
- Streams: `<server>/live/U/P/<id>.ts|m3u8`, `<server>/movie/U/P/<id>.<ext>`, `<server>/series/U/P/<episode id>.<ext>`, `<server>/U/P/<id>` (short live form)
- Refused login: HTTP 401 with `{"user_info":{"auth":0,"status":"wrong|disabled|expired|not-allowed|list|missing"}}`

### Firestore data
| Collection | Fields |
|---|---|
| `xtream_lists/{linkName}` | `name`, `enabled`, `note`, `rev` (bumped by the admin on every change) |
| `xtream_users/{auto}` | `username`, `password`, `status` (`Active`/`Disabled`), `exp_date` (Unix seconds or null), `max_connections`, `lists: [linkName]`, `note`, `created_at` |
| `xtream_categories/{auto}` | `list_id`, `type` (`live`/`vod`/`series`), `category_id` (number), `category_name`, `order`, `parent_id` |
| `xtream_streams/{auto}` | `list_id`, `type` (`live`/`vod`/`series`/`episode`), `stream_id` (unique number), `name`, `direct_source`, `stream_icon`, `category_id`, `num` (order), `epg_channel_id` (live), `container_extension`, `plot`, `year`, `rating`, `tmdb_id`; episodes: `series_id`, `season_num`, `episode_num` |
| `xtream_meta/counters` | next `stream_id` / `category_id` (handed out in transactions, so ids never collide) |
| `xtream_meta/settings` | `base_url` |
| `xtream_meta/migration` | `lists_v1: true` once old data was moved into Default |
| `xtream_admins/{uid}` | marks an admin account (only with the new rules, below) |

**Speed / cost**: the function keeps each list's categories and streams in memory and reads them again only when the
list's `rev` changes (checked at most every 10 s) or after 5 min, so a player opening a big list costs a handful of
Firestore reads instead of one read per channel. A change in the admin reaches players within about 10 s.
The admin counts with aggregation queries (1 read per 1000 documents) and loads streams only for the page you open.

## Admin page (`public/admin.html`)
One file, no build, no Tailwind / icon CDN: Firebase JS SDK 12.6.0 (modular) from gstatic only.
- **Lists**: create (name + link name), turn on/off, delete (with all its streams and categories; type the link name to confirm).
- **Users**: per list or all; create with a random password, +1 / 3 / 6 months / 1 year / no end, tick lists; **Links** button = everything to send.
- **Streams**: Live TV / Movies / Series / Episodes tabs, category or series filter, search, 200 rows at a time.
- **Import M3U**: file or paste; categories from `group-title` are created; movies guessed by file type; already imported addresses skipped; batched writes (400 per commit).
- **Links for users**: the list's server address, M3U, EPG and, for one user, all their links + a message to copy.
- **Settings**: public address, your UID, reload.
On `localhost` the page talks to the local emulators only (project `demo-iptv`), never the real database.

## Deploying this version (once)
1. `firebase deploy --only hosting` (new admin page).
2. Open `/admin.html`, sign in: a yellow banner asks to **Move them now**: old streams, categories and users go into the
   **Default** list (old links keep working).
3. `firebase deploy --only functions`.
   Between 3 and 2 the old links would show empty lists, so do 2 right after 1 (or deploy everything and click at once).
4. Optional but recommended (security): the current database rules are not in this folder. `firestore.rules` closes the
   `xtream_*` collections to everyone except admins. Before publishing it: create `xtream_admins/<your UID>` (UID in
   Admin > Settings), and check no other app needs other collections (anything not listed there is closed).
   Then paste it in Firebase console > Firestore > Rules.

## Tests (local, no real database)
```
npm i -g firebase-tools          # once
cd functions && npm install && cd ..
firebase emulators:start --config firebase.emulators.json --project demo-iptv
# other terminal:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node test/seed.js
node test/e2e.js test/shots      # Playwright: admin flow + server checks, screenshots in test/shots
```
Sign in on http://127.0.0.1:5000/admin.html as `admin@test.local` / `admin123` (made by the seed).

## Fixed in this version
- Disabled and expired users could still sign in and play (status / `exp_date` were never checked).
- `category_id` sent by players (a string) never matched the stored number: category filters returned nothing.
- Series episodes (`/series/U/P/id`) could not play; `get_series_info` needed a missing index and returned `{}`.
- `get_vod_info` did not check the type and returned raw database fields; stream lists leaked `direct_source`.
- `server_info` said `localhost:80` (players that build URLs from it failed).
- Admin: names from M3U files were put in the page as HTML (a playlist could run script in the admin); random
  `stream_id`s could collide; imports wrote one document at a time; a whole collection was read on every click.
- `downloadSubtitle` fetched any URL (open proxy): now only the subtitle service.
- `getLocation` / `footballRecommendations` located Google's server instead of the viewer.
- `footballNews` errors crashed on an undefined variable; `footballRecommendations` crashed when the API answered
  without `errors` or a league had no country; favorite teams in friendlies were compared by name with ids.
- `getRecommendations` returned nothing when `returnmax` was not a number.
- Hosting rewrites now name the region (`europe-west1`), `maxInstances: 10` caps the bill if an endpoint is flooded.
- API keys can come from environment variables (`YOUTUBE_API_KEY`, `TMDB_API_KEY`); they are still in `config.js`
  as before: move them to Secret Manager when convenient, and rotate them if this repository was ever public.
- Removed `public/index.html` (old "Lite Football" page) and its `style.css`; `/` opens the admin.

## Not done (ideas)
- `max_connections` is stored and reported but not enforced (needs a live connection count).
- EPG is empty.
