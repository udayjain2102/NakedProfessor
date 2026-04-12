from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

MONTH_PAT = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*"
DATE_REGEX = re.compile(
    rf"(?P<month>{MONTH_PAT})\s+(?P<day>\d{{1,2}})(?:,\s*(?P<year>\d{{2,4}}))?",
    flags=re.IGNORECASE,
)
PERCENT_REGEX = re.compile(r"(?P<weight>\d+(?:\.\d+)?)\s*%")
ASSESSMENT_KEYWORDS = [
    "exam",
    "midterm",
    "final",
    "quiz",
    "test",
    "project",
    "paper",
    "presentation",
    "assignment",
]
TOPIC_PREFIXES = ("week", "topic", "lecture")


@dataclass
class Assessment:
    name: str
    weight: Optional[float] = None
    date_text: Optional[str] = None
    notes: Optional[str] = None


@dataclass
class SyllabusSnapshot:
    assessments: List[Assessment] = field(default_factory=list)
    topics: List[str] = field(default_factory=list)
    upcoming: List[str] = field(default_factory=list)


def _parse_date(text: str) -> Optional[str]:
    match = DATE_REGEX.search(text)
    if not match:
        return None
    groups = match.groupdict()
    month = groups["month"]
    day = groups["day"]
    year = groups.get("year")
    candidates = [
        f"{month} {day}, {year}" if year else f"{month} {day}",
        f"{month} {day} {year}" if year else None,
    ]
    for candidate in candidates:
        if not candidate:
            continue
        for fmt in ("%B %d, %Y", "%b %d, %Y", "%B %d %Y", "%b %d %Y", "%B %d", "%b %d"):
            try:
                dt = datetime.strptime(candidate, fmt)
                if "%Y" not in fmt:
                    dt = dt.replace(year=datetime.now().year)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue
    # If parsing fails, return the raw match for display
    return match.group(0)


def _parse_weight(text: str) -> Optional[float]:
    match = PERCENT_REGEX.search(text)
    if not match:
        return None
    try:
        return float(match.group("weight"))
    except ValueError:
        return None


def _is_topic_line(line: str) -> bool:
    lowered = line.lower()
    return lowered.startswith(TOPIC_PREFIXES) or lowered.startswith("- ") or lowered.startswith("* ")


def parse_syllabus(text: str) -> SyllabusSnapshot:
    snapshot = SyllabusSnapshot()
    if not text:
        return snapshot

    lines = [line.strip("•- \t") for line in text.splitlines()]
    lines = [line.strip() for line in lines if line.strip()]

    for line in lines:
        lowered = line.lower()
        if any(keyword in lowered for keyword in ASSESSMENT_KEYWORDS):
            weight = _parse_weight(line)
            date_text = _parse_date(line)
            snapshot.assessments.append(
                Assessment(
                    name=line.split(":")[0].strip().title(),
                    weight=weight,
                    date_text=date_text,
                    notes=line,
                )
            )
            if date_text:
                snapshot.upcoming.append(f"{line.split(':')[0].strip()} on {date_text}")
            continue

        if _is_topic_line(line):
            snapshot.topics.append(line)
            continue

        # capture schedule style lines like "Week 3 – Vectors – Quiz 1 (10%)"
        if lowered.startswith("week"):
            snapshot.topics.append(line)

    return snapshot


def snapshot_as_json(snapshot: SyllabusSnapshot) -> dict:
    return {
        "assessments": [
            {
                "name": assessment.name,
                "weight": assessment.weight,
                "date": assessment.date_text,
                "notes": assessment.notes,
            }
            for assessment in snapshot.assessments
        ],
        "topics": snapshot.topics,
        "upcoming": snapshot.upcoming,
    }
