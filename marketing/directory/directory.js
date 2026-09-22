// No independent tracker or storage. Uses the site's consent owner when
// present. The shared consent owner keeps preview analytics off by default.
(function () {
  'use strict';
  function track(name, values) {
    if (window.JHA?.cookieConsent?.hasAnalyticsConsent?.() !== true) return;
    if (typeof window.JHA?.gtagSafe !== 'function') return;
    window.JHA.gtagSafe('event', name, Object.assign({
      business_line: 'local_directory', directory_category: 'mobile_detailing',
      directory_market: 'nky_cincinnati'
    }, values));
  }
  var filters = document.getElementById('filters');
  if (filters) {
    var cards = Array.from(document.querySelectorAll('.listing'));
    function filter() {
      var values = new FormData(filters);
      var count = 0;
      cards.forEach(function (card) {
        var matches = ['region', 'service', 'utilities'].every(function (key) {
          return !values.get(key) || card.dataset[key].split('|').includes(values.get(key));
        });
        card.hidden = !matches;
        if (matches) count++;
      });
      document.getElementById('result-count').textContent = count + (count === 1 ? ' detailer' : ' detailers') + ' · alphabetical order';
      document.getElementById('no-results').hidden = count !== 0;
    }
    filters.addEventListener('submit', function (event) { event.preventDefault(); });
    filters.addEventListener('change', filter);
    filters.addEventListener('reset', function () { setTimeout(filter, 0); });
  }
  var viewed = false;
  function listingView() {
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
    if (link.dataset.directoryContact) track('directory_contact_click', { listing_id: link.dataset.directoryContact, contact_method: 'provider_website' });
    if (link.dataset.directoryInterest) track('directory_interest_click', { interest_type: link.dataset.directoryInterest, contact_method: 'email' });
  });
})();
