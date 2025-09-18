export const onRequestGet: PagesFunction = async ({ env }) => {
  const key = "hello";
  await env.KV.put(key, "world", { expirationTtl: 60 });
  const value = await env.KV.get(key);
  return new Response(JSON.stringify({ ok: true, value }), {
    headers: { "content-type": "application/json" },
  });
};
