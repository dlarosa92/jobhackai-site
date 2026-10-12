// No independent tracker or storage. Uses the site's consent owner when
// present. The shared consent owner keeps preview analytics off by default.
(function () {
  'use strict';
  function track(name, values) {
    if (window.JHA?.cookieConsent?.hasAnalyticsConsent?.() !== true) return;
    if (typeof window.JHA?.gtagSafe !== 'function') return;
    window.JHA.gtagSafe('event', name, Object.assign({
      business_line: 'local_directory', directory_category: (document.body.dataset.directoryCategory || 'mobile-detailing').replaceAll('-','_'),
      directory_market: 'greater_cincinnati_tri_state', directory_tracking_version: '2'
    }, values));
  }
  var filters = document.getElementById('filters');
  if (filters) {
    var cards = Array.from(document.querySelectorAll('.listing'));
    var pagination = document.getElementById('directory-pagination');
    var previous = pagination?.querySelector('[data-page="previous"]');
    var next = pagination?.querySelector('[data-page="next"]');
    var pageStatus = pagination?.querySelector('[data-page-status]');
    var pageSize = 24;
    var page = 0;
    function filter() {
      var values = new FormData(filters);
      var matching = cards.filter(function (card) {
        return Array.from(values.keys()).every(function (key) {
          return !values.get(key) || (card.dataset[key] || '').split('|').includes(values.get(key));
        });
      });
      var pages = Math.max(1, Math.ceil(matching.length / pageSize));
      page = Math.min(page, pages - 1);
      var visible = new Set(matching.slice(page * pageSize, (page + 1) * pageSize));
      cards.forEach(function (card) { card.hidden = !visible.has(card); });
      var noun = document.body.dataset.providerNoun || 'detailer';
      document.getElementById('result-count').textContent = matching.length + ' ' + noun + (matching.length === 1 ? '' : 's') + ' · alphabetical order';
      document.getElementById('no-results').hidden = matching.length !== 0;
      if (pagination) {
        pagination.hidden = pages <= 1;
        previous.disabled = page === 0;
        next.disabled = page >= pages - 1;
        pageStatus.textContent = 'Page ' + (page + 1) + ' of ' + pages;
      }
    }
    previous?.addEventListener('click', function () { page--; filter(); });
    next?.addEventListener('click', function () { page++; filter(); });
    filters.addEventListener('submit', function (event) { event.preventDefault(); });
    filters.addEventListener('change', function () { page = 0; filter(); track('directory_filter_change',Object.fromEntries(new FormData(filters))); });
    filters.addEventListener('reset', function () { page = 0; setTimeout(filter, 0); });
    filter();
  }
  var viewed = false;
  var categoryViewed = false;
  function listingView() {
    if (!categoryViewed && document.body.dataset.categoryPage === 'true' && document.visibilityState === 'visible' && window.JHA?.cookieConsent?.hasAnalyticsConsent?.() === true && typeof window.JHA?.gtagSafe === 'function') {
      categoryViewed = true;
      track('directory_category_view',{});
    }
    if (!viewed && document.visibilityState === 'visible' && document.body.dataset.listing && window.JHA?.cookieConsent?.hasAnalyticsConsent?.() === true && typeof window.JHA?.gtagSafe === 'function') {
      viewed = true;
      track('directory_listing_view', { listing_id: document.body.dataset.listing });
    }
  }
  listingView();
  window.addEventListener('cookie-consent-granted', listingView);
  document.addEventListener('visibilitychange', listingView);
  document.addEventListener('click', function (event) {
    var link = event.target.closest('a');
    if (!link) return;
    if (link.dataset.directoryContact) {
      // Classify the actual destination, never the visible label. Do not send
      // phone numbers, email addresses or destination query strings to GA.
      var href = (link.getAttribute('href') || '').trim();
      var method = /^https?:\/\//i.test(href) ? 'provider_website'
        : /^tel:/i.test(href) ? 'phone' : /^mailto:/i.test(href) ? 'email' : '';
      if (method) track('directory_contact_click', {
        listing_id: link.dataset.directoryContact, contact_method: method,
        contact_link: method === 'provider_website'
          ? (['website', 'source', 'booking'].includes(link.dataset.directoryLink) ? link.dataset.directoryLink : 'website')
          : method
      });
    }
    if (link.dataset.directoryInterest) track('directory_interest_click', { interest_type: link.dataset.directoryInterest, contact_method: 'email' });
  });
})();
