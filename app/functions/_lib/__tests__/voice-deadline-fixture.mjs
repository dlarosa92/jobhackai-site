// The real Durable Object is exercised by workers/voice-deadlines tests. This
// in-process receipt lets unrelated Pages/lifecycle tests intercept the RPC.
export function deadlineBinding(db) {
  return {getByName(sessionId) {return {async arm({uid,sessionId:requested}) {
    if (requested!==sessionId) throw Error('fixture wrong namespace');
    const row=await db.prepare('SELECT deadline_at FROM voice_interview_controls WHERE session_id=? AND auth_id=?')
      .bind(sessionId,uid).first();
    if (!row) throw Error('fixture missing control');
    return {armed:true,sessionId,deadlineAt:row.deadline_at};
  }}}};
}
