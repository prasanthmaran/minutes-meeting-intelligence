# Verification record

## Verified locally

- Backend automated tests, including simulated AI orchestration and invalid-citation rejection.
- Frontend tests and TypeScript/production build.
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
