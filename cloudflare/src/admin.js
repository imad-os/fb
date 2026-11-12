// Admin API (/api/*) for docs/index.html. Sign-in: admins in D1, PBKDF2 passwords, bearer session tokens.
import { json, str, num, now, sha256, randomToken, b64url, same, LIST_ID_RE, extOf } from "./util.js";
import { checkStreams } from "./check.js";
import { footballKeysApi } from "./football_keys.js";
import { subtitlesApi } from "./subtitles/index.js";
import { scrapersApi, scrapeSettingsApi, proxyFetch } from "./scrapers.js";

const ITER = 20000;            // PBKDF2 rounds (kept low enough for the 10 ms CPU of the free Workers plan)
const SESSION_DAYS = 30;
const MAX_FAILS = 8;           // wrong passwords per email before a 15 min pause
const TYPES = ["live", "vod", "series", "episode"];
const CAT_TYPES = ["live", "vod", "series"];

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };

async function hashPassword(password, salt, iter = ITER) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: iter }, key, 256);
  return b64url(bits);
}

async function newSession(env, adminId) {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (token_hash, admin_id, expires) VALUES (?, ?, ?)").bind(await sha256(token), adminId, now() + SESSION_DAYS * 86400).run();
  await env.DB.prepare("DELETE FROM sessions WHERE expires < ?").bind(now()).run();
  return token;
}

async function currentAdmin(env, request) {
  const h = request.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return null;
  return env.DB.prepare("SELECT a.id, a.email, s.token_hash FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires > ?")
    .bind(await sha256(token), now()).first();
}

const bump = (env, listId) => env.DB.prepare("UPDATE lists SET rev = rev + 1, updated = unixepoch() WHERE id = ?").bind(listId);

function cleanPass(s, what) {
  s = str(s).trim();
  if (!s || s.length > 64 || /[\s/]/.test(s)) bad(`${what}: 1 to 64 characters, no spaces or /`);
  return s;
}

async function body(request) { try { return await request.json(); } catch (e) { return {}; } }

// ------------------------------------------------------------------ routes

export async function handleAdmin(request, env, url) {
  try {
    return await route(request, env, url);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (/UNIQUE constraint failed: users.username/.test(e.message)) return json({ error: "This username is taken" }, 409);
    if (/UNIQUE constraint failed: lists.id|PRIMARY KEY.*lists/.test(e.message)) return json({ error: "A list with this link name already exists" }, 409);
    console.error(e);
    return json({ error: "Server error" }, 500);
  }
}

