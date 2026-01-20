# Role Specific Feedback Sanitization — Implementation Notes

## Summary of Changes
- **Modified Files**
  - `app/functions/_lib/feedback-validator.js` — Added sanitization helpers and strict validation
  - `app/functions/api/resume-feedback.js` — Enforced sanitization at parse, result build, cache, and D1 storage
  - `app/functions/_lib/db.js` — Added read-time sanitization in `getFeedbackSessionById`
  - `app/functions/api/resume-feedback/latest.js` — Added sanitization before returning `roleSpecificFeedback`
  - `resume-feedback-pro.html` — Added UI filtering to prevent blank cards

## Key Changes

**A) Sanitization Helpers (`feedback-validator.js`)**
- `sanitizeRoleSpecificFeedback(rsf)`:
  - Filters `sections` to objects only (drops strings, nulls, arrays)
  - Enforces required fields and types (section, fitLevel, diagnosis, tips, rewritePreview)
  - Validates `fitLevel` enum (defaults to `tunable` if invalid)
  - Drops sections with no meaningful content (empty diagnosis + tips + rewritePreview)
  - Returns `null` if no valid sections remain
- `isRoleSpecificFeedbackStrict(rsf)`:
  - Returns `true` only when every section is an object and all fields are correct types
- Updated `validateAIFeedback` and `isValidFeedbackResult` to use strict validation and to require that legacy arrays contain only objects

**B) Resume Feedback Handler (`resume-feedback.js`)**
- Immediate sanitization after `JSON.parse(aiResponse.content)` (prevents malformed data from being used)
- Strict validation when building `result.roleSpecificFeedback` (never return mixed-type arrays)
- Final defensive sanitization before KV cache write and before D1 `createFeedbackSession`

**C) Read-Time Defense (DB / latest)**
- `getFeedbackSessionById` now sanitizes `feedback_json` after parsing so history detail never returns corrupted payloads
- `/api/resume-feedback/latest` sanitizes before adding `roleSpecificFeedback` to the response

**D) UI Defensive Rendering**
- `populateRoleSpecificFeedback` / `updateFeedbackGrid` now filter sections to valid object entries with meaningful content
- If no valid sections remain, the UI shows a friendly fallback message instead of blank "Tunable" cards
- Legacy old-format arrays are still supported but filtered to objects only

## Key Diff Snippets (high-level)
1. Sanitization helper (example):
```js
export function sanitizeRoleSpecificFeedback(rsf) {
  const objectSections = rsf.sections.filter(item => item && typeof item === 'object' && !Array.isArray(item));
  // …coerce/validate fields, drop empty sections…
  return cleanSections.length > 0 ? { targetRoleUsed, sections: cleanSections } : null;
}
```

2. Parse-time sanitization (resume-feedback.js):
```js
aiFeedback = JSON.parse(aiResponse.content);
if (aiFeedback?.roleSpecificFeedback) {
  aiFeedback.roleSpecificFeedback = sanitizeRoleSpecificFeedback(aiFeedback.roleSpecificFeedback) || null;
}
```

3. Result building strict check:
```js
roleSpecificFeedback: (() => {
  if (isRoleSpecificFeedbackStrict(rsf)) return rsf;
  const sanitized = sanitizeRoleSpecificFeedback(rsf);
  return sanitized || (shouldAddFallbackTips ? buildFallbackRoleTips(...) : null);
})(),
```

4. DB read-time defense (getFeedbackSessionById):
```js
feedbackData = JSON.parse(row.feedback_json);
if (feedbackData?.roleSpecificFeedback) {
  feedbackData.roleSpecificFeedback = sanitizeRoleSpecificFeedback(feedbackData.roleSpecificFeedback) || null;
}
```

5. UI filtering (populateRoleSpecificFeedback):
```js
const validSections = sections.filter(section => (
  section && typeof section === 'object' && (
    (section.diagnosis && section.diagnosis.trim()) ||
    (Array.isArray(section.tips) && section.tips.length) ||
    (section.rewritePreview && section.rewritePreview.trim())
  )
));
```

## Acceptance Criteria (met)
- Valid `roleSpecificFeedback` renders normally.
- Malformed payloads are never persisted to D1/KV.
- History/latest endpoints never return corrupted `sections` arrays.
- UI never shows blank Tunable cards; it shows a helpful fallback when no valid sections exist.
- Legacy `old format` arrays are preserved when valid (objects only).

---

Branch: `fix/role-specific-feedback-sanitization` → PR: #420
