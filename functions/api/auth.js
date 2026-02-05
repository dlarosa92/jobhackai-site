export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { idToken } = await request.json();
    if (!idToken) {
      return new Response(JSON.stringify({ success: false, error: 'Missing idToken' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // In QA we accept token and echo environment; later replace with real verification
    return new Response(
      JSON.stringify({ success: true, message: 'Token received', environment: env.ENVIRONMENT }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Auth error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
