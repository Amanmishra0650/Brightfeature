# Bright Future Implementation Plan

**Goal:** Build the approved notes storefront, backend, and admin using dummy data.
**Architecture:** Two React entry points share styling and API helpers; a Node HTTP service persists JSON data and serves built assets.
**Tech Stack:** React, Vite, Node.js native HTTP and test runner.
**Spec:** docs/superpowers/specs/2026-09-13-bright-future-design.md

## Constraints
- Preserve original logo, exam categories, prices, and blue/orange palette.
- Phone: 9161868600. Required directories: frontend, backend, admin.
- Demo data only; no real payments or account promises.

## Tasks
- [x] Create package scripts, Vite entries, extract logo, and seed catalogue.
- [x] Write API integration tests in backend/server.test.js for unauthorized writes, invalid inputs, login, catalogue CRUD, server-calculated demo orders, and student privacy. Run `node --test backend/server.test.js` to confirm missing implementation.
- [x] Implement backend/store.js and backend/server.js. GET /api/notes returns published notes; /api/session manages student demo identity; POST /api/orders creates a demo order; /api/admin/* requires an admin session. Persist local data atomically. Run tests.
- [x] Implement frontend/src/App.jsx, components, and responsive CSS: navigation, hero, notes search/filter, previews, checkout, benefits, offers, student demo library, footer.
- [x] Implement admin/src/App.jsx: login, overview, catalogue editor, orders, offer settings. Show validation and success feedback.
- [x] Run `npm run build`, API tests, and browser smoke checks. Review paths, credentials, phone replacement, and narrow/mobile layouts. Document startup and demo limitations in README.md.
