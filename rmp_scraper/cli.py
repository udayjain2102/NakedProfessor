from __future__ import annotations

import argparse
import json
import logging
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from .pipeline import (
    export_professors_to_csv,
    load_or_create_college_cache,
    rankings_colleges_with_behrend,
)
from .rmp_client import ProfessorRecord, RateMyProfessorsClient, SchoolMatch, teacher_gid_from_legacy
from .rankings import RankedCollege

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
LOG = logging.getLogger(__name__)

# RMP ``state`` values used to keep seed scrapes on the right country.
_RMP_AU_STATES = frozenset({"NSW", "VIC", "QLD", "WA", "SA", "TAS", "NT", "ACT"})
_RMP_UK_STATES = frozenset({"England", "Scotland", "Wales", "Northern Ireland"})
_RMP_CA_PROVINCES = frozenset({"AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"})
_RMP_IN_COUNTRY_CODES = frozenset({"IN"})


def _matches_region(school: SchoolMatch, region: str) -> bool:
    st = (school.state or "").strip()
    if region == "au":
        return st in _RMP_AU_STATES
    if region == "uk":
        return st in _RMP_UK_STATES
    if region == "ca":
        return st in _RMP_CA_PROVINCES
    if region == "in":
        # RMP appears to use "IN" as a country code for some India schools (e.g., IIT Bombay).
        return st in _RMP_IN_COUNTRY_CODES
    return True


def _au_soft_match(school: SchoolMatch, city_hint: str | None) -> bool:
    """Heuristic for Australian campuses (RMP often uses odd ``state`` values; city may include 'Australia')."""
    c = (school.city or "")
    if "Australia" in c:
        return True
    st = (school.state or "").strip()
    if st in _RMP_AU_STATES:
        return True
    return False


def _filter_schools_by_region(matches: list[SchoolMatch], region: str | None) -> list[SchoolMatch]:
    if not region or region == "none":
        return matches
    return [m for m in matches if _matches_region(m, region)]


def _add_delay(parser: argparse.ArgumentParser, default: float = 0.6) -> None:
    parser.add_argument(
        "--delay",
        type=float,
        default=default,
        help="Seconds to sleep between GraphQL requests (be polite to RMP)",
    )


def _normalize_region_filter(region: str | None) -> str | None:
    if region is None or region == "none":
        return None
    return region


def _resolve_uk_school_from_seed(
    client: RateMyProfessorsClient,
    row: dict[str, Any],
    uni: str,
    city_hint: str | None,
    *,
    max_results: int,
    region: str | None = None,
) -> SchoolMatch | None:
    """Use explicit ``rmp`` / ``metadata.rmp`` overrides when present (Behrend-style), else fuzzy pick."""
    rmp = row.get("rmp")
    if rmp is None and isinstance(row.get("metadata"), dict):
        rmp = row["metadata"].get("rmp")
    if isinstance(rmp, dict) and (rmp.get("search") or rmp.get("name_contains")):
        return client.match_school(
            rmp.get("search", uni),
            name_contains=rmp.get("name_contains"),
            city_equals=rmp.get("city") or city_hint,
            max_results=int(rmp.get("max_results", max_results)),
            default_index=int(rmp.get("default_index", 0)),
        )
    return _pick_uk_school(
        client, uni, city_hint, max_results=max_results, region=_normalize_region_filter(region)
    )


