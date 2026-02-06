(function initComponentLoader() {
  function getAppBaseUrl() {
    try {
      var hostname = (window.location && window.location.hostname ? window.location.hostname : '').toLowerCase();
      if (hostname === 'dev.jobhackai.io') return 'https://dev.jobhackai.io';
      if (hostname === 'qa.jobhackai.io') return 'https://qa.jobhackai.io';
    } catch (_) {}
    return 'https://app.jobhackai.io';
  }

  function applyEnvironmentAwareFooterLinks(root) {
    var scope = root || document;
    var appBaseUrl = getAppBaseUrl();
    var links = scope.querySelectorAll('.site-footer a[data-app-path]');

    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      var appPath = link.getAttribute('data-app-path');
      if (!appPath) continue;
      link.href = appBaseUrl + appPath;
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAllComponents, { once: true });
  } else {
    loadAllComponents();
  }

  window.JobHackAIComponents = window.JobHackAIComponents || {};
  window.JobHackAIComponents.loadAll = loadAllComponents;
  window.JobHackAIComponents.applyEnvironmentAwareFooterLinks = applyEnvironmentAwareFooterLinks;
})();
