// scripts/check-auth-action.js
const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "..", "app", "out");
const redirects = path.join(outDir, "_redirects");
const authHtml = path.join(outDir, "auth", "action.html");

function die(msg) {
  console.error("[check-auth-action] ❌ " + msg);
  process.exit(1);
}

if (!fs.existsSync(outDir)) {
  die("app/out does not exist. Run `cd app && npm run build` first.");
}

if (!fs.existsSync(redirects)) {
  die("_redirects missing in app/out. Auth routes will 404.");
}

if (!fs.existsSync(authHtml)) {
  die("auth/action.html missing in app/out. Firebase verify/reset links will 404.");
}

console.log("[check-auth-action] ✅ all auth artifacts present.");

