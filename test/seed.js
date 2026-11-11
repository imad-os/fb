// Fills the LOCAL emulators (demo-iptv) with data shaped like the old version (no list_id, users without lists).
// Run: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node test/seed.js
"use strict";
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error("Emulator only: set FIRESTORE_EMULATOR_HOST"); process.exit(1); }
const req = require("module").createRequire(require("path").join(__dirname, "../functions/index.js"));
const { initializeApp } = req("firebase-admin/app");
const { getFirestore } = req("firebase-admin/firestore");
const { getAuth } = req("firebase-admin/auth");
initializeApp({ projectId: "demo-iptv" });
const db = getFirestore();
(async () => {
  let u;
  try { u = await getAuth().createUser({ email: "admin@test.local", password: "admin123" }); }
  catch (e) { u = await getAuth().getUserByEmail("admin@test.local"); }
  await db.doc("xtream_admins/" + u.uid).set({ email: "admin@test.local" });
  const old = [
    ["xtream_categories", { type: "live", category_id: 1, category_name: "News", parent_id: 0 }],
    ["xtream_categories", { type: "vod", category_id: 2, category_name: "Action", parent_id: 0 }],
    ["xtream_streams", { type: "live", stream_id: 101, name: "Old News HD", category_id: 1, direct_source: "https://example.com/news.m3u8", stream_icon: "" }],
    ["xtream_streams", { type: "vod", stream_id: 102, name: "Old Movie (2020)", category_id: 2, direct_source: "https://example.com/movie.mp4", container_extension: "mp4" }],
    ["xtream_users", { username: "olduser", password: "oldpass", status: "Active", max_connections: 1, exp_date: null }],
    ["xtream_users", { username: "expired", password: "x1", status: "Active", exp_date: 1600000000 }]
  ];
  for (const [c, d] of old) await db.collection(c).add(d);
  console.log("seeded, admin uid", u.uid);
})();
