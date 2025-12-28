const assert = require('assert');

(async () => {
  try {
    const rn = await import('../_lib/role-normalizer.js');
    const rs = await import('../_lib/role-skills.js');

    const normalizeRoleToFamily = rn.normalizeRoleToFamily;
    const ROLE_SKILL_TEMPLATES = rs.ROLE_SKILL_TEMPLATES;

    // Test 1: mapping returns mobile_developer
    assert.strictEqual(normalizeRoleToFamily('iOS Engineer'), 'mobile_developer');

    // Test 2: template exists and contains swift as a must_have
    assert.ok(ROLE_SKILL_TEMPLATES.mobile_developer, 'mobile_developer template missing');
    assert.ok(Array.isArray(ROLE_SKILL_TEMPLATES.mobile_developer.must_have), 'must_have missing');
    assert.ok(ROLE_SKILL_TEMPLATES.mobile_developer.must_have.includes('swift'), 'swift not in must_have');

    // Test 3: title-match simulation with Kyle's sample text
    const sampleText = `Cincinnati, OH 513-305-0246
kyle@hypertrofit.com macrochief.com hypertrofit.com

About
iOS Developer with 5 years of experience in developing innovative applications in a startup environment. Founder and iOS developer at HypertroFit (Macro Chief App), with expertise in SwiftUI, Core Data, CloudKit, MVVM, and integrating technologies such as Firebase, RevenueCat, and Node.js. Proven track record in managing the complete lifecycle of app development, from concept to deployment.
`;

    const textLower = sampleText.toLowerCase();
    const jobTitleLower = 'ios engineer';
    const ACRONYM_ALLOW = ['ios', 'ml', 'qa'];
    let titleScore = 0;
    if (ACRONYM_ALLOW.some(a => jobTitleLower.includes(a)) && ACRONYM_ALLOW.some(a => textLower.includes(a))) {
      titleScore = 10;
    } else {
      const titleWords = jobTitleLower.split(/\s+/).filter(w => w.length > 0);
      const matchedWords = titleWords.filter(word => word.length > 3 && textLower.includes(word));
      titleScore = Math.round((matchedWords.length / titleWords.length) * 10);
    }

    assert.strictEqual(titleScore, 10, 'titleScore should be 10 for sample text');

    console.log('score-mobile tests passed');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();


