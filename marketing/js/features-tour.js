/* Progressive enhancement for the public, illustrated product tour. */
(() => {
  const tour = document.querySelector('[data-product-tour]');
  if (!tour) return;

  // Clarity reads the document URL itself. Clean this public page before the
  // following deferred consent loader can start replay. Navigation's classic
  // script has already consumed any auth handoff; retain safe campaign tags.
  try {
    const current = new URL(window.location.href);
    const clean = new URL(current.origin + current.pathname);
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_id', 'utm_term']) {
      const value = current.searchParams.get(key);
      if (value && /^[a-z0-9_.-]{1,100}$/i.test(value)) clean.searchParams.set(key, value);
    }
    const staffTest = current.searchParams.get('jha_staff_test');
    if (staffTest === '0' || staffTest === '1') clean.searchParams.set('jha_staff_test', staffTest);
    const fragment = current.hash.slice(1);
    if (/^[a-z][a-z0-9-]*$/i.test(fragment) && document.getElementById(fragment)) clean.hash = fragment;
    if (current.href !== clean.href) history.replaceState(history.state, '', clean.href);
  } catch (_) {
    // A restricted history API must not make replay leak an unclean URL.
    window.JHA_CONFIG = { ...window.JHA_CONFIG, CLARITY_ID: '' };
  }

  // Track only deliberate, consented interactions. Never send example answers,
  // image URLs, or interactions that occurred before a consent decision.
  function track(name, params) {
    try {
      if (!window.JHA?.cookieConsent?.hasAnalyticsConsent?.()) return;
      window.JHA.trackEventSafe?.(name, params);
    } catch (_) { /* Measurement must not interrupt the tour. */ }
  }

  // Navigation renders asynchronously. Label its signup links for the same
  // delegated CTA tracker used by the page; a click is never a sign_up event.
  for (const navigation of document.querySelectorAll('.site-header, #mobileNav')) {
    const labelSignup = () => {
      navigation.querySelectorAll('[data-plan-id="free"]').forEach(link => {
        if (link.hasAttribute('data-cta')) return;
        link.dataset.cta = navigation.id === 'mobileNav' ? 'features-nav-free-mobile' : 'features-nav-free-desktop';
        link.dataset.plan = 'free';
      });
    };
    labelSignup();
    new MutationObserver(labelSignup).observe(navigation, { childList: true, subtree: true });
  }

  function initializeTabs(container, kind, initial, eventName) {
    if (!container) return;
    const tabs = [...container.querySelectorAll(`[data-${kind}-tab]`)];
    const panels = [...container.querySelectorAll(`[data-${kind}-panel]`)];
    const tablist = container.querySelector(`[data-${kind}-tabs]`);
    if (!tabs.length || !panels.length || !tablist) return;

    function selectTab(tab, interaction) {
      const changed = tab.getAttribute('aria-selected') !== 'true';
      tabs.forEach(item => {
        const selected = item === tab;
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
      });
      panels.forEach(panel => { panel.hidden = panel.id !== tab.getAttribute('aria-controls'); });
      if (interaction === 'keyboard') tab.focus();
      if (changed && interaction) {
        track(eventName, {
          [kind === 'tour' ? 'tour_step' : 'report_view']: tab.getAttribute(`data-${kind}-tab`),
          interaction
        });
      }
    }

    tablist.setAttribute('role', 'tablist');
    tabs.forEach((tab, index) => {
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => selectTab(tab, 'click'));
      tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        selectTab(tabs[next], 'keyboard');
      });
    });
    panels.forEach(panel => {
      panel.setAttribute('role', 'tabpanel');
      const tab = tabs.find(item => item.getAttribute('aria-controls') === panel.id);
      if (tab) panel.setAttribute('aria-labelledby', tab.id);
      panel.tabIndex = 0;
    });
    selectTab(tabs.find(tab => tab.getAttribute(`data-${kind}-tab`) === initial) || tabs[0]);
    tablist.hidden = false;
    container.classList.add('is-enhanced');
  }

  initializeTabs(tour, 'tour', 'conversation', 'features_tour_step');
  initializeTabs(tour.querySelector('[data-report-preview]'), 'report', 'evidence', 'features_report_view');

  const dialog = document.querySelector('[data-capture-dialog]');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const image = dialog.querySelector('img');
  const caption = dialog.querySelector('[data-capture-caption]');
  document.querySelectorAll('[data-expand-capture]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      const source = link.closest('figure').querySelector('img');
      image.src = link.href;
      image.alt = source.alt;
      image.width = source.naturalWidth || source.width;
      image.height = source.naturalHeight || source.height;
      caption.textContent = link.dataset.captureCaption;
      dialog.showModal();
      const region = dialog.querySelector('.capture-image-scroll');
      if (region) region.scrollLeft = 0;
      track('features_screenshot_open', {
        tour_step: link.closest('[data-tour-panel]').dataset.tourPanel,
        ...(link.dataset.reportView ? { report_view: link.dataset.reportView } : {}),
        interaction: 'click'
      });
    });
  });
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });
})();
