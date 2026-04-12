# NakedProfessor

This project provides a web application that downloads the StateUniversity.com ranked 4-year colleges
list and enumerates professors from a third-party professor rating GraphQL API for each school.

Default rankings view: top 200 schools plus Penn State Behrend (Erie, PA) if it is
not already in that list, displayed in an interactive table and exportable to `top200_plus_behrend_professors.csv`.

> ⚠️ Use responsibly. The upstream rating platform does not provide an official public API
> and may throttle or block overly aggressive scraping. The app intentionally throttles
> requests, but you are still responsible for following the platform's Terms of Use.

## Features

- Fetches ranked schools from StateUniversity.com (Creative Commons license) and caches them
  as JSON so repeated page loads avoid hammering their servers. The cache is sliced or refreshed
  when you change the limit setting.
- Uses the (currently working as of April 11, 2026) `https://www.ratemyprofessors.com/graphql`
  endpoint to discover schools and enumerate professors.
- Displays professor data in a sortable, filterable table with ranking metadata, plus fields
  like average rating, difficulty, and a professor profile URL. Results can be exported to CSV.

## Quick Start

1. Install dependencies

```bash
   npm install
```

2. Start the development server

```bash
   npm run dev
```

3. Open your browser and navigate to `https://nakedprofessor-bwnc8nxc4-udayjain2102s-projects.vercel.app`.

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

Behind the scenes, `rmp_scraper/professor_profiles.py` converts professor rating platform
metrics into normalized parameters (clarity, workload, support, assessment strictness,
sentiment) and tension statements the LLM prompt consumes.

## Implementation Notes

- Rankings parsing is resilient to minor table changes but will raise a structured error if
  the table disappears.
- The platform client replays the same GraphQL shape the website uses today. If the schema
  changes, update `rmp_scraper/rmp_client.py` accordingly.
- The app currently picks the first school match from the platform. If you need deterministic
  mappings, extend it to pre-map school IDs manually.
- Long-running fetches display a progress indicator and stream results incrementally to avoid
  blocking the UI. Consider adding server-side checkpoints for large requests.

## Testing & Safety

- `npm run lint` and `npm test` verify the app is syntactically valid and core logic is correct.
- Always test with a small limit (5 schools) first to verify connectivity before a full
  200-school fetch.

## Next Steps

- Add parallelism with bounded concurrency while respecting per-host rate limits.
- Enrich the professor view with department-level filters or summary statistics.
- Persist raw JSON per professor to ease future analyses.
