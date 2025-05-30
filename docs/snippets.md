# JobHackAI Canonical UI Snippets

All code below is the “single source of truth” for JobHackAI UI.  
**When building or editing pages, always use these snippets verbatim.**  
_Update this file when a snippet is improved or the design system changes._

---

## <!-- HEADER -->

```html
<header class="site-header">
  <nav class="header-nav container">
    <div class="nav-logo">
      <img src="assets/logo.svg" alt="JobHackAI logo" height="32" />
      <span>JOBHACKAI</span>
    </div>
    <ul class="nav-links">
      <li><a href="index.html">Home</a></li>
      <li><a href="index.html#what-you-get">What You Get</a></li>
      <li><a href="pricing-a.html">Pricing</a></li>
      <li><a href="login.html">Login</a></li>
    </ul>
    <a class="btn-primary" href="pricing-a.html">Start Free Trial</a>
    <button class="mobile-toggle" aria-label="Toggle navigation">☰</button>
  </nav>
</header>

<!-- FOOTER -->

<footer class="site-footer">
  <div class="footer-container">
    <div class="footer-brand">
      <img src="assets/logo.svg" alt="JobHackAI logo" height="24" />
      <span class="footer-name">JOBHACKAI</span>
    </div>
    <div class="footer-links">
      <a href="index.html">Home</a>
      <a href="account-settings.html">Support</a>
      <a href="privacy.html">Privacy</a>
    </div>
    <div class="footer-legal">
      <p>© 2025 JobHackAI. All rights reserved.</p>
    </div>
  </div>
</footer>

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
