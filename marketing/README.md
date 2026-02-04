# JobHackAI Marketing Site

## Purpose
The `/marketing` folder contains the standalone, static acquisition site for **jobhackai.io**. It is intentionally isolated from the application at **app.jobhackai.io** and should never share navigation logic, auth logic, or routing assumptions with the app.

## Deployment
- Deployed via **Cloudflare Pages**.
- `main` branch deploys to **jobhackai.io** (production).
- `dev0` and `develop` branches deploy to **preview URLs only**.

## Navigation Separation
Marketing and app navigation are intentionally different:
- Marketing links drive users into the app for pricing, login, and actions.
- Legal/help content is hosted in the app and linked out from marketing.

## Structure
- `css/` holds the reset, design tokens, and marketing layout styles.
- `components/` contains shared HTML partials (header, footer, cookie banner).
- `pages/` contains the marketing pages for the static site.
