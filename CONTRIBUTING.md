# Contributing

Thanks for helping improve NakedProfessor.

## Before you start

- Read `README.md` for the current app flow.
- Read `SECURITY.md` if your change touches secrets, deployment, or user data.
- Keep changes tightly scoped to the issue you are solving.

## Local checks

From the repo root, run the checks relevant to your change:

```bash
cd frontend
npm install
npm test
npm run build
```

If you touch the Python scraper or Streamlit app, also run the relevant Python checks or smoke tests for that area.

## Good contribution habits

- Prefer small pull requests.
- Update docs when behavior changes.
- Add or update tests for bug fixes and guardrails.
- Avoid broad refactors unless they are necessary for the task.

## Security and privacy

- Never commit secrets.
- Be careful with professor and school-related data.
- Document any new persistence, exports, or user data collection.

## Need a review clue?

Include in your PR description:
- what changed
- why it changed
- how you verified it
- anything not covered by tests
