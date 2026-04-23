# NakedProfessor Audit & Upgrade Plan

## What this repo is

NakedProfessor combines:
- a Python scraper/data pipeline under `rmp_scraper/`
- a Streamlit app in `app.py`
- a Vite/React frontend in `frontend/`
- serverless OpenAI generation in `frontend/api/generate.js`

The product idea is solid, but the repo currently mixes experimental and production paths without enough guardrails for reliability and maintainability.

## Top 8 weaknesses

1. **No CI workflow**
   - There was no GitHub Actions file, so regressions in the frontend app can land without automated install/test/build verification.

2. **Missing fail-fast environment validation**
   - The OpenAI function returned a generic error when `OPENAI_API_KEY` was missing. This makes deployment/debugging harder and can hide misconfiguration.

3. **Sparse test coverage around config and runtime guardrails**
   - Existing tests cover app flow and analysis logic, but not environment validation or serverless config behavior.

4. **Documentation is inconsistent with the current codebase**
   - README references older app architecture and claims scripts exist that are not present in this repo state.
   - Some guidance is helpful, but some sections appear stale or too optimistic.

5. **Security / secrets handling is under-documented**
   - The repo uses `OPENAI_API_KEY` and Supabase credentials, but there is no `SECURITY.md` or explicit secret-handling guidance.

6. **Data governance / legal-risk signaling is weak**
   - The project stores and serves professor-related data and generated study guidance, but the repo does not clearly spell out data provenance, retention, or user-facing privacy expectations.

7. **Architecture boundary is blurry**
   - The repo contains Streamlit and React implementations of overlapping concepts, which makes it harder to tell what is production vs. support tooling.

8. **Scraper robustness improvements are still needed**
   - The Python data path has useful functionality, but there is little visible evidence of bounded retries, checkpointing, or deterministic school resolution in the parts audited here.

## Priority ranking

1. **Add CI workflow** — highest impact, low effort
2. **Fail-fast env validation for OpenAI generation** — high impact, very low effort
3. **Add tests for environment validation** — high value, low effort
4. **Update README to reflect actual repo state** — medium impact, low effort
5. **Add SECURITY / privacy guidance** — medium impact, low effort
6. **Clarify backend/frontend boundaries** — medium impact, medium effort
7. **Improve scraper retry/checkpoint behavior** — high impact, higher effort
8. **Implement deterministic school matching** — high impact if ambiguity exists, but needs careful domain review

## Implemented first-pass fixes

- Added CI workflow for frontend install/test/build.
- Added a small environment-variable helper for fail-fast validation.
- Added tests covering that helper.
- Standardized the serverless OpenAI API error message to be explicit about the missing env var.

## Notes

I kept the changes narrow on purpose. I did not rewrite the app architecture or change UX behavior.