async function route(request, env, url) {
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [res, id] = parts;
  const m = request.method;

  // ---- open routes
  if (res === "status" && m === "GET") {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM admins").first("n");
    return json({ ok: true, hasAdmin: n > 0, setup: !!env.SETUP_KEY });
  }
  if (res === "setup" && m === "POST") {
    const b = await body(request);
    if (!env.SETUP_KEY || !same(b.key, env.SETUP_KEY)) bad("Wrong setup key", 403);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM admins").first("n");
    if (n > 0) bad("An admin already exists: sign in", 409);
    return json(await createAdmin(env, b.email, b.password, true));
  }
  if (res === "login" && m === "POST") {
    const b = await body(request);
    const email = str(b.email).trim().toLowerCase();
    const failKey = "fail:" + email;
    const f = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(failKey).first("value");
    const fail = f ? JSON.parse(f) : { n: 0, at: 0 };
    if (fail.n >= MAX_FAILS && now() - fail.at < 900) bad("Too many wrong passwords: wait 15 minutes", 429);
    const a = await env.DB.prepare("SELECT * FROM admins WHERE email = ?").bind(email).first();
    const ok = a && same(await hashPassword(str(b.password), a.salt, a.iter), a.pass_hash);
    if (!ok) {
      const n = fail.n >= MAX_FAILS ? 1 : fail.n + 1;
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(failKey, JSON.stringify({ n, at: now() })).run();
      bad("Wrong email or password", 401);
    }
    await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(failKey).run();
    return json({ token: await newSession(env, a.id), email: a.email });
  }

  // ---- signed in from here
  const me = await currentAdmin(env, request);
  if (!me) bad("Sign in again", 401);

  if (res === "me") return json({ email: me.email });
  if (res === "logout") { await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(me.token_hash).run(); return json({ ok: true }); }
  if (res === "password" && m === "POST") {
    const b = await body(request);
    const a = await env.DB.prepare("SELECT * FROM admins WHERE id = ?").bind(me.id).first();
    if (!same(await hashPassword(str(b.old), a.salt, a.iter), a.pass_hash)) bad("The current password is wrong", 403);
    if (str(b.new).length < 8) bad("At least 8 characters");
    const salt = randomToken(16);
    await env.DB.batch([
      env.DB.prepare("UPDATE admins SET pass_hash = ?, salt = ?, iter = ? WHERE id = ?").bind(await hashPassword(str(b.new), salt), salt, ITER, me.id),
      env.DB.prepare("DELETE FROM sessions WHERE admin_id = ? AND token_hash != ?").bind(me.id, me.token_hash)
    ]);
    return json({ ok: true });
  }
  if (res === "admins") {
    if (m === "GET") return json((await env.DB.prepare("SELECT id, email, created FROM admins ORDER BY id").all()).results);
    if (m === "POST") { const b = await body(request); const r = await createAdmin(env, b.email, b.password, false); return json({ ok: true, email: r.email }); }
    if (m === "DELETE" && id) {
      if (num(id) === me.id) bad("You cannot remove yourself");
      await env.DB.prepare("DELETE FROM admins WHERE id = ?").bind(num(id)).run();
      return json({ ok: true });
    }
  }

  if (res === "settings") {
    if (m === "GET") {
      const r = await env.DB.prepare("SELECT key, value FROM settings WHERE key NOT LIKE 'fail:%'").all();
      return json(Object.fromEntries(r.results.map((x) => [x.key, x.value])));
    }
    if (m === "PUT") {
      const b = await body(request);
      const base = str(b.base_url).trim().replace(/\/+$/, "");
      if (base && !/^https?:\/\/[^/\s]+$/.test(base)) bad("Only the address, like https://tv.example.com");
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('base_url', ?)").bind(base).run();
      return json({ ok: true });
    }
  }

  if (res === "lists") return lists(env, m, id, request);
  if (res === "users") return users(env, m, id, request);
  if (res === "categories") return cats(env, m, id, request, url);
  if (res === "streams") return streams(env, m, id, request, url);
  if (res === "subtitles" || res === "subtitle-keys" || res === "subtitles-test") return subtitlesApi(env, m, parts, request, bad);
  if (res === "scrapers") return scrapersApi(env, m, parts, request, bad);
  if (res === "scrape-settings" || res === "scrape-claim") return scrapeSettingsApi(env, m, res, request, bad);
  // Scrapers: the admin page reads match sites through this when no proxy is set (they send no CORS headers).
  if (res === "fetch" && m === "GET") return proxyFetch(url, bad);
  if (res === "football-keys") return footballKeysApi(env, m, id, parts[2], request, bad);
  if (res === "import" && m === "POST") return importM3u(env, await body(request));
  // Stream check (admin page "Check streams"): up to 25 ids per request.
  if (res === "check" && m === "POST") return json(await checkStreams(env, (await body(request)).ids));
  // Turn many streams on or off at once: { ids: [...], enabled: true|false }. Players stop/start seeing them at once.
  if (res === "streams-state" && m === "POST") {
    const b = await body(request);
    const ids = JSON.stringify((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 5000));
    const r = await env.DB.batch([
      env.DB.prepare("UPDATE streams SET enabled = ? WHERE id IN (SELECT value FROM json_each(?))").bind(b.enabled === false ? 0 : 1, ids),
      env.DB.prepare("UPDATE lists SET rev = rev + 1, updated = unixepoch() WHERE id IN (SELECT DISTINCT list_id FROM streams WHERE id IN (SELECT value FROM json_each(?)))").bind(ids)
    ]);
    return json({ ok: true, changed: r[0].meta.changes });
  }
  bad("Not found", 404);
}

async function createAdmin(env, email, password, login) {
  email = str(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) bad("Enter an email address");
  if (str(password).length < 8) bad("The password needs at least 8 characters");
  const salt = randomToken(16);
  const r = await env.DB.prepare("INSERT INTO admins (email, pass_hash, salt, iter) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(email, await hashPassword(str(password), salt), salt, ITER).first().catch((e) => {
      if (/UNIQUE/.test(e.message)) bad("This email is already an admin", 409); throw e;
    });
  return login ? { token: await newSession(env, r.id), email } : { email };
}

