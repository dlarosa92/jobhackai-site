export async function onRequest(context) {
  const { request, env } = context;
  
  try {
    console.log('🔍 Test endpoint called');
    console.log('🔍 Environment check:', {
      hasStripeKey: !!env.STRIPE_SECRET_KEY,
      hasFirebaseProject: !!env.FIREBASE_PROJECT_ID,
      hasKv: !!env.JOBHACKAI_KV,
      hasPrices: {
        essential: !!env.STRIPE_PRICE_ESSENTIAL_MONTHLY,
        pro: !!env.STRIPE_PRICE_PRO_MONTHLY,
        premium: !!env.STRIPE_PRICE_PREMIUM_MONTHLY
      }
    });
    
    // Test Firebase auth import
    console.log('🔍 Testing Firebase auth import...');
    const { getBearer, verifyFirebaseIdToken } = await import('../_lib/firebase-auth.js');
    console.log('✅ Firebase auth import successful');
    
    return new Response(JSON.stringify({ 
      ok: true, 
      message: 'Test endpoint working',
      env: {
        hasStripeKey: !!env.STRIPE_SECRET_KEY,
        hasFirebaseProject: !!env.FIREBASE_PROJECT_ID,
        hasKv: !!env.JOBHACKAI_KV,
        hasPrices: {
          essential: !!env.STRIPE_PRICE_ESSENTIAL_MONTHLY,
          pro: !!env.STRIPE_PRICE_PRO_MONTHLY,
          premium: !!env.STRIPE_PRICE_PREMIUM_MONTHLY
        }
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('❌ Test endpoint error:', error);
    return new Response(JSON.stringify({ 
      ok: false, 
      error: error.message,
      stack: error.stack 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
