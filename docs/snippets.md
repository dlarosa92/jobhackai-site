# JobHackAI Canonical UI Snippets

**IMPORTANT:** Always use the header and footer HTML/CSS from this file. Never edit per-page. All changes must be made here and copied to all pages.

All code below is the "single source of truth" for JobHackAI UI.  
**When building or editing pages, always use these snippets verbatim.**  
_Update this file when a snippet is improved or the design system changes._

---

## <!-- HEADER -->

```html
<!--
  JobHackAI HEADER (canonical)
  DO NOT EDIT PER-PAGE. Copy from here only.
-->
<header class="site-header">
  <div class="container">
    <a href="index.html" class="nav-logo" aria-label="Go to homepage">
      <svg width="24" height="24" fill="none" stroke="#1F2937" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="7" width="18" height="13" rx="2"/>
        <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/>
      </svg>
      <span>JOBHACKAI</span>
    </a>
    <div class="nav-group">
      <nav class="nav-links" role="navigation">
        <a href="index.html">Home</a>
        <a href="#what-you-get">What You Get</a>
        <a href="pricing-a.html">Pricing</a>
        <a href="#blog">Blog</a>
        <a href="login.html">Login</a>
        <a href="pricing-a.html" class="cta-button">Start Free Trial</a>
      </nav>
    </div>
    <button class="mobile-toggle" aria-label="Open navigation menu" aria-expanded="false" aria-controls="mobileNav">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <line x1="3" y1="18" x2="21" y2="18"></line>
      </svg>
    </button>
  </div>
</header>
<nav class="mobile-nav" id="mobileNav">
  <a href="index.html">Home</a>
  <a href="#what-you-get">What You Get</a>
  <a href="pricing-a.html">Pricing</a>
  <a href="blog.html">Blog</a>
  <a href="login.html">Login</a>
  <a href="pricing-a.html" class="cta-button">Start Free Trial</a>
</nav>
<script>
  // Hamburger menu toggle
  const mobileToggle = document.querySelector('.mobile-toggle');
  const mobileNav = document.getElementById('mobileNav');
  if (mobileToggle && mobileNav) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = mobileNav.classList.toggle('open');
      mobileToggle.setAttribute('aria-expanded', isOpen);
    });
    // Close mobile nav on link click
    document.querySelectorAll('.mobile-nav a').forEach(link => {
      link.addEventListener('click', () => {
        mobileNav.classList.remove('open');
        mobileToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }
</script>

---

## <!-- FOOTER -->

```html
<!--
  JobHackAI FOOTER (canonical)
  DO NOT EDIT PER-PAGE. Copy from here only.
-->
<footer class="site-footer">
  <div class="footer-container">
    <div class="footer-brand">
      <svg class="footer-logo" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="7" width="18" height="13" rx="2" stroke="#1F2937" stroke-width="2"/>
        <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" stroke="#1F2937" stroke-width="2"/>
      </svg>
      <span class="footer-name">JOBHACKAI</span>
    </div>
    <div class="footer-legal">
      <p>© 2026 JobHackAI. All rights reserved.</p>
    </div>
    <div class="footer-links">
      <a href="index.html">Home</a>
      <a href="support.html">Support</a>
      <a href="privacy.html">Privacy</a>
    </div>
  </div>
</footer>
```

---

## <!-- INFO ICON TOOLTIP (CANONICAL) -->

```html
<!--
  JobHackAI INFO ICON TOOLTIP (canonical)
  Use this everywhere a tooltip is needed for explanations, scores, or feature locks.
  The SVG inherits color and is accessible.
-->
<span class="jh-tooltip-trigger" tabindex="0" aria-label="More info">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="vertical-align:middle">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="8"/>
    <line x1="12" y1="12" x2="12" y2="16"/>
  </svg>
  <span class="jh-tooltip-text">Your tooltip text here.</span>
</span>
```

---

<!-- PRIMARY CTA BUTTON -->

<a class="btn-primary" href="#">
  Start Free Trial
</a>

.btn-primary {
  background: var(--color-primary);
  color: #fff;
  border-radius: 8px;
  font-weight: 600;
  padding: var(--space-2) var(--space-4);
  transition: background var(--trans-fast);
}
.btn-primary:hover {
  background: #00c965;
}

<!-- CARD COMPONENT -->
<div class="card">
  <h3>Feature Title</h3>
  <p>Short feature description here.</p>
</div>

.card {
  background: #fff;
  border-radius: 16px;
  box-shadow: var(--elev-1);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
}

<!-- INPUT FIELD -->
 <input class="input" type="text" placeholder="Your email" aria-label="Email address" />

.input {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-body);
  color: var(--color-text-main);
  margin-bottom: var(--space-2);
}
.input:focus {
  outline: 2px solid var(--color-primary);
}

<!-- MODAL -->
 <div class="modal">
  <div class="modal-content">
    <button class="modal-close" aria-label="Close">×</button>
    <h2>Modal Title</h2>
    <p>Modal body content goes here.</p>
    <a href="#" class="btn-primary">Confirm</a>
  </div>
</div>

.modal {
  position: fixed;
  top: 0; left: 0; width: 100vw; height: 100vh;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999;
}
.modal-content {
  background: #fff;
  border-radius: 16px;
  box-shadow: var(--elev-2);
  padding: var(--space-5);
  max-width: 400px;
  width: 100%;
}
.modal-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  cursor: pointer;
}


---

Let me know if you want additional snippets (usage meter, feature lock, testimonial card, etc.) or want to further customize anything above!