def _pick_uk_school(
    client: RateMyProfessorsClient,
    university: str,
    city_hint: str | None,
    *,
    max_results: int = 15,
    region: str | None = None,
) -> SchoolMatch | None:
    """Pick the best RMP school row (optional city disambiguation; optional AU/UK/CA region filter)."""
    region = _normalize_region_filter(region)
    nr = max(max_results, 25) if region else max_results
    if region == "au":
        nr = max(nr, 40)
    matches = client.search_school(university, max_rows=nr)
    if not matches:
        return None

    if region == "au":
        pool = [m for m in matches if _au_soft_match(m, city_hint)]
        if not pool:
            alt = client.search_school(f"{university} Australia", max_rows=nr)
            pool = [m for m in alt if _au_soft_match(m, city_hint)]
        # For Australia, avoid falling back to non-AU schools (RMP search is noisy).
        if not pool:
            return None
    elif region is not None:
        # For uk/ca/in (and any future region filters), only accept matches in that region.
        pool = _filter_schools_by_region(matches, region)
        if not pool:
            return None
    else:
        pool = list(matches)

    use = pool
    if city_hint and any(_au_soft_match(m, city_hint) for m in use):
        use = sorted(
            use,
            key=lambda m: (
                not _au_soft_match(m, city_hint),
                0 if city_hint.lower() in (m.city or "").lower() else 1,
                (m.name or ""),
            ),
        )
    if not (city_hint or "").strip():
        return use[0]
    want = city_hint.strip().lower()
    for m in use:
        mc = (m.city or "").strip().lower()
        if mc == want:
            return m
    for m in use:
        mc = (m.city or "").strip().lower()
        if want in mc or mc in want:
            return m
    return use[0]


def _professor_record_to_dict(r: ProfessorRecord) -> dict[str, Any]:
    return {
        "id": r.id,
        "legacyId": r.legacy_id,
        "firstName": r.first_name,
        "lastName": r.last_name,
        "department": r.department,
        "avgRating": r.avg_rating,
        "avgDifficulty": r.avg_difficulty,
        "wouldTakeAgainPercent": r.would_take_again_percent,
        "numRatings": r.num_ratings,
        "profileUrl": r.profile_url,
    }


def _parse_uk_seed_row(row: dict[str, Any]) -> tuple[Any, str, str | None, str | None]:
    """Accept minimal seed rows (university, city, estStudents) or RankedCollege-shaped rows."""
    rank = row.get("rank")
    if (row.get("university") or "").strip():
        name = (row.get("university") or "").strip()
    else:
        name = (row.get("name") or "").strip()
    city = (row.get("city") or "").strip() or None
    est = row.get("estStudents")
    meta = row.get("metadata")
    if isinstance(meta, dict):
        if not city:
            city = (meta.get("city") or "").strip() or None
        if est is None:
            est = meta.get("estStudents")
    return rank, name, city, est


def _synthetic_rank_score(rank: int, total: int) -> float:
    """Map rank to a 0–100 scale (same spirit as top_colleges score)."""
    if total <= 1:
        return 100.0
    return round(100.0 - (rank - 1) * (100.0 / (total - 1)), 2)


def _rmp_school_page_url(legacy_id: int | None) -> str | None:
    if legacy_id is None:
        return None
    return f"https://www.ratemyprofessors.com/school/{legacy_id}"


def _resolve_rankings_school(client: RateMyProfessorsClient, college: RankedCollege):
    rmp = college.metadata.get("rmp")
    if isinstance(rmp, dict):
        return client.match_school(
            rmp.get("search", college.name),
            name_contains=rmp.get("name_contains"),
            city_equals=rmp.get("city"),
            max_results=int(rmp.get("max_results", 15)),
            default_index=int(rmp.get("default_index", 0)),
        )
    matches = client.search_school(college.name)
    return matches[0] if matches else None


def _cmd_rankings(args: argparse.Namespace) -> int:
    session = requests.Session()
    colleges = load_or_create_college_cache(args.cache, args.limit, session=session)
    colleges = rankings_colleges_with_behrend(colleges, include_behrend=not args.no_behrend)
    client = RateMyProfessorsClient(session=session, delay=args.delay)

    all_records = []
    for college in colleges:
        LOG.info("Scraping professors for %s (rank %s)", college.name, college.rank)
        school = _resolve_rankings_school(client, college)
        if school is None:
            LOG.warning("No school match found on RMP for %s", college.name)
            continue
        for professor in client.iter_professors(school.id):
            professor.metadata = {"rank": college.rank, "state": college.state}
            all_records.append(professor)

    export_professors_to_csv(all_records, args.output)
    return 0