// ---- lists
async function lists(env, m, id, request) {
  if (m === "GET") {
    const r = await env.DB.prepare(`SELECT l.*,
      (SELECT COUNT(*) FROM streams s WHERE s.list_id = l.id AND s.type = 'live') AS live,
      (SELECT COUNT(*) FROM streams s WHERE s.list_id = l.id AND s.type = 'vod') AS vod,
      (SELECT COUNT(*) FROM streams s WHERE s.list_id = l.id AND s.type = 'series') AS series,
      (SELECT COUNT(*) FROM streams s WHERE s.list_id = l.id AND s.type = 'episode') AS episode,
      (SELECT COUNT(*) FROM categories c WHERE c.list_id = l.id) AS cats,
      (SELECT COUNT(*) FROM user_lists x WHERE x.list_id = l.id) AS users
      FROM lists l ORDER BY l.id = 'default' DESC, l.name`).all();
    return json(r.results.map((l) => ({ ...l, enabled: !!l.enabled })));
  }
  const b = m === "DELETE" ? {} : await body(request);
  const name = str(b.name).trim().slice(0, 60);
  if (m === "POST") {
    const lid = str(b.id).trim();
    if (!LIST_ID_RE.test(lid)) bad("Link name: lowercase letters, digits, - and _ only");
    if (!name) bad("Enter a name");
    await env.DB.prepare("INSERT INTO lists (id, name, note, enabled) VALUES (?, ?, ?, ?)").bind(lid, name, str(b.note).slice(0, 200), b.enabled === false ? 0 : 1).run();
    return json({ ok: true, id: lid });
  }
  if (m === "PUT" && id) {
    if (!name) bad("Enter a name");
    await env.DB.prepare("UPDATE lists SET name = ?, note = ?, enabled = ?, rev = rev + 1, updated = unixepoch() WHERE id = ?").bind(name, str(b.note).slice(0, 200), b.enabled === false ? 0 : 1, id).run();
    return json({ ok: true });
  }
  if (m === "DELETE" && id) {
    if (id === "default") bad("The Default list cannot be deleted");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM streams WHERE list_id = ?").bind(id),
      env.DB.prepare("DELETE FROM categories WHERE list_id = ?").bind(id),
      env.DB.prepare("DELETE FROM user_lists WHERE list_id = ?").bind(id),
      env.DB.prepare("DELETE FROM lists WHERE id = ?").bind(id)
    ]);
    return json({ ok: true });
  }
  bad("Not found", 404);
}

// ---- users
async function users(env, m, id, request) {
  if (m === "GET") {
    const r = await env.DB.prepare("SELECT u.*, (SELECT json_group_array(list_id) FROM user_lists x WHERE x.user_id = u.id) AS lists FROM users u ORDER BY u.username").all();
    return json(r.results.map((u) => ({ ...u, lists: JSON.parse(u.lists || "[]") })));
  }
  if (m === "DELETE" && id) {
    await env.DB.batch([env.DB.prepare("DELETE FROM user_lists WHERE user_id = ?").bind(num(id)), env.DB.prepare("DELETE FROM users WHERE id = ?").bind(num(id))]);
    return json({ ok: true });
  }
  const b = await body(request);
  const username = cleanPass(b.username, "Username"); const password = cleanPass(b.password, "Password");
  const status = b.status === "Disabled" ? "Disabled" : "Active";
  const exp = b.exp_date ? num(b.exp_date) || null : null;
  const maxc = Math.min(20, Math.max(1, num(b.max_connections, 1)));
  const listIds = (Array.isArray(b.lists) ? b.lists : []).map(String).filter((x) => LIST_ID_RE.test(x));
  let uid;
  if (m === "POST") {
    uid = (await env.DB.prepare("INSERT INTO users (username, password, status, exp_date, max_connections, note) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(username, password, status, exp, maxc, str(b.note).slice(0, 200)).first()).id;
  } else if (m === "PUT" && id) {
    uid = num(id);
    await env.DB.prepare("UPDATE users SET username = ?, password = ?, status = ?, exp_date = ?, max_connections = ?, note = ? WHERE id = ?")
      .bind(username, password, status, exp, maxc, str(b.note).slice(0, 200), uid).run();
  } else bad("Not found", 404);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_lists WHERE user_id = ?").bind(uid),
    env.DB.prepare("INSERT OR IGNORE INTO user_lists (user_id, list_id) SELECT ?, value FROM json_each(?) WHERE value IN (SELECT id FROM lists)").bind(uid, JSON.stringify(listIds))
  ]);
  return json(await env.DB.prepare("SELECT u.*, (SELECT json_group_array(list_id) FROM user_lists x WHERE x.user_id = u.id) AS lists FROM users u WHERE id = ?").bind(uid).first()
    .then((u) => ({ ...u, lists: JSON.parse(u.lists || "[]") })));
}

