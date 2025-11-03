# JobHackAI - Technical Context Brief

## 📁 1. Directory & Page Inventory

### Core Pages (Complete/Functional)
- **`index.html`** - Landing page with hero section, features, testimonials, and pricing CTA
- **`dashboard.html`** - User dashboard with plan status, quick actions, and usage tracking
- **`resume-feedback-pro.html`** - Main resume analysis tool with ATS scoring and feedback
- **`interview-questions.html`** - Interview question generator with role-based filtering
- **`mock-interview.html`** - AI-powered mock interview simulator
- **`cover-letter-generator.html`** - Cover letter creation tool
- **`linkedin-optimizer.html`** - LinkedIn profile optimization tool
- **`login.html`** - Authentication page with dummy user system
- **`pricing-a.html`** / **`pricing-b.html`** - Pricing comparison pages
- **`billing-management.html`** - Subscription and payment management
- **`account-setting.html`** - User account settings and preferences
- **`checkout.html`** - Payment processing page
- **`add-card.html`** - Payment method management

### Marketing/Public Pages
- **`features.html`** - Feature showcase page
- **`about.html`** - Company/about page
- **`support.html`** - Customer support page
- **`privacy.html`** - Privacy policy

### Placeholder/In Progress
- **`demo-improved-flow.html`** - Demo page for improved user flow
- **`test-user-flow.html`** - User flow testing page
- **`dashboard-trial.html`** - Trial-specific dashboard variant

### CSS Files
- **`css/tokens.css`** - Design system tokens (colors, typography, spacing) ✅ Complete
- **`css/main.css`** - Global styles and component styles ✅ Complete
- **`css/header.css`** - Header-specific styles ✅ Complete
- **`css/footer.css`** - Footer-specific styles ✅ Complete
- **`css/reset.css`** - CSS reset/normalize ✅ Complete

### JavaScript Files
- **`js/navigation.js`** - Dynamic navigation system with plan-based routing ✅ Complete
- **`js/stripe-integration.js`** - Payment processing with demo mode ✅ Complete
- **`js/usageMeter.js`** - Feature usage tracking and limits ✅ Complete
- **`js/zapier-integration.js`** - Webhook integration for automation ⚠️ Placeholder
- **`js/analytics.js`** - Analytics tracking ⚠️ Placeholder
- **`js/error-reporting.js`** - Error monitoring ⚠️ Placeholder
- **`js/self-healing.js`** - Auto-recovery system ⚠️ Placeholder
- **`js/audit-trail.js`** - User action logging ⚠️ Placeholder

### Components (Mostly Empty)
- **`components/`** - Reusable HTML components (mostly placeholder files)

### Assets
- **`assets/`** - Logo files, favicons, and brand assets ✅ Complete

---

## 🎨 2. Design System Snapshot

### Color Palette (from `tokens.css`)
```css
--color-bg-light: #F9FAFB;           /* Site background */
--color-text-main: #1F2937;          /* Main text (slate) */
--color-text-secondary: #4B5563;     /* Secondary text (gray) */
--color-text-muted: #6B7280;         /* Muted text */
--color-card-bg: #FFFFFF;            /* Cards, nav, footer */
--color-cta-green: #007A43;          /* Primary CTA (WCAG AA compliant) */
--color-accent-blue: #007BFF;        /* Accent blue (links, outlines) */
--color-divider: #E5E7EB;            /* Dividers, borders */
--color-error: #DC2626;              /* Error states */
--color-success: #059669;            /* Success states */
--color-warning: #D97706;            /* Warning states */
--color-disabled: #B0B3B8;           /* Disabled states */
```

### Typography
- **Font Family**: `'Inter', sans-serif`
- **Weights**: 400 (regular), 500 (medium), 600 (semibold), 700 (bold), 800 (extrabold)
- **Sizes**: 14px (xs) → 32px (3xl) with custom scale

### Spacing System
```css
--space-2xs: 0.25rem;  /* 4px */
--space-xs: 0.5rem;    /* 8px */
--space-sm: 1rem;      /* 16px */
--space-md: 1.5rem;    /* 24px */
--space-lg: 2rem;      /* 32px */
--space-xl: 3rem;      /* 48px */
--space-2xl: 4rem;     /* 64px */
```

### Component Classes
- **Buttons**: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-outline`, `.btn-lg`
- **Cards**: `.rf-card`, `.pricing-b-card`, `.testimonials-card`
- **Navigation**: `.nav-dropdown`, `.nav-user-menu`, `.mobile-nav`
- **Forms**: Standard form elements with consistent styling
- **Shadows**: `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`

---

## 🧩 3. Component/Feature Map

### Resume Tools
- **Resume Scoring**: `resume-feedback-pro.html` - ATS compatibility scoring ✅ Complete
- **Resume Feedback**: `resume-feedback-pro.html` - Detailed feedback and suggestions ✅ Complete
- **Resume Rewrite**: `resume-feedback-pro.html#rewrite` - AI-powered rewriting ⚠️ In Progress

### Interview Tools
- **Interview Questions**: `interview-questions.html` - Role-based question generator ✅ Complete
- **Mock Interviews**: `mock-interview.html` - AI interview simulator ✅ Complete

### Additional Tools
- **Cover Letter Generator**: `cover-letter-generator.html` - AI cover letter creation ✅ Complete
- **LinkedIn Optimizer**: `linkedin-optimizer.html` - Profile optimization ✅ Complete

