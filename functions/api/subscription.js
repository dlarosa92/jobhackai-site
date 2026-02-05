export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { userId } = await request.json();
    
    if (!userId) {
      return new Response(JSON.stringify({ error: 'User ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check KV storage for subscription data
    const subscriptionKey = `subscription:${userId}`;
    const subscriptionData = await env.JOBHACKAI_KV.get(subscriptionKey);

    if (subscriptionData) {
      const subscription = JSON.parse(subscriptionData);
      return new Response(JSON.stringify({
        success: true,
        status: subscription.status || 'active',
        plan: subscription.plan || 'free',
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Default to free plan if no subscription found
    return new Response(JSON.stringify({
      success: true,
      status: 'active',
      plan: 'free'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Subscription API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
