# Page Access Policy – JobHackAI (MVP)

✅ PUBLIC (no login required)
- Home / Landing Page (`index.html`)
- Blog Index (`/blog/`) and all individual blog posts (`/blog/*.html`)
- Pricing Pages (A/B versions)
- Legal pages: Privacy Policy, Terms, Cookie Notice
- Marketing assets: “Before & After” screenshots, testimonial carousel

🔒 PRIVATE (Firebase Auth required)
- User Dashboard (`/dashboard/*`)
- ATS Résumé Scoring tool
- Résumé Feedback & Rewriting pages
- Cover Letter Generator
- Interview Questions & Mock Interview modules
- LinkedIn Optimizer
- Account Settings / Billing

**Rationale:**  
The public pages drive SEO, ads, and top-of-funnel traffic.  
All premium functionality lives behind Firebase Auth to protect API resources and enforce plan gating.

> Do NOT add authentication checks or redirects on the Home page or Blog routes.  
> ONLY enforce `authGuard()` on any URL that starts with `/dashboard/` or tool sub-routes.
