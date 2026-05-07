// blog-cta.js
// Injects a contextual CTA at the end of every blog post and tracks
// readers who reach it. The CTA copy adapts to the post topic (resume,
// interview, LinkedIn) so the offer matches the content.

(function () {
  'use strict';

  const TOPIC_RULES = [
    { test: /linkedin/i, label: 'Optimize Your LinkedIn Profile Free', cta: 'blog-linkedin' },
    { test: /interview|behavioral|mock/i, label: 'Try a Free AI Mock Interview', cta: 'blog-interview' },
    { test: /ats|resume|application/i, label: 'Score Your Resume Free in 60 Seconds', cta: 'blog-resume' }
  ];

  function pickTopic(slug, title) {
    const haystack = `${slug} ${title}`;
    for (const rule of TOPIC_RULES) {
      if (rule.test.test(haystack)) return rule;
    }
    return { label: 'Start Your Free 3-Day Trial', cta: 'blog-default' };
  }

  function buildCta(topic) {
    const wrap = document.createElement('aside');
    wrap.className = 'blog-cta';
    wrap.setAttribute('role', 'complementary');
    wrap.style.cssText = 'background:#F0F7FF;border:1px solid #BBD9F4;border-radius:12px;padding:1.5rem;margin:2.5rem 0 1rem;text-align:center;';
    wrap.innerHTML = `
      <h3 style="margin:0 0 0.5rem;color:#0B3D91;font-size:1.15rem;">Ready to put this into practice?</h3>
      <p style="margin:0 0 1rem;color:#1F2937;font-size:0.95rem;">${topic.label}. Try 3 days free, then $29/mo. Cancel anytime.</p>
      <a class="btn-primary" href="https://jobhackai.io/pricing-a.html" data-cta="${topic.cta}" style="display:inline-block;">${topic.label}</a>
    `;
    return wrap;
  }

  function injectOnce() {
    if (document.querySelector('.blog-cta')) return;
    const article = document.querySelector('article') || document.querySelector('main');
    if (!article) return;
    const slug = (window.location.pathname.split('/').pop() || '').replace('.html', '');
    const title = (document.querySelector('h1')?.textContent || document.title || '').trim();
    const topic = pickTopic(slug, title);
    article.appendChild(buildCta(topic));

    // Fire a view event so we know how many readers actually reached the CTA.
    if (window.JHA?.trackEventSafe) {
      window.JHA.trackEventSafe('blog_cta_view', {
        cta_label: topic.cta,
        slug: slug
      });
    }
  }

  if (document.readyState !== 'loading') injectOnce();
  else document.addEventListener('DOMContentLoaded', injectOnce);
})();
