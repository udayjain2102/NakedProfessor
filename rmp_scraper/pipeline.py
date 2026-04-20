from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from dataclasses import asdict
from pathlib import Path
from typing import Iterable, List, Optional

import requests

from .rankings import RankedCollege, fetch_top_ranked_colleges
from .rmp_client import ProfessorRecord

LOG = logging.getLogger(__name__)
ARTIFACT_SCHEMA_VERSION = "1.0.0"

# Appended after the ranked list when ``include_behrend`` is True (RMP match via metadata["rmp"]).
PENN_STATE_BEHREND = RankedCollege(
    rank=201,
    name="Pennsylvania State University - Behrend",
    state="PA",
    metadata={
        "rmp": {
            "search": "Behrend",
            "name_contains": "behrend",
            "city": "Erie",
            "max_results": 20,
        },
    },
)


def load_or_create_college_cache(
    output_path: Path,
    limit: int,
    session: Optional[requests.Session] = None,
) -> List[RankedCollege]:
    session = session or requests.Session()
    if output_path.exists():
        LOG.info("Loading cached ranking list from %s", output_path)
        cached = [RankedCollege(**item) for item in json.loads(output_path.read_text())]
        cached = sorted(cached, key=lambda c: c.rank)
        if len(cached) >= limit:
            return cached[:limit]
        LOG.info(
            "Cache has %d schools; need %d — refreshing rankings",
            len(cached),
            limit,
        )

    colleges = fetch_top_ranked_colleges(session, limit=limit)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps([asdict(c) for c in colleges], indent=2))
    return colleges


def rankings_colleges_with_behrend(
    colleges: List[RankedCollege],
    *,
    include_behrend: bool,
) -> List[RankedCollege]:
    if not include_behrend:
        return colleges
    if any("behrend" in c.name.lower() for c in colleges):
        LOG.info("Rankings already include a Behrend campus; not appending Penn State Behrend again")
        return colleges
    return [*colleges, PENN_STATE_BEHREND]


def _slugify(value: str) -> str:
    lowered = (value or "").lower()
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    lowered = re.sub(r"-+", "-", lowered).strip("-")
    return lowered or "unknown"


def canonical_school_id(record: ProfessorRecord) -> str:
    state = _slugify(record.metadata.get("state") or "na")
    return f"school:{state}:{_slugify(record.school_name)}"


def canonical_professor_id(record: ProfessorRecord) -> str:
    return f"prof:{record.legacy_id or record.id}"


def _tokenize(*values: Optional[str]) -> list[str]:
    tokens: set[str] = set()
    for value in values:
        if not value:
            continue
        parts = re.split(r"[^a-zA-Z0-9]+", value.lower())
        tokens.update(part for part in parts if part)
    return sorted(tokens)


def _school_aliases(name: str) -> list[str]:
    aliases = {name.strip()}
    compact = re.sub(r"\s+", " ", name).strip()
    if compact:
        aliases.add(compact)
    aliases.add(compact.replace("University", "Univ."))
    return sorted(alias for alias in aliases if alias)


def _professor_aliases(record: ProfessorRecord) -> list[str]:
    full_name = f"{record.first_name} {record.last_name}".strip()
    aliases = {
        full_name,
        f"{record.last_name}, {record.first_name}".strip(", "),
        record.profile_url,
    }
    return sorted(alias for alias in aliases if alias)


def build_normalized_professor_artifact(records: Iterable[ProfessorRecord]) -> dict:
    exported_at = datetime.now(UTC).isoformat()
    normalized_records = list(records)
    schools: dict[str, dict] = {}
    professors: list[dict] = []

    for record in normalized_records:
        school_id = canonical_school_id(record)
        professor_id = canonical_professor_id(record)
        school_rank = record.metadata.get("rank")
        school_state = record.metadata.get("state")
        school = schools.setdefault(
            school_id,
            {
                "school_id": school_id,
                "upstream_school_id": record.school_id,
                "name": record.school_name,
                "state": school_state,
                "rank": school_rank,
                "aliases": _school_aliases(record.school_name),
                "search_tokens": _tokenize(record.school_name, school_state),
                "source_provenance": {
                    "provider": "ratemyprofessors",
                    "provider_school_id": record.school_id,
                    "rankings_rank": school_rank,
                },
            },
        )
        # Keep best (lowest) rank if duplicates appear.
        if isinstance(school_rank, int) and (
            school.get("rank") is None or school_rank < school["rank"]
        ):
            school["rank"] = school_rank

        professors.append(
            {
                "professor_id": professor_id,
                "school_id": school_id,
                "upstream_professor_id": record.id,
                "legacy_id": record.legacy_id,
                "first_name": record.first_name,
                "last_name": record.last_name,
                "full_name": record.full_name,
                "department": record.department,
                "profile_url": record.profile_url,
                "aliases": _professor_aliases(record),
                "search_tokens": _tokenize(
                    record.first_name,
                    record.last_name,
                    record.department,
                    record.school_name,
                ),
                "metrics": {
                    "avg_rating": record.avg_rating,
                    "avg_difficulty": record.avg_difficulty,
                    "would_take_again_percent": record.would_take_again_percent,
                    "num_ratings": record.num_ratings,
                },
                "freshness": {
                    "observed_at": exported_at,
                },
                "source_provenance": {
                    "provider": "ratemyprofessors",
                    "provider_professor_id": record.id,
                    "provider_school_id": record.school_id,
                },
            }
        )

    return {
        "schema_version": ARTIFACT_SCHEMA_VERSION,
        "generated_at": exported_at,
        "freshness": {
            "generated_at": exported_at,
            "ttl_hours": 168,
        },
        "source_provenance": {
            "rankings_source": {
                "provider": "stateuniversity",
                "url": "https://www.stateuniversity.com/rank/score_rank_by_4yrc.html",
            },
            "professor_source": {
                "provider": "ratemyprofessors",
                "url": "https://www.ratemyprofessors.com/graphql",
            },
        },
        "schools": sorted(schools.values(), key=lambda s: (s.get("rank") or 10**9, s["name"])),
        "professors": sorted(professors, key=lambda p: (p["school_id"], p["last_name"], p["first_name"])),
    }


def export_normalized_professors_artifact(
    records: Iterable[ProfessorRecord],
    output_file: Path,
) -> None:
    artifact = build_normalized_professor_artifact(records)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(json.dumps(artifact, indent=2, ensure_ascii=False))
