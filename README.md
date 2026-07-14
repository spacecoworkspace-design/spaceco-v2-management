# spaceco-v2-management

Internal staff/admin tool — check-in/check-out, cashier logs, room management, claim-request review, reports. Real per-staff Supabase Auth accounts + free TOTP MFA (see `../spaceco-v2-shared/../../data-review/SECURITY_DECISIONS.md`) — replaces the old system's single shared client-side password.

Static HTML/CSS/JS, deployed via GitHub Pages, no build step. Public repo (required for free-plan Pages) — source will be readable by anyone, so **no secrets or service-role keys ever go in this repo**, same rule as the other two.

Status: **scaffolded only (Phase 1 — Foundation setup). No feature pages built yet.**

Before writing any page, copy `shared-config/supabase-client.js` from `spaceco-v2-shared` into this repo rather than creating a new Supabase client inline.
