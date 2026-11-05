# Submission readiness

Status checked on November 5, 2026. The prototype is implemented; a live provider evaluation and the candidate's submission materials remain.

## Ready

- [x] Standalone FastAPI + React project and private GitHub repository.
- [x] Transcript upload, parsing, chunking, persistent storage, meeting library and transcript viewer.
- [x] Demo excerpt search and OpenAI / Anthropic answer-generation integration.
- [x] Conversation history, follow-up query rewriting, structured meeting notes and citation validation.
- [x] Session-only Claude connection dialog with an actual provider access check.
- [x] Local automated checks previously passed: 28 backend tests, 5 frontend tests, production build.
- [x] README, architecture, trade-offs, productionization notes, sample transcript and screenshots.

## Required before submission

- [ ] Revoke the credential shared in chat and create a replacement Anthropic Console API key with usable credits/model access.
- [ ] In the local app, click **Connect Claude**, enter the replacement key, and connect. Never send the replacement key in chat or commit it to Git.
- [ ] Wait for the selected meeting to reprocess to **ready**; ask about decisions, the security review owner, and unresolved topics.
- [ ] Complete `evaluation.md` against the real provider, including follow-ups, missing information, proposed versus confirmed decisions, and evidence inspection. Record actual results.
- [ ] Resolve or document the GitHub Actions startup failure. Latest checked run: https://github.com/prasanthmaran/minutes-meeting-intelligence/actions/runs/41867494286 . GitHub reports zero jobs and supplies no job logs through the API. Local checks are not a passing CI run.
- [ ] Capture screenshots of real AI answers and generated meeting notes. Current screenshots demonstrate demo mode and connection setup.
- [ ] Write personal reasoning in `candidate-reflection.md` and review the README in your own words. Do not submit the prompts as completed reflections.
- [ ] Record the short Loom walkthrough using `demo-walkthrough.md` and add its link to the README/submission.
- [ ] Arrange access for the reviewers: the repository is private. Add the specified reviewers or choose a visibility change when ready.

## Optional extensions, not assignment blockers

Automatic meeting attendance, calendar integration, voice transcription, cross-meeting search, streaming chat, public deployment, authentication and multi-user support. Docker is optional and is not being used for the local prototype.
