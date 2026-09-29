// Explicit real-model evaluation. Synthetic cases only; never creates voice calls.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { scoreVoiceTranscript, groundedMoments } from '../../functions/_lib/voice-scorecard.js';
import { cases } from './cases.mjs';
if (!process.env.OPENAI_API_KEY) {
  console.error('Real-model evaluation not run: OPENAI_API_KEY is unavailable locally. Unit tests do not establish coaching quality.');
  process.exit(2);
}
const report = {createdAt:new Date().toISOString(),sourceHashes:{}, results:[]};
for(const file of ['voice-scorecard.js','voice-coaching.js']) report.sourceHashes[file]=createHash('sha256').update(readFileSync(new URL('../../functions/_lib/'+file,import.meta.url))).digest('hex');
for (const fixture of cases) {
  const {scorecard,usage,model}=await scoreVoiceTranscript(fixture,process.env);
  const issues=[];
  if(scorecard.tooShort || scorecard.methodologyVersion!==2) issues.push('missing scoped report');
  if(!scorecard.assessmentScope || scorecard.competencies?.length < 3) issues.push('missing scope or competency coverage');
  if(groundedMoments(scorecard.moments,fixture.transcript).length !== scorecard.moments.length) issues.push('ungrounded moment');
  report.results.push({id:fixture.id,reviewRequired:fixture.review,issues,scorecard,usage,model});
  console.log(fixture.id+': '+(issues.length ? issues.join('; ') : 'structural checks pass; semantic review required'));
}
const out=new URL('../voice-transcripts/reports/coaching-v2.json',import.meta.url);
mkdirSync(new URL('.',out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2));
console.log('Saved synthetic outputs for manual semantic review. This is not a live-voice or hiring-validity test.');
if(report.results.some(r=>r.issues.length))process.exitCode=1;
