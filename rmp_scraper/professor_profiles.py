from __future__ import annotations

import csv
import difflib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Optional


DEFAULT_CSV_PATH = Path(__file__).parent.parent / "data" / "top200_plus_behrend_professors.csv"


def _parse_int(value: str) -> Optional[int]:
    value = value.strip()
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _parse_float(value: str) -> Optional[float]:
    value = value.strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


@dataclass(frozen=True)
class ProfessorSnapshot:
    school_rank: Optional[int]
    school_name: str
    school_id: str
    school_state: Optional[str]
    professor_id: str
    professor_legacy_id: Optional[int]
    professor_first: str
    professor_last: str
    department: Optional[str]
    avg_rating: Optional[float]
    avg_difficulty: Optional[float]
    would_take_again_percent: Optional[float]
    num_ratings: Optional[int]
    profile_url: str

    @property
    def full_name(self) -> str:
        return f"{self.professor_first} {self.professor_last}".strip()


@dataclass(frozen=True)
class ParameterInsight:
    level: str
    summary: str
    signals: List[str]


@dataclass(frozen=True)
class ProfessorProfile:
    snapshot: ProfessorSnapshot
    parameters: Dict[str, ParameterInsight]
    reliability: str
    tensions: List[str]


@lru_cache(maxsize=1)
def load_professor_snapshots(csv_path: str | Path = DEFAULT_CSV_PATH) -> List[ProfessorSnapshot]:
    path = Path(csv_path)
    if not path.exists():
        raise FileNotFoundError(f"Professor CSV not found: {path}")
    records: List[ProfessorSnapshot] = []
    with path.open() as fp:
        reader = csv.DictReader(fp)
        for row in reader:
            records.append(
                ProfessorSnapshot(
                    school_rank=_parse_int(row.get("school_rank", "")),
                    school_name=row.get("school_name", "").strip(),
                    school_id=row.get("school_id", "").strip(),
                    school_state=row.get("school_state", "").strip() or None,
                    professor_id=row.get("professor_id", "").strip(),
                    professor_legacy_id=_parse_int(row.get("professor_legacy_id", "")),
                    professor_first=row.get("professor_first", "").strip(),
                    professor_last=row.get("professor_last", "").strip(),
                    department=row.get("department", "").strip() or None,
                    avg_rating=_parse_float(row.get("avg_rating", "")),
                    avg_difficulty=_parse_float(row.get("avg_difficulty", "")),
                    would_take_again_percent=_parse_float(row.get("would_take_again_percent", "")),
                    num_ratings=_parse_int(row.get("num_ratings", "")),
                    profile_url=row.get("profile_url", "").strip(),
                )
            )
    return records


def list_unique_schools(records: Iterable[ProfessorSnapshot]) -> List[str]:
    seen = set()
    ordered: List[str] = []
    for record in records:
        name = record.school_name
        if name and name not in seen:
            ordered.append(name)
            seen.add(name)
    ordered.sort()
    return ordered


def search_schools(records: Iterable[ProfessorSnapshot], query: str, limit: int = 10) -> List[str]:
    schools = list_unique_schools(records)
    query_lower = query.strip().lower()
    if not query_lower:
        return schools[:limit]
    matches = [s for s in schools if query_lower in s.lower()]
    if len(matches) < limit:
        fuzzy = difflib.get_close_matches(query, schools, n=limit)
        for name in fuzzy:
            if name not in matches:
                matches.append(name)
            if len(matches) >= limit:
                break
    return matches[:limit]


def professors_for_school(records: Iterable[ProfessorSnapshot], school_name: str) -> List[ProfessorSnapshot]:
    filtered = [r for r in records if r.school_name.lower() == school_name.lower()]
    return sorted(filtered, key=lambda r: (r.professor_last, r.professor_first))


def _level_from_thresholds(value: Optional[float], thresholds: tuple[float, float]) -> str:
    if value is None:
        return "unknown"
    low, high = thresholds
    if value < low:
        return "low"
    if value > high:
        return "high"
    return "medium"


def _reliability_from_reviews(num_ratings: Optional[int]) -> str:
    if num_ratings is None:
        return "unknown"
    if num_ratings >= 50:
        return "high"
    if num_ratings >= 20:
        return "medium"
    return "low"


