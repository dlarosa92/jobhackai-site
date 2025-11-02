// tests/test-auth-flows.js
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

(async () => {
  const base = process.env.TEST_BASE || "https://dev.jobhackai.io";

  // 1. auth/action exists
  let res = await fetch(base + "/auth/action");
  const text1 = await res.text();
  assert(res.status === 200, "auth/action should return 200");
  assert(!text1.includes("This page could not be found"), "auth/action should not be Next.js 404");

  // 2. auth/action?mode=verifyEmail exists
  res = await fetch(base + "/auth/action?mode=verifyEmail&dummy=1");
  const text2 = await res.text();
  assert(res.status === 200, "verifyEmail route should return 200");
  assert(!text2.includes("This page could not be found"), "verifyEmail route should not be 404");

  // 3. login banner via query
  res = await fetch(base + "/login.html?plan=pro");
  const html = await res.text();
  assert(html.includes("Pro Plan") || html.includes("selected-plan-banner"), "login should render Pro Plan banner markup");

  console.log("✅ test-auth-flows.js passed");
})().catch((err) => {
  console.error("❌ test-auth-flows.js failed:", err);
  process.exit(1);
});

