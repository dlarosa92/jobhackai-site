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

    // Check KV storage for usage data
    const usageKey = `usage:${userId}`;
    const usageData = await env.JOBHACKAI_KV.get(usageKey);

    if (usageData) {
      const usage = JSON.parse(usageData);
      return new Response(JSON.stringify({
        success: true,
        resumeScans: usage.resumeScans || 0,
        coverLetters: usage.coverLetters || 0,
        interviewQuestions: usage.interviewQuestions || 0,
        lastActivity: usage.lastActivity
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Default usage stats
    return new Response(JSON.stringify({
      success: true,
      resumeScans: 0,
      coverLetters: 0,
      interviewQuestions: 0,
      lastActivity: null
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Usage API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
