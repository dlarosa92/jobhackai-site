# JobHackAI Architecture - Cloudflare Migration

## 🏗️ Repository Structure

```
jobhackai-site/
├── app/                          # Next.js Cloudflare Application
│   ├── src/
│   │   ├── pages/               # Next.js pages
│   │   ├── components/          # React components
│   │   ├── lib/                 # Utility functions
│   │   └── styles/              # CSS styles
│   ├── functions/               # Cloudflare Workers
│   │   └── api/                 # API endpoints
│   ├── public/                  # Static assets
│   ├── package.json             # Next.js dependencies
│   ├── next.config.js           # Next.js configuration
│   └── wrangler.toml            # Cloudflare Workers config
├── .github/workflows/           # CI/CD pipelines
├── assets/                      # Marketing assets (Wix integration)
├── components/                  # HTML components (Wix integration)
├── css/                         # Marketing styles (Wix integration)
├── js/                          # Marketing scripts (Wix integration)
└── docs/                        # Documentation
```

## 🚀 Deployment Strategy

### Environments
- **QA**: `qa.jobhackai.io` (feature branches → develop)
- **Production**: `app.jobhackai.io` (main branch)

### CI/CD Pipeline
1. **Feature Development**: Work in feature branches
2. **QA Deployment**: Auto-deploy to QA on push to feature/develop branches
3. **Production Deployment**: Auto-deploy to production on push to main branch

## 🔧 Local Development Setup

### Prerequisites
- Node.js 18+
- Cloudflare account with API token
- Firebase project
- Stripe account

### Setup Steps

1. **Install Dependencies**
   ```bash
   cd app
   npm install
   ```

2. **Configure Environment Variables**
   ```bash
   # Create .env.local in app/ directory
   FIREBASE_API_KEY=your_firebase_api_key
   STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_key
   ```

3. **Start Development Server**
   ```bash
   cd app
   npm run dev
   ```

4. **Deploy to QA**
   ```bash
   cd app
   npm run deploy:qa
   ```

## 🌐 Cloudflare Configuration

### Pages Setup
- **QA Project**: `jobhackai-app-qa`
- **Production Project**: `jobhackai-app-prod`
- **Build Command**: `npm run build`
- **Output Directory**: `out`

### Workers Setup
- **KV Storage**: User sessions, subscriptions, rate limits
- **API Endpoints**: `/api/auth`, `/api/stripe`
- **Environment Variables**: Stripe keys, Firebase config

### Domain Configuration
- **QA**: `qa.jobhackai.io` → Cloudflare Pages
- **Production**: `app.jobhackai.io` → Cloudflare Pages
- **Marketing**: `jobhackai.io` → Wix (DNS managed by Cloudflare)

## 🔐 Security & Environment Variables

### Required Secrets (GitHub)
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `STRIPE_SECRET_KEY`
- `FIREBASE_API_KEY`

### Environment-Specific Variables
- **QA**: Test Stripe keys, Firebase test project
- **Production**: Live Stripe keys, Firebase production project

## 📱 Integration Points

### Wix Integration
- Marketing site: `jobhackai.io`
- App redirects: `jobhackai.io/app` → `app.jobhackai.io`
- SEO blog: Hosted on Wix
- Pricing pages: Wix with Stripe integration

### Firebase Auth
- JWT token verification in Cloudflare Workers
- User sessions stored in KV Storage
- Google/LinkedIn OAuth (LinkedIn deferred to V2)

### Stripe Integration
- Checkout sessions via Cloudflare Workers
- Webhook handling for subscription events
- Customer portal integration

## 🚦 Development Workflow

### Feature Development
1. Create feature branch: `git checkout -b feature/new-feature`
2. Develop in `app/` directory
3. Test locally: `npm run dev`
4. Push to trigger QA deployment
5. Test on `qa.jobhackai.io`
6. Create PR to `main` for production deployment

### Deployment Process
1. **QA**: Automatic on feature branch push
2. **Production**: Automatic on main branch push
3. **Manual**: Use GitHub Actions workflow_dispatch

## 📊 Monitoring & Analytics

### Cloudflare Analytics
- Page views, performance metrics
- Worker execution metrics
- KV Storage usage

### Custom Analytics
- User behavior tracking
- Feature usage metrics
- Conversion funnel analysis

## 🔧 Troubleshooting

### Common Issues
1. **Build Failures**: Check Node.js version and dependencies
2. **Deployment Issues**: Verify Cloudflare API tokens
3. **Auth Issues**: Check Firebase configuration
4. **Stripe Issues**: Verify webhook endpoints

### Debug Commands
```bash
# Check Cloudflare Workers
wrangler tail

# Test API endpoints
curl https://qa.jobhackai.io/api/auth

# Check KV Storage
wrangler kv:key list --binding JOBHACKAI_KV
```

## 📚 Next Steps

1. **Set up Cloudflare Pages projects**
2. **Configure KV Storage namespaces**
3. **Set up Firebase project**
4. **Configure Stripe webhooks**
5. **Test QA deployment**
6. **Set up production environment**
