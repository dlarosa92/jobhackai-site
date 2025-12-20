import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { updateUserPlan } from '../_lib/db.js';

export async function onRequest(context) {
  const { request, env } = context;
  const token = getBearer(request);
  if (!token) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  
  const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
  const customerId = await env.JOBHACKAI_KV?.get(`cusByUid:${uid}`);
  
  if (customerId) {
    // Get subscriptions
    const res = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${customerId}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
    });
    const subs = await res.json();
    
    // Cancel all subscriptions
    for (const sub of subs.data || []) {
      await fetch(`https://api.stripe.com/v1/subscriptions/${sub.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
      });
    }
  }
  
  // Update D1 - set plan to free when subscription is cancelled
  await updateUserPlan(env, uid, {
    plan: 'free',
    stripeSubscriptionId: null,
    subscriptionStatus: 'canceled',
    cancelAt: undefined,
    scheduledPlan: undefined,
    scheduledAt: undefined
  });
  
  // TEMPORARY: Also clear KV during migration period
  await env.JOBHACKAI_KV?.delete(`planByUid:${uid}`);
  await env.JOBHACKAI_KV?.delete(`cusByUid:${uid}`);
  await env.JOBHACKAI_KV?.delete(`trialEndByUid:${uid}`);
  // Clean up resume data when user cancels subscription
  await env.JOBHACKAI_KV?.delete(`user:${uid}:lastResume`);
  await env.JOBHACKAI_KV?.delete(`usage:${uid}`);
  
  return new Response(JSON.stringify({ ok: true }), { 
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': env.FRONTEND_URL || 'https://dev.jobhackai.io', 'Vary': 'Origin' }
  });
}
