(function initComponentLoader() {
  async function loadComponent(target) {
    var src = target.getAttribute('data-component-src');
    if (!src) return;

    try {
      var response = await fetch(src, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var html = await response.text();
      target.outerHTML = html;
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
})();
