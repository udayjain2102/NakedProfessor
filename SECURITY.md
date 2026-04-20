# Security Policy

## Supported versions

This repository is actively developed on `main`. Security fixes should target the current main branch and be backported only when necessary.

## Reporting a vulnerability

If you discover a security issue, report it privately to the repository maintainer rather than opening a public issue.

Include:
- what component is affected
- steps to reproduce
- impact assessment
- whether credentials, tokens, or user data may be exposed

## Secret handling

- Never commit API keys, OAuth tokens, or service credentials.
- Use environment variables for runtime secrets.
- Treat `OPENAI_API_KEY`, Supabase credentials, and any scraper auth material as sensitive.
- Rotate secrets immediately if they are exposed in logs, commits, or screenshots.

## Data handling

This project may process professor and school metadata from third-party sources. If you add user-submitted data or persistent storage:
- document what is stored
- document retention and deletion behavior
- avoid storing sensitive information unless it is necessary
- review privacy and licensing implications before publishing

## Safe development practices

- Prefer least-privilege deployment settings.
- Keep dependency updates reviewable and pinned through lockfiles.
- Validate environment variables at startup so misconfiguration fails fast.
- Do not log full secrets or raw authentication headers.
