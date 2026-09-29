(function initComponentLoader() {
  function getAppBaseUrl() {
    try {
      var hostname = (window.location && window.location.hostname ? window.location.hostname : '').toLowerCase();
      if (hostname === 'dev.jobhackai.io') return 'https://dev.jobhackai.io';
      if (hostname === 'qa.jobhackai.io' || hostname === 'qa-marketing.jobhackai.io' || hostname === 'develop.jobhackai-app-marketing-seo.pages.dev') return 'https://qa.jobhackai.io';
      if (!['jobhackai.io', 'www.jobhackai.io', 'app.jobhackai.io'].includes(hostname)) return 'https://dev.jobhackai.io';
    } catch (_) {}
    return 'https://app.jobhackai.io';
  }

  function applyEnvironmentAwareFooterLinks(root) {
    var scope = root || document;
    var appBaseUrl = getAppBaseUrl();
    // Static HTML remains usable by crawlers. Preview pages must also keep
    // hero, plan-card and article links out of production authentication/billing.
    var links = scope.querySelectorAll('a[data-app-path], a[href^="https://app.jobhackai.io/"]');

    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      var appPath = link.getAttribute('data-app-path');
      if (!appPath) {
        var destination = new URL(link.getAttribute('href'));
        appPath = destination.pathname + destination.search + destination.hash;
      }
      if (!appPath) continue;
      link.href = appBaseUrl + appPath;
    }

    // Keep marketing navigation on the QA site as well as app CTAs. Otherwise
    // an inline footer can send a test visitor into production analytics.
    var hostname = (window.location.hostname || '').toLowerCase();
    if (hostname === 'qa-marketing.jobhackai.io' || hostname === 'develop.jobhackai-app-marketing-seo.pages.dev') {
      var marketingLinks = scope.querySelectorAll('a[href]');
      for (var j = 0; j < marketingLinks.length; j += 1) {
        try {
          var marketingDestination = new URL(marketingLinks[j].getAttribute('href'), window.location.href);
          if ((marketingDestination.protocol === 'https:' || marketingDestination.protocol === 'http:') &&
              ['jobhackai.io', 'www.jobhackai.io'].includes(marketingDestination.hostname)) {
            marketingLinks[j].href = marketingDestination.pathname + marketingDestination.search + marketingDestination.hash;
          }
        } catch (_) { /* Leave malformed links unchanged without interrupting other links. */ }
      }
    }
  }

  async function loadComponent(target) {
    var src = target.getAttribute('data-component-src');
    if (!src) return;

    try {
      var response = await fetch(src, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var html = await response.text();
      target.outerHTML = html;
      applyEnvironmentAwareFooterLinks(document);
    } catch (error) {
      console.error('[components] Failed to load component:', src, error);
    }
  }

  async function loadAllComponents() {
    var targets = document.querySelectorAll('[data-component-src]');
    for (var i = 0; i < targets.length; i += 1) {
      await loadComponent(targets[i]);
    }
    // Apply environment-aware footer links even if no components were loaded
    // (e.g., when footer is inline instead of loaded via data-component-src)
    applyEnvironmentAwareFooterLinks(document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAllComponents, { once: true });
  } else {
    loadAllComponents();
  }

  window.getAppBaseUrl = getAppBaseUrl;

  window.JobHackAIComponents = window.JobHackAIComponents || {};
  window.JobHackAIComponents.loadAll = loadAllComponents;
  window.JobHackAIComponents.applyEnvironmentAwareFooterLinks = applyEnvironmentAwareFooterLinks;
})();