def _cmd_schools(args: argparse.Namespace) -> int:
    session = requests.Session()
    client = RateMyProfessorsClient(session=session, delay=args.delay)
    matches = client.search_school(args.query, max_rows=args.max_results)
    rows = [
        {
            "id": m.id,
            "legacy_id": m.legacy_id,
            "name": m.name,
            "city": m.city,
            "state": m.state,
        }
        for m in matches
    ]
    print(json.dumps(rows, indent=2))
    return 0


def _cmd_professors(args: argparse.Namespace) -> int:
    session = requests.Session()
    client = RateMyProfessorsClient(session=session, delay=args.delay)
    matches = client.search_school(args.school, max_rows=max(args.pick + 1, 5))
    if not matches:
        LOG.error("No schools matched %r", args.school)
        return 1
    if args.pick >= len(matches):
        LOG.error("Pick index %s out of range (got %d matches)", args.pick, len(matches))
        return 1
    school = matches[args.pick]
    LOG.info("Using school: %s (%s, %s)", school.name, school.city, school.state)
    records = list(client.iter_professors(school.id, search_text=args.search or None))
    for r in records:
        r.metadata = {
            "rank": "",
            "state": school.state,
            "school_legacy_id": school.legacy_id,
        }
    export_professors_to_csv(records, args.output)
    LOG.info("Wrote %d professors to %s", len(records), args.output)
    return 0


def _cmd_reviews(args: argparse.Namespace) -> int:
    session = requests.Session()
    client = RateMyProfessorsClient(session=session, delay=args.delay)
    if args.teacher_id:
        tid = args.teacher_id
    elif args.legacy_id is not None:
        tid = teacher_gid_from_legacy(args.legacy_id)
    else:
        LOG.error("Provide --legacy-id or --teacher-id")
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with args.output.open("w") as fp:
        for rating in client.iter_teacher_ratings(tid):
            fp.write(json.dumps(rating.as_dict(), ensure_ascii=False) + "\n")
            count += 1
    LOG.info("Wrote %d ratings to %s", count, args.output)
    return 0


