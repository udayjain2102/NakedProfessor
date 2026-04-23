from __future__ import annotations

import argparse
import json
import logging
import re
from pathlib import Path

import requests

from .country_lists import load_country_lists
from .pipeline import (
    export_normalized_professors_artifact,
    load_or_create_college_cache,
    rankings_colleges_with_behrend,
)
from .rmp_client import RateMyProfessorsClient, teacher_gid_from_legacy
from .rankings import RankedCollege

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
LOG = logging.getLogger(__name__)


def _strip_parenthetical_suffixes(value: str) -> str:
    return re.sub(r"\s*\([^)]*\)", "", value or "").strip()


def _resolve_country_list_school(
    client: RateMyProfessorsClient,
    college: RankedCollege,
) -> object:
    location = (college.metadata.get("list_location") or "").strip() or None
    search_variants = []
    for candidate in [college.name, _strip_parenthetical_suffixes(college.name)]:
        normalized = (candidate or "").strip()
        if normalized and normalized not in search_variants:
            search_variants.append(normalized)

    for search_text in search_variants:
        school = client.match_school(
            search_text,
            city_equals=location,
            max_results=15,
            default_index=0,
            allow_fallback=False,
        )
        if school is not None:
            return school

    # Final attempt: if the source list has no reliable location, still require a positive score.
    return client.match_school(
        college.name,
        max_results=15,
        default_index=0,
        allow_fallback=False,
    )


def _add_delay(parser: argparse.ArgumentParser, default: float = 0.6) -> None:
    parser.add_argument(
        "--delay",
        type=float,
        default=default,
        help="Seconds to sleep between GraphQL requests (be polite to RMP)",
    )


def _resolve_rankings_school(client: RateMyProfessorsClient, college: RankedCollege):
    rmp = college.metadata.get("rmp")
    if isinstance(rmp, dict):
        return client.match_school(
            rmp.get("search", college.name),
            name_contains=rmp.get("name_contains"),
            city_equals=rmp.get("city"),
            state_equals=rmp.get("state") or college.state,
            max_results=int(rmp.get("max_results", 15)),
            default_index=int(rmp.get("default_index", 0)),
        )
    return client.match_school(
        college.name,
        state_equals=college.state,
        max_results=15,
        default_index=0,
    )


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

    export_normalized_professors_artifact(all_records, args.output)
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
    export_normalized_professors_artifact(records, args.output)
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


def _slugify_filename(value: str) -> str:
    normalized = value.lower().strip()
    normalized = "".join(ch if ch.isalnum() else "-" for ch in normalized)
    normalized = "-".join(filter(None, normalized.split("-")))
    return normalized or "list"


def _cmd_lists(args: argparse.Namespace) -> int:
    session = requests.Session()
    client = RateMyProfessorsClient(session=session, delay=args.delay)
    country_lists = load_country_lists(args.lists)
    merged_records = []

    for country_list in country_lists:
        records = []
        universities = country_list.universities
        if args.limit:
            universities = universities[: args.limit]
        LOG.info("Scraping %d schools for %s", len(universities), country_list.country)
        for college in universities:
            LOG.info("Scraping professors for %s (rank %s)", college.name, college.rank)
            school = _resolve_country_list_school(client, college)
            if school is None:
                LOG.warning("No school match found on RMP for %s", college.name)
                continue
            for professor in client.iter_professors(school.id):
                professor.metadata = {
                    "rank": college.rank,
                    "country": country_list.country,
                    "state": school.state or college.state,
                    "source": country_list.source,
                    "list_name": college.metadata.get("list_name"),
                    "list_rank": college.metadata.get("list_rank"),
                    "list_location": college.metadata.get("list_location"),
                    "list_notes": college.metadata.get("list_notes"),
                    "rmp_school_name": school.name,
                    "rmp_school_city": school.city,
                    "rmp_school_state": school.state,
                }
                records.append(professor)
        if args.output_dir:
            output_path = args.output_dir / f"{_slugify_filename(country_list.country)}_professors.normalized.v1.json"
            export_normalized_professors_artifact(records, output_path)
            LOG.info("Wrote %d professors to %s", len(records), output_path)
        else:
            merged_records.extend(records)

    if not args.output_dir:
        export_normalized_professors_artifact(merged_records, args.output)
        LOG.info("Wrote %d professors to %s", len(merged_records), args.output)
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
        default=Path("data/professors.normalized.v1.json"),
        help="Versioned normalized output artifact path",
    )
    _add_delay(p_rank)
    p_rank.set_defaults(func=_cmd_rankings)

    p_schools = sub.add_parser("schools", help="Search schools by name (JSON to stdout)")
    p_schools.add_argument("query", help='School name text, e.g. "MIT"')
    p_schools.add_argument("--max-results", type=int, default=10)
    _add_delay(p_schools)
    p_schools.set_defaults(func=_cmd_schools)

    p_profs = sub.add_parser(
        "professors",
        help="Export all professors for a school match to versioned normalized JSON",
    )
    p_profs.add_argument("--school", required=True, help="School search string")
    p_profs.add_argument(
        "--pick",
        type=int,
        default=0,
        help="Index of school match to use (see `schools` subcommand)",
    )
    p_profs.add_argument("--search", default="", help="Optional professor name filter within the school")
    p_profs.add_argument(
        "--output",
        type=Path,
        default=Path("data/school_professors.normalized.v1.json"),
        help="Versioned normalized output artifact path",
    )
    _add_delay(p_profs)
    p_profs.set_defaults(func=_cmd_professors)

    p_lists = sub.add_parser(
        "lists",
        help="Scrape professors for schools listed in JSON files",
    )
    p_lists.add_argument(
        "lists",
        nargs="+",
        type=Path,
        help="One or more country list JSON files",
    )
    p_lists.add_argument(
        "--output",
        type=Path,
        default=Path("data/professors.lists.normalized.v1.json"),
        help="Merged normalized output artifact path (if --output-dir not set)",
    )
    p_lists.add_argument(
        "--output-dir",
        type=Path,
        help="Write one normalized artifact per list into this directory",
    )
    p_lists.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional cap on the number of schools per list (0 = no cap)",
    )
    _add_delay(p_lists)
    p_lists.set_defaults(func=_cmd_lists)

    p_rev = sub.add_parser("reviews", help="Export all text ratings for one professor to JSONL")
    g = p_rev.add_mutually_exclusive_group(required=True)
    g.add_argument("--legacy-id", type=int, help="Numeric id from profile URL /professor/<id>")
    g.add_argument("--teacher-id", help="GraphQL global id (base64 Teacher-…)")
    p_rev.add_argument("--output", type=Path, default=Path("data/reviews.jsonl"))
    _add_delay(p_rev)
    p_rev.set_defaults(func=_cmd_reviews)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    logging.getLogger().setLevel(args.log_level)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