### Core Infrastructure
- **User Dashboard**: `dashboard.html` - Central hub with plan status ✅ Complete
- **Authentication**: `login.html` - Dummy auth system ✅ Complete
- **Billing**: `billing-management.html` - Subscription management ✅ Complete
- **Navigation**: `js/navigation.js` - Dynamic plan-based navigation ✅ Complete

---

## ⚠️ 4. Known Gaps or Missing Integrations

### Authentication System
- **Firebase Auth**: Referenced in docs but not implemented
- **Current State**: Using localStorage-based dummy authentication
- **Missing**: Real user authentication, password reset, email verification

### Payment Processing
- **Stripe Integration**: `js/stripe-integration.js` exists with demo mode
- **Current State**: Demo mode enabled, production keys needed
- **Missing**: Real payment processing, webhook handling, subscription management

### Backend Services
- **Zapier Integration**: `js/zapier-integration.js` exists but webhooks are placeholder
- **Current State**: Webhook URLs are dummy values
- **Missing**: Real Zapier workflows, Google Sheets integration, automation

### Analytics & Monitoring
- **Analytics**: `js/analytics.js` file exists but empty
- **Error Reporting**: `js/error-reporting.js` file exists but empty
- **Self-Healing**: `js/self-healing.js` file exists but empty
- **Missing**: Real analytics tracking, error monitoring, performance monitoring

### Feature Gating
- **Usage Metering**: `js/usageMeter.js` exists but basic implementation
- **Current State**: Simple localStorage-based tracking
- **Missing**: Server-side usage tracking, plan enforcement, feature limits

---

## 🔐 5. Plan-Gating Logic & Feature Lock Status

### Plan Structure (from `navigation.js`)
```javascript
const PLANS = {
  visitor: { features: [] },
  free: { features: ['ats'] },
  trial: { features: ['ats', 'feedback', 'interview'] },
  essential: { features: ['ats', 'feedback', 'interview'] },
  pro: { features: ['ats', 'feedback', 'interview', 'rewriting', 'coverLetter', 'mockInterview'] },
  premium: { features: ['ats', 'feedback', 'interview', 'rewriting', 'coverLetter', 'mockInterview', 'linkedin', 'priorityReview'] }
}
```

### Feature Lock Implementation
- **Navigation Locking**: ✅ Complete - Locked links show upgrade modal
- **Page-Level Gating**: ✅ Complete - `isFeatureUnlocked()` function
- **UI Locking**: ✅ Complete - Lock icons and upgrade prompts
- **Usage Limits**: ⚠️ Basic - Only mock interviews have usage limits

### Lock Visual Indicators
- **Lock Icons**: 🔒 shown on locked features
- **Upgrade Modals**: Popup when accessing locked features
- **Plan Badges**: Show current plan status
- **Usage Meters**: Track feature usage (basic implementation)

---

## 💡 6. Custom Code / Cursor Agent Edits

### Navigation System (`js/navigation.js`)
- **Complexity**: 1,462 lines with robust error handling
- **Features**: Dynamic navigation, plan switching, dev tools
- **Status**: ✅ Complete and well-tested
- **Notes**: Includes Quick Plan Switcher for development/testing

### Stripe Integration (`js/stripe-integration.js`)
- **Complexity**: 626 lines with demo mode
- **Features**: Payment processing, subscription management
- **Status**: ✅ Complete with demo mode
- **Notes**: Production keys needed for real payments

### Design System (`css/tokens.css`)
- **Complexity**: 68 lines of design tokens
- **Features**: Complete color, typography, spacing system
- **Status**: ✅ Complete and well-organized
- **Notes**: WCAG AA compliant color choices

### Quick Plan Switcher
- **Purpose**: Development tool for testing different user states
- **Features**: Dummy accounts, plan switching, state management
- **Status**: ✅ Complete and functional
- **Notes**: Only visible in development, helps with testing

### Areas Needing Cleanup
1. **Component Files**: Most `components/` files are empty placeholders
2. **Analytics Files**: Several JS files exist but are empty
3. **Error Handling**: Basic error handling, needs more robust implementation
4. **Code Comments**: Some files have extensive comments, others need documentation

---

## 🔌 Dev Stripe Endpoints (Cloudflare Pages Functions)

Dev uses Stripe test mode via Pages Functions under `functions/api/`:

- `POST /api/stripe-checkout` → Create subscription Checkout Session
- `POST /api/billing-portal` → Create Billing Portal session
- `POST /api/stripe-webhook` → Webhook receiver (HMAC verified)

Required environment variables (Cloudflare):

- `STRIPE_SECRET_KEY` (sk_test_...)
- `STRIPE_WEBHOOK_SECRET` (whsec_...)
- `PRICE_ESSENTIAL_MONTHLY`, `PRICE_PRO_MONTHLY`, `PRICE_PREMIUM_MONTHLY`
- `FRONTEND_URL` (e.g., https://dev.jobhackai.io)

KV binding (wrangler-managed): edit `app/wrangler.toml`

```
[[kv_namespaces]]
binding = "JOBHACKAI_KV"
id = "<dev_kv_id>"
preview_id = "<dev_kv_preview_id>"
```

KV namespaces (bind as `JOBHACKAI_KV`):

- `cusByUid:<uid>` → Stripe customer id
- `planByUid:<uid>` → current plan string
