import { verifyFirebaseIdToken } from '../_lib/firebase-auth.js';

export async function onRequest({ request, env }) {
  try {
    const auth = request.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      return new Response(
        JSON.stringify({ ok: false, error: 'missing_token' }), 
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { uid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    return new Response(
      JSON.stringify({ ok: true, uid, email: payload.email }), 
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e.message }), 
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

