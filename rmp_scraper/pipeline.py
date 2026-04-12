from __future__ import annotations

import csv
import json
import logging
from dataclasses import asdict
from pathlib import Path
from typing import Iterable, List, Optional

import requests

from .rankings import RankedCollege, fetch_top_ranked_colleges
from .rmp_client import ProfessorRecord

LOG = logging.getLogger(__name__)

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


def export_professors_to_csv(records: Iterable[ProfessorRecord], output_file: Path) -> None:
    fieldnames = [
        "school_rank",
        "school_name",
        "school_id",
        "school_state",
        "professor_id",
        "professor_legacy_id",
        "professor_first",
        "professor_last",
        "department",
        "avg_rating",
        "avg_difficulty",
        "would_take_again_percent",
        "num_ratings",
        "profile_url",
    ]
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with output_file.open("w", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow(
                {
                    "school_rank": record.metadata.get("rank"),
                    "school_name": record.school_name,
                    "school_id": record.school_id,
                    "school_state": record.metadata.get("state"),
                    "professor_id": record.id,
                    "professor_legacy_id": record.legacy_id,
                    "professor_first": record.first_name,
                    "professor_last": record.last_name,
                    "department": record.department,
                    "avg_rating": record.avg_rating,
                    "avg_difficulty": record.avg_difficulty,
                    "would_take_again_percent": record.would_take_again_percent,
                    "num_ratings": record.num_ratings,
                    "profile_url": record.profile_url,
                }
            )
