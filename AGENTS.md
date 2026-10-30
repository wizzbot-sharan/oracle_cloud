# Agent rules (auto-loaded every session)

## Session start
- Read ABOUT_ME.md, PROJECT.md, STATE.md, DECISIONS.md. Open docs/* only when the task touches them.
- Reply with a 3-line "where we are" before anything else.

## How to work with me
- I describe requirements conversationally and loosely. Do NOT start coding from my first message.
- Ask clarifying questions (numbered, batched) until you have full clarity. Re-ask if anything I said is ambiguous or conflicts with DECISIONS.md.
- Before executing, send a short summary: what you understood, files you will touch, what you will build, how you will verify it. Wait for my "go".
- Skip that confirm step only for trivial fixes (typo, rename). Still say what changed.
- I'm new to Playwright and Node backends. Explain a new concept in 1-2 lines the first time, with a Python/SQL analogy if it helps. No lectures.
- Be concise. Don't restate my message. No long preambles.

## Session end
- On "wrap up": overwrite `context.md` with the current technical snapshot, overwrite `STATE.md` with current operational status, and append only new decisions (with the why) to `DECISIONS.md`. Max 3 lines per decision entry.

## Stack (do not change without asking)
Node.js + Playwright (bot) | React.js (dashboard) | Azure PostgreSQL | Railway hosting | .env locally, Railway Variables in prod.

## Hard rules
1. NEVER auto-submit. Submission requires the dashboard "Approve" click. Enforce with a status gate in code (applications.status must be `approved`), not only in the UI.
2. CAPTCHA or any bot challenge: pause, take a screenshot, set run status `needs_human`, wait for me. After we find where all the captcha is coming we will try to bypass using multiple tools and methods.
3. Secrets (passwords, tokens, OTPs, app passwords) never go in code, logs, screenshots or commits. Mask emails and OTPs in logs. `.env` is git-ignored.
4. Pace: configurable delay between steps, max concurrency 1 until I say otherwise, stop a user's run after repeated errors or blocks (circuit breaker).
5. Per-user isolation: every row, run, log and screenshot carries `user_id`. One fresh browser context per user per run. Never share cookies or sessions between users.
6. Idempotency: before applying, check `user_id + job_id` isn't already submitted. Never double-submit.
7. Ask before destructive DB operations (drop, delete, prod migrations).

## Code conventions
- Small modules, one job each. Comments explain why, not what.
- All site selectors live in one file per site (`src/sites/oracle/selectors.js`). Prefer getByRole / getByLabel over brittle CSS.
- Every step logs `{user_id, job_id, step, result}`. Screenshot on every failure and when Submit becomes visible; the scanner must never click Submit.
- Config comes only from environment variables.

keep this in mind as well:
# Engineering Instructions

## Before coding
- Inspect relevant files and existing patterns.
- Understand the current architecture before proposing changes.
- For complex tasks, create a plan before implementation.
- Ask questions when requirements materially affect the design.

## Implementation
- Make the smallest complete change that solves the task.
- Reuse existing utilities, components, and conventions.
- Avoid unnecessary dependencies and unrelated refactoring.
- Handle errors, validation, security, and edge cases.
- Never hardcode secrets or expose credentials.

## Testing
- Add or update tests for changed behavior.
- Run relevant tests, lint, and type checks.
- Never claim a test passed unless it was actually run.
- Fix regressions caused by the change.

## Git
- Check git status before editing.
- Never discard existing user changes.
- Do not commit, push, or merge unless requested.
- Summarize changed files, tests, and known limitations.

## Communication
- Explain important trade-offs briefly.
- Report blockers rather than silently working around them.

Use the following skills whenever relevant and available:

- **brainstorming** — Explore ideas, requirements, and approaches before coding.
- **interview-me** — Ask clarifying questions in conversational rounds until requirements are clear.
- **writing-plans** — Create a structured implementation plan before substantial changes.
- **executing-plans** — Implement the approved plan step by step.
- **systematic-debugging** — Identify root causes before attempting fixes.
- **test-driven-development** — Write tests before implementation and verify changes.
