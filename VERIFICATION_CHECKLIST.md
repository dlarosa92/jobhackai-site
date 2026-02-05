# Interview Questions UI Verification Checklist

## Pre-Deployment Code Review ✅

### Badge Colors (JavaScript Logic)
- [x] Premium Plan: `#C62828` (red) - Line 3409
- [x] Pro Plan: `#388E3C` (green) - Line 3408
- [x] Trial Plan: `#FF9100` (orange) - Line 3406
- [x] Essential Plan: `#0077B5` (blue) - Line 3407
- [x] Free Plan: `#6B7280` (gray) - Line 3410
- [x] Badge uses inline style: `style="background:${planColor};"` - Line 3417

### HTML Structure
- [x] Feature tile uses `.rf-card` wrapper - Line 1065
- [x] Title uses `.rf-title` class - Line 1066
- [x] Badge container inside title - Line 1068
- [x] Usage container uses `.rf-plan-limit` - Line 1073
- [x] Step instructions outside feature tile - Line 1077

### Unlimited Usage Indicator
- [x] `buildUnlimitedText` function exists - Line 3449
- [x] Checks for `limit === null` - Line 3451
- [x] Checks for `used !== null/undefined` - Line 3452
- [x] Returns format: `"X used this month (unlimited)"` - Line 3453
- [x] Passed to `renderUsageIndicator` for IQ - Line 3463
- [x] Passed to `renderUsageIndicator` for Mock Interviews - Line 3480

### Usage Indicator Component
- [x] Handles unlimited with `used` count - Line 174-207
- [x] Shows circular meter for unlimited - Line 189-202
- [x] Uses green stroke for unlimited meter - Line 196
- [x] Displays custom text when provided - Line 204

---

## Post-Deployment Browser Verification

### Test Case 1: Premium Plan User
**Expected:**
- [ ] Badge shows "Premium Plan" with **RED** background (`#C62828`)
- [ ] Badge is inline with "Interview Questions" title
- [ ] Feature tile has card styling (background, shadow, border-radius)
- [ ] Usage indicator shows: "X used this month (unlimited)" with circular green meter
- [ ] Mock Interviews usage also shows below (if applicable)
- [ ] Both usage indicators are inside the `.rf-card` feature tile

**Actual Issues:**
- 

### Test Case 2: Pro Plan User
**Expected:**
- [ ] Badge shows "Pro Plan" with **GREEN** background (`#388E3C`)
- [ ] Badge is inline with "Interview Questions" title
- [ ] Feature tile has card styling
- [ ] Usage indicator shows: "X used this month (unlimited)" with circular green meter
- [ ] Mock Interviews usage also shows below

**Actual Issues:**
- 

### Test Case 3: Trial Plan User
**Expected:**
- [ ] Badge shows "Trial Plan" with **ORANGE** background (`#FF9100`)
- [ ] Badge is inline with title
- [ ] Feature tile has card styling
- [ ] Usage indicator shows quota-based meter (if limited) or unlimited with count

**Actual Issues:**
- 

### Test Case 4: Essential Plan User
**Expected:**
- [ ] Badge shows "Essential Plan" with **BLUE** background (`#0077B5`)
- [ ] Badge is inline with title
- [ ] Feature tile has card styling
- [ ] Usage indicator shows quota-based meter

**Actual Issues:**
- 

### Visual Consistency Check
- [ ] Feature tile matches resume-feedback-pro.html structure
- [ ] Title and badge alignment matches canonical pattern
- [ ] Usage indicators are properly spaced inside tile
- [ ] Step instructions are outside tile with proper margin
- [ ] No hardcoded blue badge (all badges use dynamic colors)
- [ ] Responsive behavior works on mobile (title/badge wrap correctly)

### Console Errors Check
- [ ] No JavaScript errors in console
- [ ] `/api/usage` call succeeds (POST method)
- [ ] `renderUsageIndicator` function is available
- [ ] No undefined/null reference errors

---

## Known Issues to Watch For

1. **Badge Color Not Applied**: If badge is still blue, check:
   - JavaScript `updatePlanUI` is being called
   - `planColors` object is correct
   - Inline style is being set correctly

2. **Usage Indicator Not Showing**: Check:
   - `/api/usage` returns correct data structure
   - `data.usage.interviewQuestions` exists
   - `usage.limit === null` for unlimited plans
   - `usage.used` is populated for unlimited plans

3. **Unlimited Text Not Showing**: Check:
   - `buildUnlimitedText` returns correct string
   - `customText` is passed to `renderUsageIndicator`
   - Component uses `customText` when provided

4. **Feature Tile Not Visible**: Check:
   - `.rf-card` CSS is defined
   - Card has background, shadow, padding
   - No conflicting styles hiding the card

---

## Deployment Steps

1. Commit changes:
   ```bash
   git add interview-questions.html js/components/usage-indicator.js
   git commit -m "feat: standardize Interview Questions UI to canonical design system"
   ```

2. Merge to dev0:
   ```bash
   git checkout dev0
   git merge interview-questions-ui-take-two
   ```

3. Deploy to dev:
   ```bash
   npm run deploy:qa
   # or
   cd app && wrangler pages deploy out --project-name=jobhackai-app-dev --branch dev0
   ```

4. Verify on dev.jobhackai.io/interview-questions.html

