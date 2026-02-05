const fetch = require('node-fetch');
async function run(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body
  });
  const text = await res.text();
  return { status: res.status, body: text };
}
(async () => {
  const url = process.argv[2];
  const token = process.argv[3];
  const body = process.argv[4];
  const [r1, r2] = await Promise.all([run(url, token, body), run(url, token, body)]);
  console.log('RESPONSE 1:', JSON.stringify(r1));
  console.log('RESPONSE 2:', JSON.stringify(r2));
})();
