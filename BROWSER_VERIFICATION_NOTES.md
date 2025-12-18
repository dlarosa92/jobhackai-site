# Browser Verification Notes - Interview Questions UI

## Code Review Summary ✅

### Fixed Issues
1. ✅ Changed `<h1 class="rf-title">` to `<div class="rf-title">` to match canonical pattern
2. ✅ Badge colors are dynamically set in JavaScript (not hardcoded in CSS)
3. ✅ Feature tile structure matches resume-feedback-pro.html exactly
4. ✅ Unlimited usage shows meter + "X used this month (unlimited)" text
5. ✅ All design system classes are used (`.rf-card`, `.rf-title`, `.rf-plan-badge`, `.rf-plan-limit`)

---

## Critical Verification Points

### 1. Badge Color Verification
**Test with different plans in localStorage:**
```javascript
// Premium (should be RED #C62828)
localStorage.setItem('user-plan', 'premium');
location.reload();

// Pro (should be GREEN #388E3C)
localStorage.setItem('user-plan', 'pro');
location.reload();

// Trial (should be ORANGE #FF9100)
localStorage.setItem('user-plan', 'trial');
location.reload();

// Essential (should be BLUE #0077B5)
localStorage.setItem('user-plan', 'essential');
location.reload();
```

**What to check:**
- [ ] Premium badge is **RED** (not blue!)
- [ ] Pro badge is **GREEN**
- [ ] Trial badge is **ORANGE**
- [ ] Essential badge is **BLUE**
- [ ] Badge appears inline with "Interview Questions" text
- [ ] Badge has proper padding and border-radius (pill shape)

**If badge is still blue:**
- Check browser console for JavaScript errors
- Verify `updatePlanUI()` is being called
- Check if `planColors` object is correct
- Inspect element to see if inline style is applied: `style="background:#C62828;"`

---

### 2. Feature Tile Structure
**Visual check:**
- [ ] Title "Interview Questions" is inside a card container
- [ ] Card has white/light background
- [ ] Card has shadow (subtle elevation)
- [ ] Card has rounded corners
- [ ] Card has proper padding (not cramped)
- [ ] Plan badge is on same line as title
- [ ] Description text is below title
- [ ] Usage indicator is below description, inside the card
- [ ] Step instructions ("Step 1: Generate...") are OUTSIDE the card

**Compare with:** `resume-feedback-pro.html` - should look identical in structure

---

### 3. Unlimited Usage Indicator
**For Premium/Pro users with unlimited plans:**

**Expected behavior:**
- [ ] Shows circular green meter (full circle, not partial)
- [ ] Shows text: "X used this month (unlimited)" where X is the actual count
- [ ] Meter is green (`var(--color-cta-green)`)
- [ ] Text is secondary color (gray)
- [ ] Both Interview Questions AND Mock Interviews show if Pro/Premium

**If it shows "Unlimited with your Premium plan" instead:**
- Check if `/api/usage` returns `usage.used` value
- Check if `usage.limit === null` (unlimited)
- Verify `buildUnlimitedText()` function is working
- Check console for API response structure

**API Response should look like:**
```json
{
  "usage": {
    "interviewQuestions": {
      "limit": null,
      "used": 42,
      "remaining": null
    },
    "mockInterviews": {
      "limit": null,
      "used": 5,
      "remaining": null
    }
  }
}
```

---

### 4. Limited Plan Usage Indicator
**For Trial/Essential users:**

**Expected behavior:**
- [ ] Shows circular meter with percentage filled
- [ ] Shows "X / Y used" format
- [ ] Shows "Z remaining" if applicable
- [ ] Meter color changes based on usage:
  - Green: 0-33% used
  - Yellow: 33-66% used
  - Red: 66-100% used

---

### 5. Mock Interviews Usage (Pro/Premium only)
**Expected:**
- [ ] Appears below Interview Questions usage
- [ ] Has proper spacing (0.5rem gap)
- [ ] Shows same format as Interview Questions
- [ ] Only visible for Pro/Premium plans

---

## Common Issues & Solutions

### Issue: Badge is still blue
**Cause:** JavaScript not executing or plan not detected
**Fix:**
1. Check console for errors
2. Verify `updatePlanUI()` is called in `updateInterviewUIForPlan()`
3. Check if plan is correctly retrieved from localStorage
4. Verify inline style is being applied

### Issue: Usage indicator not showing
**Cause:** API call failing or data structure mismatch
**Fix:**
1. Check Network tab for `/api/usage` call
2. Verify response status is 200
3. Check response body structure
4. Verify `window.renderUsageIndicator` exists

### Issue: "Unlimited" text instead of "X used this month"
**Cause:** `usage.used` is null/undefined or `buildUnlimitedText` not working
**Fix:**
1. Check API response - does it include `used` field?
2. Verify `usage.limit === null` (truly unlimited)
3. Check `buildUnlimitedText()` logic
4. Verify `customText` is passed to `renderUsageIndicator`

### Issue: Feature tile not visible
**Cause:** CSS not loading or conflicting styles
**Fix:**
1. Check if `.rf-card` styles are defined (lines 54-60)
2. Verify no conflicting styles hiding the card
3. Check if design tokens are loaded (`var(--color-card-bg)`)

### Issue: Title and badge not aligned
**Cause:** Flexbox not working or margin issues
**Fix:**
1. Verify `.rf-title` has `display: flex` (line 66)
2. Check `align-items: center` (line 67)
3. Verify `gap: 0.75rem` (line 68)

---

## Browser Console Commands for Testing

```javascript
// Check current plan
localStorage.getItem('user-plan')

// Check if updatePlanUI is defined
typeof updatePlanUI

// Manually trigger update
updatePlanUI('premium')

// Check badge container
document.getElementById('plan-badge-container').innerHTML

// Check usage container
document.getElementById('iq-usage-container').innerHTML

// Check API response
fetch('/api/usage', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${await getFirebaseToken()}`
  }
}).then(r => r.json()).then(console.log)
```

---

## Screenshot Checklist

Take screenshots of:
1. [ ] Premium plan - badge color (RED)
2. [ ] Pro plan - badge color (GREEN)
3. [ ] Trial plan - badge color (ORANGE)
4. [ ] Feature tile structure (card visible)
5. [ ] Unlimited usage indicator with meter
6. [ ] Limited usage indicator with meter
7. [ ] Mobile responsive view (title/badge wrapping)

---

## Final Verification

After deployment, verify:
- [ ] All badge colors are correct (no blue badges for Premium!)
- [ ] Feature tile is visible and styled correctly
- [ ] Usage indicators show inside the tile
- [ ] Unlimited plans show "X used this month (unlimited)"
- [ ] No console errors
- [ ] Page matches resume-feedback-pro.html structure
- [ ] Mobile responsive works correctly

