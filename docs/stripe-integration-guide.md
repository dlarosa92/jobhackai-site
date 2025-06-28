# Stripe Integration Guide for JobHackAI

## Overview

This guide covers the Stripe integration implementation for JobHackAI, designed to be WIX-compatible and include demo functionality for testing purposes.

## Files Created/Modified

### New Files
- `js/stripe-integration.js` - Main Stripe integration class
- `checkout.html` - Dedicated checkout page for paid subscriptions
- `docs/stripe-integration-guide.md` - This documentation

### Modified Files
- `add-card.html` - Updated to use new Stripe integration
- `pricing-a.html` - Added Stripe checkout buttons
- `pricing-b.html` - Added Stripe checkout buttons

## Features

### 1. WIX-Compatible Design
- Dynamic script loading for Stripe.js
- Fallback to demo mode if Stripe fails to load
- No external dependencies that conflict with WIX

### 2. Demo Mode
- Fully functional demo without real Stripe keys
- Simulates payment processing with 90% success rate
- Realistic card input validation and formatting

### 3. Multiple Payment Flows
- **Free Trial**: Add card without immediate charge
- **Paid Subscriptions**: Direct payment for Essential, Pro, Premium plans
- **Subscription Management**: Demo portal for managing subscriptions

### 4. Responsive Design
- Mobile-friendly payment forms
- Consistent styling with existing JobHackAI design system
- Accessible form elements with proper ARIA labels

## Implementation Details

### Stripe Integration Class (`JobHackAIStripe`)

```javascript
// Initialize with demo mode enabled
const stripe = new JobHackAIStripe();

// Switch to production mode
stripe.isDemoMode = false;
stripe.productionStripeKey = 'pk_live_your_actual_key';
```

### Key Methods

#### `openCheckout(plan, amount)`
Opens Stripe Checkout for paid subscriptions or redirects to appropriate page.

#### `manageSubscription()`
Opens Stripe Customer Portal or shows demo management UI.

#### `createPaymentIntent(amount, currency)`
Creates payment intent for backend integration.

### Demo Mode Features

1. **Card Input Simulation**
   - Realistic card number formatting (1234 5678 9012 3456)
   - Expiry date formatting (MM/YY)
   - CVC validation
   - Real-time validation feedback

2. **Payment Processing Simulation**
   - 1.5-second processing delay
   - 90% success rate
   - Error handling for failed payments

3. **Success/Error Handling**
   - Visual feedback during processing
   - Success messages with plan-specific text
   - Error messages for failed payments

## Setup Instructions

### 1. Demo Mode (Current Setup)
The integration is currently configured for demo mode. No additional setup required.

### 2. Production Mode
To enable real Stripe payments:

1. **Update Stripe Keys**
   ```javascript
   // In js/stripe-integration.js
   this.isDemoMode = false;
   this.productionStripeKey = 'pk_live_your_actual_stripe_key';
   ```

2. **Backend Integration**
   Create API endpoints for:
   - `/api/create-payment-intent` - Create payment intents
   - `/api/create-checkout-session` - Create checkout sessions
   - `/api/create-portal-session` - Create customer portal sessions

3. **Webhook Handling**
   Set up webhooks for:
   - `payment_intent.succeeded`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

### 3. WIX Deployment
1. Upload all files to WIX
2. Ensure `js/stripe-integration.js` is loaded on payment pages
3. Test demo functionality
4. Switch to production mode when ready

## Payment Flows

### Free Trial Flow
1. User clicks "Start Free Trial" on pricing page
2. Redirected to `add-card.html`
3. Enters card details (no charge)
4. Trial activated, redirected to dashboard

### Paid Subscription Flow
1. User clicks subscription button on pricing page
2. Plan info stored in localStorage
3. Redirected to `checkout.html`
4. Enters card details and pays
5. Subscription activated, redirected to dashboard

### Subscription Management
1. User accesses account settings
2. Clicks "Manage Subscription"
3. Opens Stripe Customer Portal (or demo UI)
4. Can update payment method, cancel, etc.

## Testing

### Demo Card Numbers
Use any of these patterns for testing:
- `4242 4242 4242 4242` - Successful payment
- `4000 0000 0000 0002` - Declined payment
- `4000 0000 0000 9995` - Insufficient funds

### Test Scenarios
1. **Successful Payment**: Complete form with valid demo card
2. **Failed Payment**: Use declined card number
3. **Form Validation**: Test incomplete form submission
4. **Mobile Responsiveness**: Test on various screen sizes

## Security Considerations

### Demo Mode
- No real payment processing
- All data stored locally
- Safe for testing and development

### Production Mode
- PCI compliant through Stripe
- No card data stored on your servers
- Secure token-based payments
- Webhook verification required

## Troubleshooting

### Common Issues

1. **Stripe.js Not Loading**
   - Check internet connection
   - Verify CDN access
   - Falls back to demo mode automatically

2. **Form Not Submitting**
   - Check browser console for errors
   - Verify form IDs match integration
   - Ensure Stripe integration script is loaded

3. **Demo Mode Not Working**
   - Check `isDemoMode` setting
   - Verify demo event listeners are attached
   - Clear browser cache and localStorage

### Debug Mode
Enable debug logging:
```javascript
// Add to any page with Stripe integration
window.stripeDebug = true;
```

## Future Enhancements

1. **Apple Pay/Google Pay Integration**
2. **Subscription Pause/Resume**
3. **Usage-Based Billing**
4. **Multi-Currency Support**
5. **Advanced Analytics Integration**

## Support

For issues or questions:
1. Check browser console for errors
2. Verify all files are properly loaded
3. Test in demo mode first
4. Review Stripe documentation for production setup

## WIX-Specific Notes

- All scripts load dynamically to avoid conflicts
- No external dependencies beyond Stripe.js
- Responsive design works with WIX templates
- Demo mode ensures functionality without backend
- Easy migration path to production Stripe integration 