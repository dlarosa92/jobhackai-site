# JobHackAI Design System

## 1. Brand Identity

### Colors
```css
--color-bg-light: #F9FAFB;           /* Site background */
--color-text-main: #1F2937;          /* Main text (slate) */
--color-text-secondary: #4B5563;     /* Secondary text (gray) */
--color-text-muted: #6B7280;         /* Muted text */
--color-card-bg: #FFFFFF;            /* Cards, nav, footer */
--color-cta-green: #007A30;          /* Primary CTA (button green), WCAG AA */
--color-accent-blue: #007BFF;        /* Accent blue (links, outlines) */
--color-divider: #E5E7EB;            /* Dividers, borders */
```

### Typography
- Font Family: 'Inter', sans-serif
- Weights:
  - Regular: 400
  - Semibold: 600
  - Bold: 800

### Spacing
```css
--space-xs: 0.5rem;  /* 8px */
--space-sm: 1rem;    /* 16px */
--space-md: 2rem;    /* 32px */
--space-lg: 4rem;    /* 64px */
```

### Border Radius
```css
--radius-card: 16px;
--radius-button: 8px;
```

### Shadows
```css
--shadow-card: 0 2px 8px rgba(0,0,0,0.05);
```

## 2. Components

### Navigation
- Sticky header with logo and main navigation
- Mobile-responsive hamburger menu
- Clear hierarchy with primary and secondary navigation items
- Active state indicators
- Consistent spacing between nav items

### Buttons
- Primary (Green CTA): `--color-cta-green`
- Secondary (Blue): `--color-accent-blue`
- Size: 48px height
- Border radius: `--radius-button`
- Hover state: 10% darker
- Focus state: 2px outline

### Cards
- Background: `--color-card-bg`
- Border radius: `--radius-card`
- Shadow: `--shadow-card`
- Padding: `--space-md`
- Consistent spacing between cards

### Forms
- Input height: 48px
- Border: 2px solid `--color-divider`
- Focus border: `--color-accent-blue`
- Border radius: `--radius-button`
- Label: `--color-text-main`
- Placeholder: `--color-text-muted`

### Tooltip (Info Icon)

- Use the canonical SVG info icon as the trigger for all tooltips.
- Always wrap the icon in a span with class `jh-tooltip-trigger` and include a sibling span with class `jh-tooltip-text` for the tooltip content.
- Example:

```html
<span class="jh-tooltip-trigger" tabindex="0" aria-label="More info">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="vertical-align:middle">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="8"/>
    <line x1="12" y1="12" x2="12" y2="16"/>
  </svg>
  <span class="jh-tooltip-text">Your tooltip text here.</span>
</span>
```

- Tooltip text appears on hover or focus.
- Ensure `aria-label` is present for accessibility.
- The icon inherits color and matches the icon system (24x24, 2px stroke).

## 3. Navigation Structure

### Main Navigation
```