// ---- categories
async function cats(env, m, id, request, url) {
  if (m === "GET") {
    const list = url.searchParams.get("list") || "default";
    const r = await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM streams s WHERE s.list_id = c.list_id AND s.category_id = c.id AND s.type = c.type) AS streams
      FROM categories c WHERE c.list_id = ? ORDER BY c.type, c.ord, c.name`).bind(list).all();
    return json(r.results);
  }
  if (m === "DELETE" && id) {
    const c = await env.DB.prepare("SELECT * FROM categories WHERE id = ?").bind(num(id)).first();
    if (!c) bad("Not found", 404);
    await env.DB.batch([
      env.DB.prepare("UPDATE streams SET category_id = 0 WHERE list_id = ? AND category_id = ?").bind(c.list_id, c.id),
      env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(c.id), bump(env, c.list_id)
    ]);
    return json({ ok: true });
  }
  const b = await body(request);
  const name = str(b.name).trim().slice(0, 100); if (!name) bad("Enter a name");
  if (m === "POST") {
    if (!CAT_TYPES.includes(b.type)) bad("Wrong type");
    const r = await env.DB.prepare("INSERT INTO categories (list_id, type, name, ord) VALUES (?, ?, ?, ?) RETURNING id").bind(str(b.list_id), b.type, name, num(b.ord)).first();
    await bump(env, str(b.list_id)).run();
    return json({ ok: true, id: r.id });
  }
  if (m === "PUT" && id) {
    const c = await env.DB.prepare("SELECT list_id FROM categories WHERE id = ?").bind(num(id)).first();
    if (!c) bad("Not found", 404);
    await env.DB.batch([env.DB.prepare("UPDATE categories SET name = ?, ord = ? WHERE id = ?").bind(name, num(b.ord), num(id)), bump(env, c.list_id)]);
    return json({ ok: true });
  }
  bad("Not found", 404);
}

// ---- streams
const FIELDS = ["name", "source", "icon", "category_id", "num", "epg_id", "ext", "plot", "year", "rating", "genre", "tmdb_id", "series_id", "season", "episode"];
function streamData(b, type) {
  const d = {};
  for (const k of FIELDS) if (b[k] !== undefined) d[k] = b[k];
  d.name = str(d.name).trim().slice(0, 200); if (!d.name) bad("Enter a name");
  if (type !== "series") { d.source = str(d.source).trim(); if (!/^(https?|rtmp|rtsp|udp):\/\/\S+$/i.test(d.source)) bad("Enter the source address (http://...)"); }
  for (const k of ["category_id", "num", "series_id", "season", "episode"]) if (d[k] !== undefined && d[k] !== null && d[k] !== "") d[k] = num(d[k]); else if (k !== "category_id" && k !== "num") d[k] = null; else d[k] = 0;
  for (const k of ["icon", "epg_id", "plot", "year", "rating", "genre", "tmdb_id"]) d[k] = str(d[k]).slice(0, k === "plot" ? 4000 : 500);
  d.rating = d.rating || "0";
  d.ext = type === "live" ? "" : (extOf(d.source) || str(d.ext));
  if (b.enabled !== undefined) d.enabled = b.enabled === false ? 0 : 1;
  if (type === "episode" && !d.series_id) bad("Choose the series");
  return d;
}
async function streams(env, m, id, request, url) {
  if (m === "GET") {
    const list = url.searchParams.get("list") || "default"; const type = url.searchParams.get("type") || "live";
    const r = await env.DB.prepare("SELECT * FROM streams WHERE list_id = ? AND type = ? ORDER BY num, name").bind(list, type).all();
    return json(r.results);
  }
  if (m === "DELETE" && id) {
    const s = await env.DB.prepare("SELECT id, list_id, type FROM streams WHERE id = ?").bind(num(id)).first();
    if (!s) bad("Not found", 404);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM streams WHERE id = ? OR (type = 'episode' AND series_id = ? AND ? = 'series')").bind(s.id, s.id, s.type),
      bump(env, s.list_id)
    ]);
    return json({ ok: true });
  }
  const b = await body(request);
  if (m === "POST") {
    if (!TYPES.includes(b.type)) bad("Wrong type");
    const d = streamData(b, b.type);
    const cols = ["list_id", "type", ...Object.keys(d)];
    const r = await env.DB.prepare(`INSERT INTO streams (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")}) RETURNING id`).bind(str(b.list_id), b.type, ...Object.values(d)).first();
    await bump(env, str(b.list_id)).run();
    return json({ ok: true, id: r.id });
  }
  if (m === "PUT" && id) {
    const s = await env.DB.prepare("SELECT list_id, type FROM streams WHERE id = ?").bind(num(id)).first();
    if (!s) bad("Not found", 404);
    const d = streamData(b, s.type);
    await env.DB.batch([
      env.DB.prepare(`UPDATE streams SET ${Object.keys(d).map((k) => k + " = ?").join(", ")} WHERE id = ?`).bind(...Object.values(d), num(id)),
      bump(env, s.list_id)
    ]);
    return json({ ok: true });
  }
  bad("Not found", 404);
}

