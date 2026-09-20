# Bright Future Notes

Approved by the user in chat: reproduce the supplied HTML's branding and content with a polished responsive UI, using separate frontend, backend, and admin folders and dummy data. Use 9161868600 throughout (WhatsApp country code: 91).

React applications provide the storefront and admin dashboard. A Node HTTP API serves the catalogue, demo accounts, demo orders, and protected administration. A local JSON store persists admin changes; no real payments or email are sent. The original embedded logo is extracted without changing it.

Keep five exam categories, original note titles/prices, benefits, offers, and blue #073b8f / orange #f46b00. Use accessible controls, visible focus, responsive grids, search/category filters, sample preview, demo checkout, demo student library, and a mobile menu. Admin supports catalogue CRUD, offer editing, order status updates, search, and demo overview metrics.

Validate payloads server-side; server decides prices; admin sessions use HttpOnly cookies, password hashing and login throttling. Development credentials are explicitly documented and refused in production. Handle loading, empty, and failure states. Test API validation, authorization, catalogue persistence, and demo orders; build both React entries and smoke test rendered screens when browser tooling is available.
