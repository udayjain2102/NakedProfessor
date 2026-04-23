from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List

from .rankings import RankedCollege


@dataclass(frozen=True)
class CountryList:
    country: str
    source: str
    universities: List[RankedCollege]


def load_country_list(path: Path) -> CountryList:
    data = json.loads(path.read_text())
    country = str(data.get("country") or path.stem).strip()
    source = str(data.get("source") or "").strip()
    universities = data.get("universities") or []
    ranked: List[RankedCollege] = []

    for idx, entry in enumerate(universities, start=1):
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()
        if not name:
            continue
        rank = entry.get("rank")
        try:
            rank_value = int(rank) if rank is not None else idx
        except (TypeError, ValueError):
            rank_value = idx
        metadata = {
            "country": country,
            "source": source,
            "list_name": path.stem,
            "list_rank": rank_value,
            "list_location": entry.get("location"),
            "list_notes": entry.get("notes"),
        }
        ranked.append(
            RankedCollege(
                rank=rank_value,
                name=name,
                state=None,
                metadata=metadata,
            )
        )

    return CountryList(country=country, source=source, universities=ranked)


def load_country_lists(paths: Iterable[Path]) -> List[CountryList]:
    return [load_country_list(Path(path)) for path in paths]
