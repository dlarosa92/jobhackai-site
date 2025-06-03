# JobHackAI Design System

## 1. Brand Identity

### Colors
```css
--color-bg-light: #F9FAFB;           /* Site background */
--color-text-main: #1F2937;          /* Main text (slate) */
--color-text-secondary: #4B5563;     /* Secondary text (gray) */
--color-text-muted: #6B7280;         /* Muted text */
--color-card-bg: #FFFFFF;            /* Cards, nav, footer */
--color-cta-green: #00E676;          /* Primary CTA (button green) */
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

## 3. Navigation Structure

### Main Navigation
```
Home
├── Features
│   ├── Resume Builder
│   ├── Interview Prep
│   └── Job Search
├── Pricing
├── Blog
└── Support
```

### User Navigation (Logged In)
```
Dashboard
├── Resume Builder
├── Interview Prep
│   ├── Mock Interviews
│   └── Question Bank
├── Job Search
│   ├── Saved Jobs
│   └── Applications
├── Account
│   ├── Profile
│   ├── Settings
│   └── Billing
└── Help
```

### Footer Navigation
```
Company
├── About
├── Careers
└── Contact

Product
├── Features
├── Pricing
└── Roadmap

Resources
├── Blog
├── Help Center
└── Documentation

Legal
├── Privacy
├── Terms
└── Security
```

## 4. Responsive Breakpoints

- Mobile: < 640px
- Tablet: 641px - 1024px
- Desktop: > 1024px

## 5. Accessibility Standards

- WCAG 2.1 AA compliance
- Minimum contrast ratio: 4.5:1
- Focus states for all interactive elements
- ARIA labels where necessary
- Keyboard navigation support

## 6. Animation Guidelines

- Duration: 150ms - 300ms
- Easing: ease-in-out
- Hover transitions: 150ms
- Page transitions: 300ms
- Loading states: 600ms

## 7. Icon System

- Stroke width: 2px
- Size: 24px (default)
- Color: Inherits from parent
- Consistent style across all icons

## 8. Error States

- Error text: Red (#DC2626)
- Error border: 2px solid #DC2626
- Success text: Green (#059669)
- Success border: 2px solid #059669

## 9. Loading States

- Skeleton loading for cards
- Spinner for buttons
- Progress indicators for forms
- Consistent loading animations

## 10. Implementation Guidelines

1. Use CSS variables for all design tokens
2. Maintain consistent spacing using the spacing scale
3. Follow the component hierarchy
4. Ensure responsive design at all breakpoints
5. Test accessibility compliance
6. Document any deviations from the system 