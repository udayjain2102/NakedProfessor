from __future__ import annotations

import difflib
import json
import sqlite3
from pathlib import Path
from typing import List, Optional

from .professor_profiles import ProfessorSnapshot

DEFAULT_DB_PATH = Path(__file__).parent.parent / "data" / "professors.db"
DEFAULT_ARTIFACT_PATH = Path(__file__).parent.parent / "data" / "professors.normalized.v1.json"

def ensure_database(
    artifact_path: Path = DEFAULT_ARTIFACT_PATH,
    db_path: Path = DEFAULT_DB_PATH,
) -> None:
    artifact_path = Path(artifact_path)
    db_path = Path(db_path)
    if not artifact_path.exists():
        raise FileNotFoundError(f"Professor artifact not found at {artifact_path}")

    artifact_stat = artifact_path.stat()
    source_meta = {
        "source_path": str(artifact_path.resolve()),
        "source_mtime": str(artifact_stat.st_mtime),
        "source_size": str(artifact_stat.st_size),
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
                if stored_meta != source_meta:
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
        artifact = json.loads(artifact_path.read_text())
        schools_by_id = {
            school.get("school_id"): school for school in artifact.get("schools", [])
        }
        rows = []
        for row in artifact.get("professors", []):
            school_id = row.get("school_id")
            school = schools_by_id.get(school_id, {})
            metrics = row.get("metrics", {})
            rows.append(
                [
                    school.get("rank"),
                    school.get("name"),
                    school_id,
                    school.get("state"),
                    row.get("professor_id"),
                    row.get("legacy_id"),
                    row.get("first_name"),
                    row.get("last_name"),
                    row.get("department"),
                    metrics.get("avg_rating"),
                    metrics.get("avg_difficulty"),
                    metrics.get("would_take_again_percent"),
                    metrics.get("num_ratings"),
                    row.get("profile_url"),
                ]
            )
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
            list(source_meta.items()),
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
