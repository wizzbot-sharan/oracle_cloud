# Decisions (append only: date, decision, why)

- 2026-10-26: Node.js + Playwright for the bot, React.js for the dashboard. Why: my choice; I know JS better than a new Python browser stack.
- 2026-10-26: Azure PostgreSQL for data, Railway for hosting, secrets in .env locally and Railway Variables in prod.
- 2026-10-26: Two-phase flow (scan with dummy email, then submit with real login). Why: collect all answers before touching real accounts.
- 2026-10-26: Never auto-submit; the dashboard Approve click is the only trigger. Why: avoid wrong or irreversible applications.
- 2026-10-26: CAPTCHA = pause and wait for me in headed mode. No solving or bypass code is built. Why: avoid blocks and terms-of-service trouble.
- 2026-10-26: Matching algorithms (fuzzy, embeddings, cosine similarity, LLM) are research items; v1 uses exact/alias matching only.
- 2026-10-26: Concurrency 1 at first. Why: reduce block risk while we learn how the site reacts.
- 2026-10-26: "Who I am" lives once in ABOUT_ME.md, not repeated in every file. Why: saves tokens every session.
- 2026-10-27: Automated Zoho Mail Reader integration for OTP and Magic Link retrieval. Why: eliminates manual intervention while respecting masked credentials.
- 2026-10-27: Per-company concurrency lock and Oracle tenant code matching. Why: prevents parallel workers from cross-contaminating OTP codes in a shared mailbox.
- 2026-10-27: Global 10s tab pacing gate and OneTrust Privacy Preference Center dismissal. Why: avoids portal WAF triggers and unblocks navigation to Apply Now.
- 2026-10-28: Supersede the initial fixed concurrency-1 limit with configurable concurrency sized to production infrastructure and observed portal limits. Why: the system serves multiple users and worker capacity will change, while pacing, per-company controls, and circuit breakers remain mandatory.
- 2026-10-28: Phase 1 only fills a control when its question container and target are uniquely scoped. Why: prevents a repeated Yes/No or title button from selecting an unrelated question.
- 2026-10-28: OTP failures record only parsing structure and masked metadata. Why: new email layouts can be diagnosed without storing OTPs, bodies, or unmasked emails.
- 2026-10-28: The dashboard remains display-only; repeaters use inactive Oracle-style previews. Why: the viewer should mirror scanned form structure without changing local or Oracle application state.
- 2026-10-28: Group custom Oracle radio/checkbox buttons by the stable question container, not the option label or global index. Why: one safe, scoped field record preserves all options and prevents cross-question filling.
- 2026-10-28: Repeater schemas are sampled once and rendered inactive in the viewer. Why: repeated entries share a schema, while the viewer must remain evidence-only.
