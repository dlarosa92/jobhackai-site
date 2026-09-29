// One consent-owned, topic-aware CTA per article. Impression means the reader
// actually reached the CTA; script execution alone is not a view.
(function () {
  'use strict';
  const topics = [
    { test: /linkedin/i, label: 'Explore LinkedIn guidance', path: '/linkedin-optimizer.html', id: 'blog-linkedin' },
    { test: /interview|behavioral|mock/i, label: 'See interview practice options', path: '/pricing', id: 'blog-interview' },
    { test: /ats|resume|application/i, label: 'Explore resume tools', path: '/resume-feedback-pro.html', id: 'blog-resume' }
  ];
  const defaultTopic = { label: 'See practice options', path: '/pricing', id: 'blog-default' };
  function appBase() {
    const host = (window.location.hostname || '').toLowerCase();
    if (['jobhackai.io', 'www.jobhackai.io', 'app.jobhackai.io'].includes(host)) return 'https://app.jobhackai.io';
    if (host === 'qa.jobhackai.io' || host === 'qa-marketing.jobhackai.io' || host === 'develop.jobhackai-app-marketing-seo.pages.dev') return 'https://qa.jobhackai.io';
    return 'https://dev.jobhackai.io';
  }
  function initialize() {
    const article = document.querySelector('article') || document.querySelector('main');
    if (!article || document.querySelector('[data-blog-cta-ready]')) return;
    const slug = (window.location.pathname.replace(/\/+$/, '').split('/').pop() || '').replace(/\.html$/, '');
    const title = document.querySelector('h1')?.textContent || document.title || '';
    const topic = topics.find(value => value.test.test(slug + ' ' + title)) || defaultTopic;
    const existing = document.querySelector('.post-cta') || document.querySelector('.blog-cta');
    const cta = existing || document.createElement('aside');
    cta.classList.add('blog-cta');
    cta.setAttribute('data-blog-cta-ready', 'true');
    cta.setAttribute('aria-label', 'JobHackAI preparation options');
    cta.innerHTML = `<h2>Prepare for your next interview</h2>
      <p>Preparation tools are free with an account. Your first lifetime voice interview includes a feedback preview. Paid voice plans unlock full reports and transcripts.</p>
      <a class="btn btn-primary" href="${appBase()}${topic.path}" data-cta="${topic.id}">${topic.label}</a>`;
    if (!existing) { cta.classList.add('post-cta'); article.appendChild(cta); }

    let visible = false;
    let recorded = false;
    const parameters = { cta_label: topic.id, slug, business_line: 'career_product' };
    const assetId = document.body?.dataset?.assetId;
    if (typeof assetId === 'string' && /^[a-z0-9_]{1,100}$/.test(assetId)) parameters.asset_id = assetId;
    function recordIfEligible() {
      if (recorded || !visible || document.visibilityState === 'hidden') return;
      if (window.JHA?.cookieConsent?.hasAnalyticsConsent?.() !== true || typeof window.JHA?.gtagSafe !== 'function') return;
      window.JHA.gtagSafe('event', 'blog_cta_view', parameters);
      recorded = true;
      observer?.disconnect();
      window.removeEventListener('cookie-consent-granted', recordIfEligible);
      document.removeEventListener('visibilitychange', recordIfEligible);
    }
    // Browsers without the visibility API still get the offer; do not invent a view.
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.5);
      recordIfEligible();
    }, { threshold: 0.5 }) : null;
    observer?.observe(cta);
    window.addEventListener('cookie-consent-granted', recordIfEligible);
    document.addEventListener('visibilitychange', recordIfEligible);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();
