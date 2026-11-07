// Application-owned turn budget. The model does not decide or reset this count.
// Speech wording still needs live acceptance; this limits the opportunities to
// probe one topic and supplies a different competency when the budget is spent.
export const MAX_TOPIC_FOLLOWUPS = 2;
const TOPICS = [
  'a role-relevant problem and the candidate\'s own decisions',
  'collaboration or handling a disagreement with another person',
  'prioritizing competing work, explaining tradeoffs and checking the results'
];

export function createVoiceTurnPlan() {
  let questions = 0;
  let finalInvitation = false;
  return {
    next({ opening = false, wrapUp = false } = {}) {
      const topic = Math.floor(questions / (MAX_TOPIC_FOLLOWUPS + 1));
      const followup = questions % (MAX_TOPIC_FOLLOWUPS + 1);
      let kind, instruction;
      if (wrapUp || topic >= TOPICS.length) {
        kind = finalInvitation ? 'close' : 'final_invitation';
        instruction = finalInvitation
          ? 'Close now with your normal brief closing statement and report timing. Ask no further question.'
          : 'Ask only whether the candidate has anything else they want to add. Do not start another topic or follow-up.';
        finalInvitation = true;
      } else if (opening || !followup) {
        kind = 'new_topic';
        instruction = 'Ask ONE new main question about ' + TOPICS[topic] +
          ', tailored to the target role and level. ' + (questions
            ? 'Move to a different example or competency now. Do not ask another detail about the previous answer. '
            : 'Begin the official interview only if the candidate confirmed they can hear you; otherwise repeat the audio check. ');
      } else {
        kind = 'follow_up';
        instruction = 'This is follow-up opportunity ' + followup + ' of ' + MAX_TOPIC_FOLLOWUPS +
          ' for the current topic. Ask one concise follow-up only if useful, or a fresh question in this competency. ' +
          'Use what the candidate actually said; do not presume a mismatch, failure or conflict. If they said things were consistent, ask how they checked or whether there were any exceptions.';
      }
      // Charge the opportunity when requested, not when a potentially late or
      // duplicated transcript arrives. Interrupted turns cannot extend a topic.
      if (kind === 'new_topic' || kind === 'follow_up') questions++;
      return { kind, topic, followup, instruction: instruction +
        ' This application turn instruction replaces previous turn-budget instructions. Keep the interview, conduct, safety and closing rules. Never disclose the counter or coach during the interview.' };
    }
  };
}

if (typeof window !== 'undefined') window.createVoiceTurnPlan = createVoiceTurnPlan;
