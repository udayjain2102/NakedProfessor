# NakedProfessor

This project provides a CLI that downloads the StateUniversity.com ranked 4-year colleges
list and enumerates professors from a third-party professor rating GraphQL API for each school.

Default `rankings` run: top 200 schools plus Penn State Behrend (Erie, PA) if it is
not already in that list, written to `data/top200_plus_behrend_professors.csv`.

> ⚠️ Use responsibly. The upstream rating platform does not provide an official public API
> and may throttle or block overly aggressive scraping. The script intentionally throttles
> requests, but you are still responsible for following the platform's Terms of Use.

## Features

- Fetches ranked schools from StateUniversity.com (Creative Commons license) and caches them
  as JSON so repeated runs avoid hammering their servers. The cache is sliced or refreshed
  when you change `--limit`.
- Uses the (currently working as of April 11, 2026) `https://www.ratemyprofessors.com/graphql`
  endpoint to discover schools and enumerate professors.
- Streams professor data to CSV with ranking metadata, plus fields like average rating,
  difficulty, and a professor profile URL.

## Quick Start

1. Create a virtual environment (recommended)

```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
```

2. Run the scraper (subcommands)

```bash
   # Default: top 200 + Penn State Behrend → CSV (use --no-behrend to skip Behrend)
   python -m rmp_scraper rankings --delay 0.75

   # More colleges, custom output
   python -m rmp_scraper rankings --limit 500 --output data/professors.csv --delay 0.75

   # Look up school GraphQL ids
   python -m rmp_scraper schools "Stanford" --delay 0.5

   # All professors at one school (pick match index from `schools`)
   python -m rmp_scraper professors --school "MIT" --pick 0 --output data/school_professors.csv

   # All written reviews for one professor (legacy id = URL /professor/<id>)
   python -m rmp_scraper reviews --legacy-id 1506177 --output data/reviews.jsonl
```

   - `rankings`: `--limit` (default 200); `--no-behrend` drops the extra Behrend pass;
     `--cache` / `--output` / `--delay` as before.
   - `professors`: optional `--search "Lastname"` filters within the school.
   - `reviews`: use `--teacher-id` instead of `--legacy-id` if you already have the
     base64 GraphQL id.

3. Inspect results (default `data/top200_plus_behrend_professors.csv`). Behrend rows
   use `school_rank` 201 when appended.

## Professor-aware study planner (Streamlit)

Use the scraped CSV to interactively pick a school/professor, inspect their derived teaching
parameters, and adapt your syllabus with an LLM-backed plan.

1. Scrape or copy `data/top200_plus_behrend_professors.csv` (the default output path).
2. Export your OpenAI API key: `export OPENAI_API_KEY=sk-...`.
3. Launch the UI: `streamlit run app.py`.
4. In the sidebar, search for a school, pick a professor, review the parameter cards + risk
   signals, paste your syllabus, choose a GPT-4.x model, and click Generate professor-aware
   plan.

Behind the scenes, `rmp_scraper/professor_profiles.py` converts professor rating platform
metrics into normalized parameters (clarity, workload, support, assessment strictness,
sentiment) and tension statements the LLM prompt consumes.

## Implementation Notes

- Rankings parsing is resilient to minor table changes but will raise a structured error if
  the table disappears.
- The platform client replays the same GraphQL shape the website uses today. If the schema
  changes, update `rmp_scraper/rmp_client.py` accordingly.
- The CLI currently picks the first school match from the platform. If you need deterministic
  mappings, extend it to pre-map school IDs manually.
- Long-running scrapes should persist intermediate CSVs and resume from them. Consider adding
  incremental checkpoints for production use.

## Testing & Safety

- `python -m compileall rmp_scraper` ensures the modules are syntactically valid.
- Always run small limits first (`--limit 5`) to verify connectivity before a full
  200-school scrape.

## Next Steps

- Add parallelism with bounded concurrency (e.g., via `asyncio`) while respecting
  per-host limits.
- Enrich the output with department-level filters or summary statistics.
- Persist raw JSON per professor to ease future analyses.
