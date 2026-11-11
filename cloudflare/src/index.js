// Stream lists on Cloudflare Workers + D1.
//   /xtream/...            Xtream Codes server (players)
//   /api/...               admin API (the admin page on GitHub Pages)
//   /footballRequest ...   the helper APIs of the Firebase version, same paths
import { json } from "./util.js";
import { handleXtream } from "./xtream.js";
import { handleAdmin } from "./admin.js";
import { handleService, SERVICE_ROUTES } from "./services.js";

function cors(request, env, admin) {
  const origin = request.headers.get("origin") || "";
  let allow = "*";
  if (admin) {
    const list = String(env.ADMIN_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
    allow = list.includes("*") ? "*" : (list.includes(origin) ? origin : "null");
  }
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const first = url.pathname.split("/")[1] || "";
    const admin = first === "api";
    const h = cors(request, env, admin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });

    let res;
    try {
      if (admin) res = await handleAdmin(request, env, url);
      else if (first === "xtream") res = await handleXtream(request, env, ctx);
      else if (SERVICE_ROUTES.includes(first)) res = await handleService(first, request, env);
      else if (first === "") res = json({ name: "iptv-lists", ok: true });
      else res = json({ error: "Not found" }, 404);
    } catch (e) {
      console.error(e);
      res = json({ status: "error", message: "Server error" }, 500);
    }
    res = new Response(res.body, res);
    for (const [k, v] of Object.entries(h)) res.headers.set(k, v);
    return res;
  }
};