// ---- M3U import: one request = up to 1000 entries, two statements (categories, streams) thanks to json_each.
async function importM3u(env, b) {
  const list = str(b.list_id);
  if (!(await env.DB.prepare("SELECT 1 FROM lists WHERE id = ?").bind(list).first())) bad("Unknown list");
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 1000).map((i) => ({
    type: ["live", "vod"].includes(i.type) ? i.type : "live",
    name: str(i.name).slice(0, 200) || "Unknown", icon: str(i.logo).slice(0, 500), grp: b.groups ? str(i.group).slice(0, 100) : "",
    epg: str(i.epg).slice(0, 100), url: str(i.url).trim(), ext: extOf(i.url)
  })).filter((i) => /^(https?|rtmp|rtsp|udp):\/\/\S+$/i.test(i.url));
  if (!items.length) return json({ added: 0, cats: 0 });
  const j = JSON.stringify(items);
  const base = num(await env.DB.prepare("SELECT MAX(num) AS n FROM streams WHERE list_id = ?").bind(list).first("n"), 0);
  const res = await env.DB.batch([
    env.DB.prepare(`INSERT INTO categories (list_id, type, name)
      SELECT DISTINCT ?1, json_extract(value, '$.type'), json_extract(value, '$.grp') FROM json_each(?2)
      WHERE json_extract(value, '$.grp') != '' AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.list_id = ?1 AND c.type = json_extract(value, '$.type') AND c.name = json_extract(value, '$.grp'))`).bind(list, j),
    env.DB.prepare(`INSERT INTO streams (list_id, type, name, icon, epg_id, source, ext, num, category_id)
      SELECT ?1, json_extract(value, '$.type'), json_extract(value, '$.name'), json_extract(value, '$.icon'), json_extract(value, '$.epg'),
        json_extract(value, '$.url'), CASE WHEN json_extract(value, '$.type') = 'live' THEN '' ELSE json_extract(value, '$.ext') END, ?3 + key + 1,
        COALESCE((SELECT c.id FROM categories c WHERE c.list_id = ?1 AND c.type = json_extract(value, '$.type') AND c.name = json_extract(value, '$.grp')), 0)
      FROM json_each(?2) WHERE ?4 = 0 OR NOT EXISTS (SELECT 1 FROM streams s WHERE s.list_id = ?1 AND s.source = json_extract(value, '$.url'))`).bind(list, j, base, b.skip === false ? 0 : 1),
    bump(env, list)
  ]);
  return json({ added: res[1].meta.changes, cats: res[0].meta.changes });
}
