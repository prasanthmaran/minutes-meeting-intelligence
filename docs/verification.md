# Verification record

## Verified locally

- 28 backend automated tests passed, including simulated AI orchestration and invalid-citation rejection.
- 5 frontend tests passed; TypeScript and production build passed.
- SQLite migration upgrade → downgrade → upgrade.
- Browser: sample upload, processing to ready, transcript viewer, persisted chat, clickable evidence, and unsupported-topic response in demo mode.
- Frontend dependency audit: zero reported vulnerabilities after test-tooling upgrades.
- Compose configuration syntax (not container runtime).

## Not verified

- Live OpenAI generation/embedding quality: no API key configured for these checks. Mocked-provider tests do not replace live evaluation.
- PostgreSQL/pgvector and container runtime: Docker is not being used, per user preference.
- Production deployment, multiple users, load, or complete accessibility compliance.

## Submission status

Screenshots are in `docs/screenshots/`. The Loom walkthrough and candidate reflection are prompts for the candidate to complete in their own words. Automatic meeting joining is not implemented.

## GitHub repository

Created and pushed to the private repository:
https://github.com/prasanthmaran/minutes-meeting-intelligence

The initial GitHub Actions run reported `startup_failure` before creating any jobs. GitHub API diagnostics returned no job logs or check annotations establishing the cause. This is not a passing CI result; local test/build results above are separate. Review the run at:
https://github.com/prasanthmaran/minutes-meeting-intelligence/actions/runs/41821715553

## Anthropic integration

Added a session-only Claude key-entry dialog with a short live connection check before activation. Deterministic tests cover the structured Anthropic HTTP request, key rejection guards, key non-disclosure, ingestion and answers without embedding calls, and frontend success/failure states. Live Claude answers were verified on November 5, 2026 after the user connected through the local app. Four sample checks passed: review owner/deadline, a contextual follow-up, abstaining on an unsupported approved salary budget, and distinguishing a proposed metric from an approved one. All returned citation IDs belonged to the selected meeting. The previously pasted chat credential was not used by the agent.

## Live Claude core evaluation — November 5, 2026

Provider: Anthropic, `claude-haiku-4-5-20251001`. The sample meeting was ready in Anthropic mode with generated summaries, decisions, action owners/deadlines, and unresolved questions.

| Check | Observed | Result |
|---|---|---|
| Owner / deadline | Sam, November 10 | Pass |
| Follow-up | A critical security issue stops launch until fixed | Pass |
| Unsupported budget | No dollar figure invented; marked insufficient evidence | Pass |
| Proposal vs approval | Pilot metric remains proposed, awaiting product approval | Pass |

Evidence: [recorded answers and citation checks](evaluations/claude-core-2026-11-05.json). This covers one sample; multilingual accuracy, prompt-injection resistance, and broad production reliability have not been established by this check.
