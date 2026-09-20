// Execute declarations from the shipped inline scripts. Only browser/API boundaries
// are stubbed; the plan predicates, role validation and request branching are real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = process.env.UI_SOURCE_ROOT || path.resolve(__dirname, '../../..');
const plans = ['free', 'weekly', 'monthly', 'pack', 'trial', 'essential', 'pro', 'premium'];
function declarations(file) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const found = {};
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/src=|application\/ld/.test(match[1])) continue;
    const source = ts.createSourceFile(file + '.js', match[2], ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(source.parseDiagnostics.length, 0, `${file}: inline script parses`);
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name) found[node.name.text] = node.getText(source);
      if (ts.isVariableDeclaration(node) && node.initializer) {
        let parent = node.parent;
        while (parent && !(ts.isFunctionDeclaration(parent) && parent.name)) parent = parent.parent;
        const name = node.name.getText(source);
        const key = name === 'feedbackPromise' && parent?.name.text === 'generateATSAndFeedback' ? 'initialFeedbackPromise' : name;
        found[key] = `var ${node.getText(source)};`;
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return found;
}
const iq = declarations('interview-questions.html');
const rf = declarations('resume-feedback-pro.html');
function element(value = '') {
  const attrs = new Map(), classes = new Set();
  return { value, disabled: true, textContent: '', dataset: {}, style: { display: 'none' },
    classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
    setAttribute: (k,v) => attrs.set(k,v), removeAttribute: k => attrs.delete(k), getAttribute: k => attrs.get(k),
    querySelector: () => null, querySelectorAll: () => [] };
}
function harness(plan, source, names, extra = {}) {
  const ids = new Map();
  const el = id => { if (!ids.has(id)) ids.set(id, element()); return ids.get(id); };
  const storage = new Map([['user-plan',plan]]);
  const context = vm.createContext({ console, URL, encodeURIComponent, setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v) },
    sessionStorage: { getItem: k => storage.get(k) || null },
    document: { getElementById: el, documentElement: element(), querySelector: () => null, querySelectorAll: () => [] },
    window: { location: { href: 'http://localhost/interview-questions.html' }, JobHackAIHistory: { isHistoricalView: () => false } },
    getUserPlan: () => plan, getCurrentUserPlan: () => plan,
    roleInput: el('iq-role'), upgradeBtn: element(), lockDiv: element(),
    updatePlanUI() {}, updatePriorityReviewCTA() {}, attachRewriteButtonListeners() {},
    ...extra
  });
  vm.runInContext(names.map(n => { assert.ok(source[n], `real declaration ${n} exists`); return source[n]; }).join('\n'), context);
  return { context, el, storage };
}
for (const plan of plans) {
  test(`${plan}: IQ role and mock practice are available`, async () => {
    let saved = 0;
    const {context:c, el} = harness(plan, iq, ['IQ_ALLOWED_PLANS','updateInterviewUIForPlan','iqHandleMock'], {
      getFirebaseToken: async () => 'test-token', $IQ: id => id === '#iq-role' ? { value: 'QA Engineer' } : null,
      iqState: { set: { questions: [{q:'Describe a test strategy.'}], role:'QA Engineer', type:'mixed' }, prefs:{} },
      iqGetSavedIndexes: () => [0], iqSanitizeType: x => x, iqApiSaveSet: async () => { saved++; return {id:42}; },
      iqSetId: () => 'local-test-set', iqTrack() {}, iqToast() {}, iqUpdateSelectionSummary() {}
    });
    c.updateInterviewUIForPlan();
    assert.equal(el('iq-role').disabled, false);
    assert.equal(el('btn-mock').getAttribute('data-locked'), undefined);
    await c.iqHandleMock(true);
    assert.equal(saved, 1);
    assert.match(c.window.location.href, /mock-interview\.html\?.*set=42/);
  });
  test(`${plan}: feedback, rewriting and role validation match API access`, () => {
    const {context:c, el} = harness(plan, rf, ['RF_ALLOWED_PLANS','ROLE_REQUIRED_PLANS','isRoleRequiredPlan','getRoleInputValue','updateGenerateButtonState','updateFeedbackDescription','updateRfTileForPlan'], { resumeFileIsValid: true });
    for (const id of ['rf-feedback-tile','rf-rewrite-tile']) {
      const badge = element(); el(id).querySelector = () => badge;
    }
    c.updateRfTileForPlan();
    assert.equal(el('rf-feedback-content').style.display, 'block');
    assert.equal(el('rf-rewrite-content').style.display, 'block');
    c.updateGenerateButtonState({fileSelected:true,fileValid:true,roleValue:''});
    assert.equal(el('rf-generate-btn').disabled,true);
    c.updateGenerateButtonState({fileSelected:true,fileValid:true,roleValue:'QA Engineer'});
    assert.equal(el('rf-generate-btn').disabled,false);
    el('rf-generate-btn').dataset.processing = 'true';
    c.updateGenerateButtonState({fileSelected:true,fileValid:true,roleValue:'QA Engineer'});
    assert.equal(el('rf-generate-btn').disabled,true);
    c.window.JobHackAIHistory.isHistoricalView = () => true;
    el('rf-header-desc').textContent = 'Saved score: 82%';
    el('rf-rewrite-content').textContent = 'Saved synthetic rewrite';
    c.updateRfTileForPlan();
    assert.match(el('rf-feedback-desc').textContent, /saved for this run/);
    assert.equal(el('rf-header-desc').textContent, 'Saved score: 82%');
    assert.equal(el('rf-rewrite-content').textContent, 'Saved synthetic rewrite');
    c.window.JobHackAIHistory.isHistoricalView = () => false;
    c.updateFeedbackDescription();
    assert.match(el('rf-feedback-desc').textContent, /^Run ATS/);
    el('rf-feedback-content').dataset.savedResult = 'true';
    c.updateRfTileForPlan();
    assert.match(el('rf-feedback-desc').textContent, /saved for this run/);
  });
  test(`${plan}: initial analysis actually requests feedback`, async () => {
    let requests = 0;
    const {context:c} = harness(plan, rf, ['RF_ALLOWED_PLANS','initialFeedbackPromise'], {
      uploadResult: {resumeId:'synthetic'}, canonicalJobTitleForApis:'QA Engineer', atsPromise:Promise.resolve(),
      getResumeFeedbackWithAtsWait: async () => { requests++; return {success:true}; }
    });
    await c.feedbackPromise;
    assert.equal(requests,1);
  });
}
test('signed-out IQ cannot generate or save a mock session', async () => {
  let requests = 0;
  const {context:c} = harness('free', iq, ['IQ_ALLOWED_PLANS','getFirebaseToken','iqApiGenerate','iqHandleMock'], {
    iqTrack() {}, iqToast() {}, iqSanitizeType: x => x, IQ_FIXED_COUNT:10,
    iqState: {prefs:{}, set:{questions:[{q:'Synthetic question'}]}},
    iqGetSavedIndexes: () => [0], iqUpdateSelectionSummary() {}, $IQ: () => null,
    fetchWithTimeout: async () => { requests++; }, iqApiSaveSet: async () => { requests++; }
  });
  await c.iqApiGenerate({role:'QA Engineer',type:'mixed',count:10});
  await c.iqHandleMock(true);
  assert.equal(requests,0);
});
test('unknown plans and logout do not enable IQ controls', () => {
  for (const plan of ['visitor','unknown']) {
    const {context:c,el} = harness(plan, iq, ['IQ_ALLOWED_PLANS','updateInterviewUIForPlan']);
    c.updateInterviewUIForPlan(); assert.equal(el('iq-role').disabled,true);
  }
  const {context:c,el,storage} = harness('free',iq,['IQ_ALLOWED_PLANS','updateInterviewUIForPlan']);
  storage.set('logout-intent','1'); c.updateInterviewUIForPlan();
  assert.equal(el('iq-role').disabled,true);
});
test('IQ role requirement, cooldown and daily cap still disable generation', () => {
  const {context:c,el} = harness('free',iq,['iqUpdateGenerateButtonState'], {
    iqState:{cooldown:0,dailyLimitReached:false,set:null},
    iqUpdateActionsLayout() {}
  });
  c.$IQ = id => el(id.slice(1));
  c.iqUpdateGenerateButtonState(); assert.equal(el('btn-generate').disabled,true);
  el('iq-role').value='QA Engineer';
  c.iqUpdateGenerateButtonState(); assert.equal(el('btn-generate').disabled,false);
  c.iqState.cooldown=30; c.iqUpdateGenerateButtonState(); assert.equal(el('btn-generate').disabled,true);
  c.iqState.cooldown=0; c.iqState.dailyLimitReached=true;
  c.iqUpdateGenerateButtonState(); assert.equal(el('btn-generate').disabled,true);
});

test('signed-out Resume Feedback and Rewrite cannot send an API request', async () => {
  let requests = 0;
  const {context:c} = harness('visitor',rf,['getAuthToken','rewriteResume','getResumeFeedback'], {
    fetch: async () => { requests++; },
  });
  c.window.JobHackAIRetry = {fetchWithRetry: async () => {requests++;}};
  await assert.rejects(c.rewriteResume('synthetic',null,'QA Engineer',[],null),/Not authenticated/);
  await assert.rejects(c.getResumeFeedback('synthetic','QA Engineer'),/Not authenticated/);
  assert.equal(requests,0);
});