def derive_parameter_profile(snapshot: ProfessorSnapshot) -> ProfessorProfile:
    clarity_level = _level_from_thresholds(snapshot.avg_rating, (3.2, 4.2))
    workload_level = _level_from_thresholds(snapshot.avg_difficulty, (2.8, 3.8))
    sentiment_level = _level_from_thresholds(snapshot.avg_rating, (2.8, 4.0))

    would_take_again = snapshot.would_take_again_percent
    support_level: str
    if would_take_again is None or would_take_again < 0:
        support_level = "unknown"
    elif would_take_again >= 70:
        support_level = "high"
    elif would_take_again >= 40:
        support_level = "medium"
    else:
        support_level = "low"

    assessment_level: str
    if snapshot.avg_difficulty is None:
        assessment_level = "unknown"
    elif snapshot.avg_difficulty >= 3.8 and clarity_level in {"low", "medium"}:
        assessment_level = "unpredictable"
    elif snapshot.avg_difficulty <= 2.5:
        assessment_level = "lenient"
    else:
        assessment_level = "balanced"

    parameters: Dict[str, ParameterInsight] = {
        "instruction_clarity": ParameterInsight(
            level=clarity_level,
            summary=f"Average rating {snapshot.avg_rating or 'N/A'} on a 5-point scale.",
            signals=[
                "Higher ratings generally correlate with clearer instruction.",
                f"Num ratings: {snapshot.num_ratings or 'N/A'}",
            ],
        ),
        "workload_intensity": ParameterInsight(
            level=workload_level,
            summary=f"Difficulty score {snapshot.avg_difficulty or 'N/A'} (5=hardest).",
            signals=["Scores above 3.8 suggest heavy weekly load."],
        ),
        "support_accessibility": ParameterInsight(
            level=support_level,
            summary=(
                "Would-take-again data unavailable"
                if support_level == "unknown"
                else f"{would_take_again:.0f}% of students would repeat the course."
            ),
            signals=["Higher percentages imply more responsive/helpful support."],
        ),
        "assessment_strictness": ParameterInsight(
            level=assessment_level,
            summary="Derived from difficulty vs. clarity relationship.",
            signals=[
                f"Difficulty: {snapshot.avg_difficulty or 'N/A'}",
                f"Clarity proxy: {clarity_level}",
            ],
        ),
        "student_sentiment": ParameterInsight(
            level=sentiment_level,
            summary="Blends overall rating with repeat intent.",
            signals=[
                f"Avg rating: {snapshot.avg_rating or 'N/A'}",
                f"Would take again: {would_take_again if would_take_again not in (None, -1) else 'N/A'}",
            ],
        ),
    }

    tensions = _build_tensions(parameters)

    return ProfessorProfile(
        snapshot=snapshot,
        parameters=parameters,
        reliability=_reliability_from_reviews(snapshot.num_ratings),
        tensions=tensions,
    )


def _build_tensions(parameters: Dict[str, ParameterInsight]) -> List[str]:
    tensions: List[str] = []
    clarity = parameters.get("instruction_clarity")
    workload = parameters.get("workload_intensity")
    support = parameters.get("support_accessibility")
    assessment = parameters.get("assessment_strictness")

    if clarity and clarity.level == "low":
        tensions.append(
            "Students report low clarity—expect to supplement lectures with self-sourced explanations."
        )
    if workload and workload.level == "high":
        tensions.append("Expect an aggressive pace with heavier weekly deliverables than average.")
    if support and support.level == "low":
        tensions.append("Student support sentiment is low—plan proactive office-hour and peer support.")
    if assessment and assessment.level == "unpredictable":
        tensions.append("Assessments trend difficult without matching clarity—build your own checkpoints.")
    if not tensions:
        tensions.append("No major risk flags detected; maintain steady study habits aligned with syllabus.")
    return tensions


def profile_as_dict(profile: ProfessorProfile) -> Dict[str, object]:
    return {
        "reliability": profile.reliability,
        "parameters": {
            name: {
                "level": insight.level,
                "summary": insight.summary,
                "signals": insight.signals,
            }
            for name, insight in profile.parameters.items()
        },
        "tensions": profile.tensions,
        "professor": {
            "name": profile.snapshot.full_name,
            "department": profile.snapshot.department,
            "school": profile.snapshot.school_name,
            "school_rank": profile.snapshot.school_rank,
        },
    }
