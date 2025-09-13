// Cloudflare Worker for Firebase Auth verification
export async function onRequest(context: any) {
  const { request, env } = context;
  
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { idToken } = await request.json();
    
    if (!idToken) {
      return new Response('Missing ID token', { status: 400 });
    }

    // Verify Firebase ID token
    const firebaseResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idToken }),
      }
    );

    const firebaseData = await firebaseResponse.json();
    
    if (!firebaseData.users || firebaseData.users.length === 0) {
      return new Response('Invalid token', { status: 401 });
    }

    const user = firebaseData.users[0];
    
    // Store user session in KV
    const sessionData = {
      uid: user.localId,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: new Date().toISOString(),
    };

    await env.JOBHACKAI_KV.put(`session:${user.localId}`, JSON.stringify(sessionData));

    return new Response(JSON.stringify({
      success: true,
      user: {
        uid: user.localId,
        email: user.email,
        emailVerified: user.emailVerified,
      }
    }), {
      headers: {
        'Content-Type': 'application/json',
      },
    });

  } catch (error) {
    console.error('Auth error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