def _cmd_seed_rankings_json(args: argparse.Namespace) -> int:
    """Scrape RMP for a seed JSON list; write RankedCollege-shaped JSON (same as top_colleges.json)."""
    input_path: Path = args.input
    if not input_path.is_file():
        LOG.error("Input file not found: %s", input_path)
        return 1

    text = input_path.read_text().strip()
    if not text:
        LOG.error("Input file is empty: %s", input_path)
        return 1
    raw = json.loads(text)
    if not isinstance(raw, list):
        LOG.error("Expected a JSON array in %s", input_path)
        return 1

    rows_in = raw
    if args.limit_schools is not None:
        rows_in = rows_in[: int(args.limit_schools)]

    total_rows = len(rows_in)
    session = requests.Session()
    client = RateMyProfessorsClient(session=session, delay=args.delay)

    all_records: list[ProfessorRecord] = []
    enriched: list[dict[str, Any]] = []
    scraped_at = datetime.now(timezone.utc).isoformat()

    for idx, row in enumerate(rows_in):
        if not isinstance(row, dict):
            LOG.warning("Skipping non-object row: %r", row)
            continue

        rank_val, uni, city, est_students = _parse_uk_seed_row(row)
        rank = rank_val if rank_val is not None else idx + 1
        score = _synthetic_rank_score(int(rank), total_rows)

        if not uni:
            meta: dict[str, Any] = {
                "city": city,
                "estStudents": est_students,
                "scrapedAt": scraped_at,
                "rmp": {"matched": False, "error": "missing university or name"},
            }
            enriched.append(
                asdict(
                    RankedCollege(
                        rank=int(rank),
                        name="",
                        url=None,
                        state=None,
                        score=score,
                        previous_rank=None,
                        metadata=meta,
                    )
                )
            )
            continue

        school = _resolve_uk_school_from_seed(
            client,
            row,
            uni,
            city,
            max_results=args.max_school_matches,
            region=getattr(args, "region_filter", None),
        )
        if school is None:
            LOG.warning("No RMP school match for %s", uni)
            meta = {
                "city": city,
                "estStudents": est_students,
                "scrapedAt": scraped_at,
                "rmp": {
                    "matched": False,
                    "searchQuery": uni,
                    "cityHint": city,
                    "error": "no school search results",
                },
                "professorCount": 0,
            }
            enriched.append(
                asdict(
                    RankedCollege(
                        rank=int(rank),
                        name=uni,
                        url=None,
                        state=None,
                        score=score,
                        previous_rank=None,
                        metadata=meta,
                    )
                )
            )
            continue

        LOG.info(
            "Scraping professors for %s → RMP: %s (%s, %s)",
            uni,
            school.name,
            school.city,
            school.state,
        )

        profs: list[ProfessorRecord] = []
        scrape_error: str | None = None
        max_p = args.max_professors_per_school
        try:
            for professor in client.iter_professors(school.id):
                professor.metadata = {"rank": rank, "state": school.state}
                profs.append(professor)
                all_records.append(professor)
                if max_p is not None and len(profs) >= int(max_p):
                    break
        except Exception as e:
            LOG.exception("Failed iterating professors for %s: %s", school.name, e)
            scrape_error = str(e)

        ratings_vals = [p.avg_rating for p in profs if p.avg_rating is not None]
        summary = {
            "listedProfessors": len(profs),
            "withNumericRating": len(ratings_vals),
            "avgRatingAcrossProfessors": round(sum(ratings_vals) / len(ratings_vals), 3)
            if ratings_vals
            else None,
        }

        meta = {
            "city": city,
            "estStudents": est_students,
            "scrapedAt": scraped_at,
            "rmp": {
                "matched": True,
                "schoolId": school.id,
                "legacyId": school.legacy_id,
                "searchQuery": uni,
                "cityHint": city,
            },
            "professorCount": len(profs),
            "professorsSummary": summary,
        }
        if scrape_error:
            meta["scrapeError"] = scrape_error
        if args.inline_professors and profs:
            meta["professors"] = [_professor_record_to_dict(p) for p in profs]

        enriched.append(
            asdict(
                RankedCollege(
                    rank=int(rank),
                    name=school.name,
                    url=_rmp_school_page_url(school.legacy_id),
                    state=school.state,
                    score=score,
                    previous_rank=None,
                    metadata=meta,
                )
            )
        )

    if not args.no_output_csv:
        export_professors_to_csv(all_records, args.output_csv)
        LOG.info("Wrote %d professor rows to %s", len(all_records), args.output_csv)

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(enriched, indent=2, ensure_ascii=False) + "\n")
    LOG.info("Wrote %d RankedCollege-style rows to %s", len(enriched), args.output_json)
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Scrape Rate My Professors via its public GraphQL endpoint (use responsibly).",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARN", "ERROR"],
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_rank = sub.add_parser("rankings", help="Top colleges list + all professors per school (large scrape)")
    p_rank.add_argument(
        "--limit",
        type=int,
        default=200,
        help="Number of colleges from rankings source (default: 200)",
    )
    p_rank.add_argument(
        "--no-behrend",
        action="store_true",
        help="Do not append Penn State Behrend after the ranked schools",
    )
    p_rank.add_argument(
        "--cache",
        type=Path,
        default=Path("data/top_colleges.json"),
        help="Cache path for ranked colleges JSON",
    )
    p_rank.add_argument(
        "--output",
        type=Path,
        default=Path("data/top200_plus_behrend_professors.csv"),
    )
    _add_delay(p_rank)
    p_rank.set_defaults(func=_cmd_rankings)

    p_schools = sub.add_parser("schools", help="Search schools by name (JSON to stdout)")
    p_schools.add_argument("query", help='School name text, e.g. "MIT"')
    p_schools.add_argument("--max-results", type=int, default=10)
    _add_delay(p_schools)
    p_schools.set_defaults(func=_cmd_schools)

    p_profs = sub.add_parser("professors", help="Export all professors for a school match to CSV")
    p_profs.add_argument("--school", required=True, help="School search string")
    p_profs.add_argument(
        "--pick",
        type=int,
        default=0,
        help="Index of school match to use (see `schools` subcommand)",
    )
    p_profs.add_argument("--search", default="", help="Optional professor name filter within the school")
    p_profs.add_argument("--output", type=Path, default=Path("data/school_professors.csv"))
    _add_delay(p_profs)
    p_profs.set_defaults(func=_cmd_professors)

    p_rev = sub.add_parser("reviews", help="Export all text ratings for one professor to JSONL")
    g = p_rev.add_mutually_exclusive_group(required=True)
    g.add_argument("--legacy-id", type=int, help="Numeric id from profile URL /professor/<id>")
    g.add_argument("--teacher-id", help="GraphQL global id (base64 Teacher-…)")
    p_rev.add_argument("--output", type=Path, default=Path("data/reviews.jsonl"))
    _add_delay(p_rev)
    p_rev.set_defaults(func=_cmd_reviews)

    def _seed_json_args(
        p: argparse.ArgumentParser,
        *,
        input_def: str,
        json_def: str,
        csv_def: str,
        region_filter_default: str = "none",
    ) -> None:
        p.add_argument(
            "--input",
            type=Path,
            default=Path(input_def),
            help=f"Seed JSON (rank, university, city, estStudents). Default: {input_def}",
        )
        p.add_argument(
            "--output-json",
            type=Path,
            default=Path(json_def),
            help=f"RankedCollege / top_colleges.json output. Default: {json_def}",
        )
        p.add_argument(
            "--output-csv",
            type=Path,
            default=Path(csv_def),
            help=f"Flat professors CSV. Default: {csv_def}",
        )
        p.add_argument(
            "--no-output-csv",
            action="store_true",
            help="Do not write the professors CSV",
        )
        p.add_argument(
            "--inline-professors",
            action="store_true",
            help="Embed full professor lists in metadata (large file)",
        )
        p.add_argument(
            "--limit-schools",
            type=int,
            default=None,
            help="Only process the first N schools (for testing)",
        )
        p.add_argument(
            "--max-school-matches",
            type=int,
            default=15,
            help="How many RMP school search rows to consider when disambiguating by city",
        )
        p.add_argument(
            "--max-professors-per-school",
            type=int,
            default=None,
            help="Cap professors per school (omit for no limit)",
        )
        p.add_argument(
            "--region-filter",
            choices=["none", "au", "uk", "ca", "in"],
            default=region_filter_default,
            help="Region hint: uk/ca use RMP state codes; au uses soft AU heuristics (city/Australia). "
            "Australia defaults to none because RMP search is noisy—add per-row `rmp` in the seed to fix a campus.",
        )
        _add_delay(p)

    p_uk = sub.add_parser(
        "uk-json",
        help="RMP scrape: UK seed → uk.json (RankedCollege) + uk_professors.csv",
    )
    _seed_json_args(
        p_uk,
        input_def="data/uk_seed.json",
        json_def="data/uk.json",
        csv_def="data/uk_professors.csv",
        region_filter_default="uk",
    )
    p_uk.set_defaults(func=_cmd_seed_rankings_json)

    p_ca = sub.add_parser(
        "canada-json",
        help="RMP scrape: Canada seed → canada.json (RankedCollege) + canada_professors.csv",
    )
    _seed_json_args(
        p_ca,
        input_def="data/canada_seed.json",
        json_def="data/canada.json",
        csv_def="data/canada_professors.csv",
        region_filter_default="ca",
    )
    p_ca.set_defaults(func=_cmd_seed_rankings_json)

    p_au = sub.add_parser(
        "australia-json",
        help="RMP scrape: Australia seed → australia.json (RankedCollege) + australia_professors.csv",
    )
    _seed_json_args(
        p_au,
        input_def="data/australia_seed.json",
        json_def="data/australia.json",
        csv_def="data/australia_professors.csv",
        region_filter_default="au",
    )
    p_au.set_defaults(func=_cmd_seed_rankings_json)

    p_in = sub.add_parser(
        "india-json",
        help="RMP scrape: India seed → india.json (RankedCollege) + india_professors.csv",
    )
    _seed_json_args(
        p_in,
        input_def="data/india_seed.json",
        json_def="data/india.json",
        csv_def="data/india_professors.csv",
        region_filter_default="in",
    )
    p_in.set_defaults(func=_cmd_seed_rankings_json)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    logging.getLogger().setLevel(args.log_level)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
