const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../..');
const pricingHtml = fs.readFileSync(path.join(repositoryRoot, 'pricing.html'), 'utf8')
  // Keep the production inline checkout handler while preventing auth, analytics,
  // and third-party browser dependencies from loading in this offline fixture.
  .replace(/<script\b(?=[^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<link\b(?=[^>]*\bhref\s*=\s*["']https?:)[^>]*>/gi, '')
  .replace('</body>', '<script src="/js/stripe-integration.js"></script></body>');

const upgradeHtml = `<!doctype html><html><body>
  <button id="upgrade">Upgrade plan</button>
  <script src="/js/stripe-integration.js"></script>
  <script>document.getElementById('upgrade').addEventListener('click', function (event) {
    window.upgradePlan('monthly', { button: event.target, skipConfirmation: true });
  });</script>
</body></html>`;

const loginHtml = `<!doctype html><html><body><script>
  document.body.dataset.plan = new URLSearchParams(location.search).get('plan') || '';
</script></body></html>`;

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/pricing.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(pricingHtml);
    return;
  }
  if (pathname === '/upgrade.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(upgradeHtml);
    return;
  }
  if (pathname === '/js/stripe-integration.js') {
    response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    response.end(fs.readFileSync(path.join(repositoryRoot, pathname), 'utf8'));
    return;
  }
  if (pathname === '/login.html' || pathname === '/checkout.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(loginHtml);
    return;
  }
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
});

server.listen(4178, '127.0.0.1');
