from __future__ import annotations

import csv
import difflib
import sqlite3
from pathlib import Path
from typing import Iterable, List, Optional

from .professor_profiles import ProfessorSnapshot

DEFAULT_DB_PATH = Path(__file__).parent.parent / "data" / "professors.db"
DEFAULT_CSV_PATH = Path(__file__).parent.parent / "data" / "top200_plus_behrend_professors.csv"

COLUMNS = [
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


def _convert_value(column: str, value: Optional[str]):
    if value is None:
        return None
    value = value.strip()
    if value == "":
        return None
    if column in {"school_rank", "professor_legacy_id", "num_ratings"}:
        try:
            return int(value)
        except ValueError:
            return None
    if column in {"avg_rating", "avg_difficulty", "would_take_again_percent"}:
        try:
            return float(value)
        except ValueError:
            return None
    return value


def ensure_database(csv_path: Path = DEFAULT_CSV_PATH, db_path: Path = DEFAULT_DB_PATH) -> None:
    csv_path = Path(csv_path)
    db_path = Path(db_path)
    if not csv_path.exists():
        raise FileNotFoundError(f"Professor CSV not found at {csv_path}")

    csv_stat = csv_path.stat()
    csv_meta = {
        "source_path": str(csv_path.resolve()),
        "source_mtime": str(csv_stat.st_mtime),
        "source_size": str(csv_stat.st_size),
    }

    needs_refresh = not db_path.exists()
    if not needs_refresh:
        conn = sqlite3.connect(db_path)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='source_metadata'"
            )
            has_meta_table = cur.fetchone() is not None
            if not has_meta_table:
                needs_refresh = True
            else:
                cur.execute("SELECT key, value FROM source_metadata")
                stored_meta = {key: value for key, value in cur.fetchall()}
                if stored_meta != csv_meta:
                    needs_refresh = True
                else:
                    cur.execute("SELECT COUNT(*) FROM professors")
                    row_count = cur.fetchone()[0]
                    needs_refresh = row_count == 0
        finally:
            conn.close()

    if not needs_refresh:
        return

    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute("DROP TABLE IF EXISTS source_metadata")
        cur.execute("DROP TABLE IF EXISTS professors")
        cur.execute(
            """
            CREATE TABLE professors (
                school_rank INTEGER,
                school_name TEXT,
                school_id TEXT,
                school_state TEXT,
                professor_id TEXT PRIMARY KEY,
                professor_legacy_id INTEGER,
                professor_first TEXT,
                professor_last TEXT,
                department TEXT,
                avg_rating REAL,
                avg_difficulty REAL,
                would_take_again_percent REAL,
                num_ratings INTEGER,
                profile_url TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE source_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        with csv_path.open() as fp:
            reader = csv.DictReader(fp)
            rows = [
                [_convert_value(col, row.get(col)) for col in COLUMNS]
                for row in reader
            ]
        cur.executemany(
            """
            INSERT OR REPLACE INTO professors
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_professors_school ON professors(school_name)")
        cur.executemany(
            "INSERT INTO source_metadata(key, value) VALUES (?, ?)",
            list(csv_meta.items()),
        )
        conn.commit()
    finally:
        conn.close()


def _connect(db_path: Path = DEFAULT_DB_PATH):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _school_acronym(name: str) -> str:
    tokens = [
        token
        for token in name.replace("-", " ").split()
        if token and token.lower() not in {"of", "the", "and", "at", "in"}
    ]
    return "".join(token[0] for token in tokens).lower()


def search_schools(query: str, limit: int = 25, db_path: Path = DEFAULT_DB_PATH) -> List[str]:
    conn = _connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT DISTINCT school_name
            FROM professors
            ORDER BY school_name
            """
        )
        schools = [row[0] for row in cur.fetchall()]
    finally:
        conn.close()

    trimmed = query.strip()
    if not trimmed:
        return schools[:limit]

    query_lower = trimmed.lower()
    query_tokens = [token for token in query_lower.replace("-", " ").split() if token]
    scored = []
    for school in schools:
        school_lower = school.lower()
        acronym = _school_acronym(school)
        score = 0
        if school_lower == query_lower:
            score = 7
        elif acronym == query_lower:
            score = 6
        elif school_lower.startswith(query_lower):
            score = 5
        elif all(token in school_lower for token in query_tokens):
            score = 4
        elif query_lower in school_lower:
            score = 3
        elif any(token in school_lower for token in query_tokens):
            score = 2
        elif query_lower in acronym:
            score = 1
        if score:
            scored.append((score, school))

    fuzzy = difflib.get_close_matches(trimmed, schools, n=limit * 2, cutoff=0.4)
    seen = {school for _, school in scored}
    for school in fuzzy:
        if school not in seen:
            scored.append((1, school))

    scored.sort(key=lambda item: (-item[0], item[1]))
    return [school for _, school in scored[:limit]]


def get_professors_for_school(school_name: str, db_path: Path = DEFAULT_DB_PATH) -> List[ProfessorSnapshot]:
    conn = _connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT *
            FROM professors
            WHERE school_name = ?
            ORDER BY professor_last, professor_first
            """,
            (school_name,),
        )
        rows = cur.fetchall()
        return [_row_to_snapshot(row) for row in rows]
    finally:
        conn.close()


def get_professor_by_id(professor_id: str, db_path: Path = DEFAULT_DB_PATH) -> Optional[ProfessorSnapshot]:
    conn = _connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM professors WHERE professor_id = ?",
            (professor_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return _row_to_snapshot(row)
    finally:
        conn.close()


def _row_to_snapshot(row: sqlite3.Row) -> ProfessorSnapshot:
    return ProfessorSnapshot(
        school_rank=row["school_rank"],
        school_name=row["school_name"],
        school_id=row["school_id"],
        school_state=row["school_state"],
        professor_id=row["professor_id"],
        professor_legacy_id=row["professor_legacy_id"],
        professor_first=row["professor_first"],
        professor_last=row["professor_last"],
        department=row["department"],
        avg_rating=row["avg_rating"],
        avg_difficulty=row["avg_difficulty"],
        would_take_again_percent=row["would_take_again_percent"],
        num_ratings=row["num_ratings"],
        profile_url=row["profile_url"],
    )
