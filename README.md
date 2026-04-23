# NakedProfessor

This project provides a web application that downloads the StateUniversity.com ranked 4-year colleges
list and enumerates professors from a third-party professor rating GraphQL API for each school.

Default rankings view: top 200 schools plus Penn State Behrend (Erie, PA) if it is
not already in that list, displayed in an interactive table and exportable to a versioned normalized artifact (`professors.normalized.v1.json`).

## Features

- Fetches ranked schools from StateUniversity.com (Creative Commons license) and caches them
  as JSON so repeated page loads avoid hammering their servers. The cache is sliced or refreshed
  when you change the limit setting.
- Uses the (currently working as of April 11, 2026) `https://www.ratemyprofessors.com/graphql`
  endpoint to discover schools and enumerate professors.
- Displays professor data in a sortable, filterable table with ranking metadata, plus fields
  like average rating, difficulty, and a professor profile URL. Results can be exported to CSV.

## Quick Start

1. Install dependencies (survival web app)

```bash
cd frontend
npm install
```

2. Start the development server

```bash
npm run dev
```

3. Open the local URL shown in the terminal (or your latest [Vercel deployment](https://vercel.com) after connecting this repo).

## Usage

- Rankings page: browse the top 200 schools plus Penn State Behrend. Use the limit selector
  to load more schools. Behrend rows use `school_rank` 201 when appended.
- Schools search: type a school name in the search bar to look up its GraphQL id and
  professor list.
- Professors page: select a school from the dropdown to browse all its professors.
  Use the name filter to narrow results.
- Reviews page: enter a professor legacy id (from the profile URL `/professor/<id>`) to
  read all written reviews for that professor.

## Professor-aware study planner

Use the scraped data to interactively pick a school/professor, inspect their derived teaching
parameters, and adapt your syllabus with an LLM-backed plan.

1. Navigate to the Planner section in the top nav.
2. Search for a school, pick a professor, and review the parameter cards + risk signals.
3. Paste your syllabus, choose a GPT-4.x model, and click Generate professor-aware plan.

### Survival planner (Vite app in `frontend/`)

The **NakedProfessor** class survival UI lives under `frontend/`: college search, professor list, **Reality Check**, **Game Plan**, and **Execution Hub**. For local development:

```bash
cd frontend
npm install
npm run dev
```

Use `data/professors.normalized.v1.json` from scraping, or the Behrend sample under `frontend/public/data/` for demos. Copy `frontend/.env.example` to `frontend/.env.local` and set `OPENAI_API_KEY` for local API routes.

The browser does not hold the OpenAI key. Serverless generation uses `frontend/api/generate.js`; the host must provide `OPENAI_API_KEY`.

#### Deploying to Vercel

1. Import this GitHub repository in the [Vercel dashboard](https://vercel.com).
2. Set **Root Directory** to `frontend` (framework: Vite).
3. Add the **Environment Variable** `OPENAI_API_KEY` (Production / Preview as needed).
4. Deploy. Functions are served from `frontend/api/` relative to that root.

#### Hosting professor data on Supabase Storage

The production portal can load professor data from Supabase Storage instead of bundling a large
artifact with the Vite app.

1. In `frontend/.env.local`, set upload credentials. Use the service-role key only locally or in CI:

```bash
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_PROFESSOR_BUCKET=professor-artifacts
SUPABASE_PROFESSOR_OBJECT=top200_plus_behrend_professors.csv
PROFESSOR_ARTIFACT_SOURCE=public/data/top200_plus_behrend_professors.csv
```

2. Upload the tracked all-school CSV:

```bash
cd frontend
npm run upload:professor-data
```

3. Copy the printed public URL into Vercel/Netlify as:

```bash
VITE_PROFESSOR_ARTIFACT_PATHS=https://YOUR_PROJECT.supabase.co/storage/v1/object/public/professor-artifacts/top200_plus_behrend_professors.csv
```

4. Redeploy the frontend. The app fetches that hosted CSV at startup, so future data refreshes only
   require re-running the upload command unless the artifact path changes.

Do not put `SUPABASE_SERVICE_ROLE_KEY` in any `VITE_` variable. `VITE_` variables are exposed to
browser code.

Behind the scenes, `rmp_scraper/professor_profiles.py` converts professor rating platform
metrics into normalized parameters (clarity, workload, support, assessment strictness,
sentiment) and tension statements the LLM prompt consumes.

## Implementation Notes

- Rankings parsing is resilient to minor table changes but will raise a structured error if
  the table disappears.
- The platform client replays the same GraphQL shape the website uses today. If the schema
  changes, update `rmp_scraper/rmp_client.py` accordingly.
- Rankings scraping now applies deterministic, state-aware school matching; if a school still
  resolves ambiguously, add explicit RMP metadata overrides in the scraper config.
- Long-running fetches display a progress indicator and stream results incrementally to avoid
  blocking the UI. Consider adding server-side checkpoints for large requests.

## Testing & Safety

- `cd frontend && npm test && npm run build` verifies frontend behavior and production bundling.
- `python -m compileall rmp_scraper app.py` quickly catches Python syntax issues before shipping.
- Always test with a small limit (5 schools) first to verify connectivity before a full
  200-school fetch.

## Changelog (2026-04)

- Added retry/backoff handling for RateMyProfessors GraphQL calls in the scraper client.
- Switched rankings school resolution to deterministic, state-aware matching instead of first-result fallback.
- Expanded GitHub Actions CI with a Python compile smoke check (`python -m compileall rmp_scraper app.py`).
- Updated README verification commands to match the current runnable scripts.

## Next Steps

- Add parallelism with bounded concurrency while respecting per-host rate limits.
- Enrich the professor view with department-level filters or summary statistics.
- Persist raw JSON per professor to ease future analyses.
