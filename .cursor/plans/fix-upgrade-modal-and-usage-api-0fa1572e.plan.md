<!-- 0fa1572e-03a0-47da-b1ee-28a36db8d52e 8e2ce180-e1bc-43a8-bb85-b86305e6aa0a -->
# Fix Upgrade Modal and Usage API Issues

## Issue 1: Upgrade Modal Showing Incorrectly

**Problem**: The "previous ATS resume score has been carried over" modal appears for all paid accounts (trial, essential, pro, premium) even when they weren't upgraded from free accounts. It should only show:

- After user upgrades from free to trial/paid subscription
- Only if they uploaded a resume while in free account tier
- Only once (first login after upgrade)

**Files to modify**:

- `dashboard.html` (lines 1350-1492) - Upgrade popup logic
- `app/public/dashboard.html` (if exists) - Same logic
- `app/src/pages/dashboard.tsx` (if exists) - Same logic

**Changes**:

1. Add check to ensure modal only shows once after upgrade (already has `upgrade-popup-shown` localStorage check, but needs improvement)
2. Add timestamp-based check: only show within 7 days of upgrade
3. Improve logic to detect actual upgrade event vs. existing paid account
4. Store upgrade timestamp when user upgrades (in checkout success or webhook handler)

## Issue 2: Usage API Empty Body

**Problem**: `/api/usage` request uses POST method with `Content-Type: application/json` header but sends no request body. Some middleware may reject this.

**Files to modify**:

- `resume-feedback-pro.html` (lines 1723-1729) - Usage API fetch call

**Changes**:

1. Add empty JSON object `{}` as request body to satisfy Content-Type requirement
2. Verify API endpoint handles empty body correctly (it should, since it uses Bearer token auth)

## Implementation Steps

1. Fix upgrade modal logic in `dashboard.html`:

- Add upgrade timestamp tracking
- Improve condition to check if user JUST upgraded (not just currently on paid plan)
- Add time window check (7 days after upgrade)

2. Fix usage API call in `resume-feedback-pro.html`:

- Add `body: JSON.stringify({})` to fetch call

3. Check and update other dashboard files if they exist:

- `app/public/dashboard.html`
- `app/src/pages/dashboard.tsx`

4. Test both fixes:

- Verify modal only shows after upgrade from free
- Verify modal doesn't show for existing paid accounts
- Verify usage API call succeeds

### To-dos

- [ ] Fix upgrade modal logic in dashboard.html to only show after actual upgrade from free account, not for existing paid accounts
- [ ] Add empty JSON body to /api/usage POST request in resume-feedback-pro.html
- [ ] Apply same fixes to app/public/dashboard.html and app/src/pages/dashboard.tsx if they exist
- [ ] Verify modal only shows after upgrade and usage API works correctly