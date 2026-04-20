from __future__ import annotations

import base64
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional

import requests

LOG = logging.getLogger(__name__)
RMP_GRAPHQL_URL = "https://www.ratemyprofessors.com/graphql"
DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Content-Type": "application/json",
    "Accept": "application/json",
}

SCHOOL_QUERY = """query NewSearchSchoolsQuery($query: SchoolSearchQuery!) {
  newSearch {
    schools(query: $query) {
      edges {
        cursor
        node {
          id
          legacyId
          name
          city
          state
          departments {
            id
            name
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
"""

# Paginated listing for one school (matches RMP's current schema; schoolID + optional text).
TEACHERS_QUERY = """query ProfessorRatingsQuery(
  $schoolID: ID!
  $text: String
  $first: Int!
  $after: String
) {
  newSearch {
    teachers(query: { schoolID: $schoolID, text: $text }, first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          legacyId
          firstName
          lastName
          department
          avgRating
          avgDifficulty
          wouldTakeAgainPercent
          numRatings
          school {
            id
            legacyId
            name
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
"""

TEACHER_RATINGS_QUERY = """query TeacherRatingsPageQuery(
  $id: ID!
  $ratingsFirst: Int!
  $ratingsAfter: String
) {
  node(id: $id) {
    ... on Teacher {
      firstName
      lastName
      ratings(first: $ratingsFirst, after: $ratingsAfter) {
        edges {
          cursor
          node {
            comment
            date
            class
            clarityRating
            difficultyRating
            wouldTakeAgain
            grade
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
    id
  }
}
"""


def teacher_gid_from_legacy(legacy_id: int) -> str:
    """RMP GraphQL IDs are base64('Teacher-<legacyId>')."""
    return base64.b64encode(f"Teacher-{legacy_id}".encode()).decode()


@dataclass
class SchoolMatch:
    id: str
    legacy_id: Optional[int]
    name: str
    city: str
    state: str


@dataclass
class ProfessorRecord:
    id: str
    legacy_id: int
    first_name: str
    last_name: str
    department: Optional[str]
    avg_rating: Optional[float]
    avg_difficulty: Optional[float]
    would_take_again_percent: Optional[float]
    num_ratings: int
    school_id: str
    school_name: str
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def profile_url(self) -> str:
        return f"https://www.ratemyprofessors.com/professor/{self.legacy_id}"


@dataclass
class RatingRecord:
    teacher_id: str
    teacher_first_name: Optional[str]
    teacher_last_name: Optional[str]
    date: Optional[str]
    course_code: Optional[str]
    comment: Optional[str]
    clarity_rating: Optional[int]
    difficulty_rating: Optional[int]
    would_take_again: Optional[int]
    grade: Optional[str]

    def as_dict(self) -> dict[str, Any]:
        return {
            "teacher_id": self.teacher_id,
            "teacher_first_name": self.teacher_first_name,
            "teacher_last_name": self.teacher_last_name,
            "date": self.date,
            "course_code": self.course_code,
            "comment": self.comment,
            "clarity_rating": self.clarity_rating,
            "difficulty_rating": self.difficulty_rating,
            "would_take_again": self.would_take_again,
            "grade": self.grade,
        }


class RateMyProfessorsClient:
    def __init__(
        self,
        session: Optional[requests.Session] = None,
        delay: float = 0.5,
        page_size: int = 100,
        ratings_page_size: int = 50,
        max_retries: int = 3,
        retry_backoff_seconds: float = 1.0,
    ):
        self.session = session or requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)
        self.delay = delay
        self.page_size = page_size
        self.ratings_page_size = ratings_page_size
        self.max_retries = max_retries
        self.retry_backoff_seconds = retry_backoff_seconds

    def _graphql(self, payload: dict) -> dict:
        max_attempts = max(1, self.max_retries + 1)
        for attempt in range(1, max_attempts + 1):
            try:
                response = self.session.post(RMP_GRAPHQL_URL, json=payload, timeout=30)
                should_retry = response.status_code == 429 or response.status_code >= 500
                if should_retry and attempt < max_attempts:
                    wait_seconds = self.retry_backoff_seconds * attempt
                    LOG.warning(
                        "RMP returned %s (attempt %d/%d). Retrying in %.1fs",
                        response.status_code,
                        attempt,
                        max_attempts,
                        wait_seconds,
                    )
                    time.sleep(wait_seconds)
                    continue

                response.raise_for_status()
                data = response.json()
                if "errors" in data and data.get("errors"):
                    raise RuntimeError(f"GraphQL error: {data['errors']}")
                return data
            except (requests.RequestException, ValueError) as exc:
                if attempt >= max_attempts:
                    raise RuntimeError(
                        f"GraphQL request failed after {max_attempts} attempts"
                    ) from exc
                wait_seconds = self.retry_backoff_seconds * attempt
                LOG.warning(
                    "GraphQL request failed on attempt %d/%d: %s. Retrying in %.1fs",
                    attempt,
                    max_attempts,
                    exc,
                    wait_seconds,
                )
                time.sleep(wait_seconds)
        raise RuntimeError("Unexpected GraphQL retry loop exit")

    @staticmethod
    def _normalize_school_name(name: str) -> str:
        lowered = (name or "").lower()
        lowered = re.sub(r"[^\w\s]", " ", lowered)
        lowered = re.sub(
            r"\b(the|university|college|campus|at|of|main)\b",
            " ",
            lowered,
        )
        return " ".join(lowered.split())

    def search_school(self, name: str, max_rows: int = 5) -> List[SchoolMatch]:
        payload = {
            "query": SCHOOL_QUERY,
            "variables": {"query": {"text": name}},
        }
        data = self._graphql(payload)
        schools = data["data"]["newSearch"]["schools"]["edges"]
        matches = []
        for edge in schools[:max_rows]:
            node = edge["node"]
            matches.append(
                SchoolMatch(
                    id=node["id"],
                    legacy_id=node.get("legacyId"),
                    name=node["name"],
                    city=node.get("city", "") or "",
                    state=node.get("state", "") or "",
                )
            )
        return matches

    def match_school(
        self,
        search_text: str,
        *,
        name_contains: Optional[str] = None,
        city_equals: Optional[str] = None,
        state_equals: Optional[str] = None,
        max_results: int = 15,
        default_index: int = 0,
    ) -> Optional[SchoolMatch]:
        """Search RMP schools and pick a deterministic best match."""
        matches = self.search_school(search_text, max_rows=max_results)
        if not matches:
            return None
        if name_contains:
            needle = name_contains.lower()
            want_city = (city_equals or "").strip().lower() if city_equals else None
            for m in matches:
                if needle not in m.name.lower():
                    continue
                if want_city and (m.city or "").strip().lower() != want_city:
                    continue
                return m
            return None
        if state_equals:
            target_state = state_equals.strip().lower()
            state_filtered = [m for m in matches if (m.state or "").strip().lower() == target_state]
            if len(state_filtered) == 1:
                return state_filtered[0]
            if state_filtered:
                matches = state_filtered

        normalized_search = self._normalize_school_name(search_text)

        def score(match: SchoolMatch) -> int:
            value = 0
            normalized_name = self._normalize_school_name(match.name)
            if normalized_search and normalized_name == normalized_search:
                value += 100
            if normalized_search and normalized_search in normalized_name:
                value += 50
            if state_equals and (match.state or "").strip().lower() == state_equals.strip().lower():
                value += 25
            return value

        scored = [(score(m), idx, m) for idx, m in enumerate(matches)]
        best_score, _, best_match = max(scored, key=lambda item: (item[0], -item[1]))
        if best_score > 0:
            return best_match
        if 0 <= default_index < len(matches):
            return matches[default_index]
        return matches[0]

    def iter_professors(
        self,
        school_id: str,
        search_text: Optional[str] = None,
    ) -> Iterator[ProfessorRecord]:
        variables: Dict[str, Any] = {
            "schoolID": school_id,
            "text": (search_text.strip() or None) if search_text else None,
            "first": self.page_size,
            "after": "",
        }
        while True:
            if variables.get("after"):
                time.sleep(self.delay)
            payload = {"query": TEACHERS_QUERY, "variables": variables}
            data = self._graphql(payload)
            teacher_block = data["data"]["newSearch"]["teachers"]
            for edge in teacher_block["edges"]:
                node = edge["node"]
                school = node.get("school") or {}
                yield ProfessorRecord(
                    id=node["id"],
                    legacy_id=node["legacyId"],
                    first_name=node.get("firstName", "") or "",
                    last_name=node.get("lastName", "") or "",
                    department=node.get("department"),
                    avg_rating=node.get("avgRating"),
                    avg_difficulty=node.get("avgDifficulty"),
                    would_take_again_percent=node.get("wouldTakeAgainPercent"),
                    num_ratings=node.get("numRatings") or 0,
                    school_id=school.get("id", school_id),
                    school_name=school.get("name", ""),
                )
            page_info = teacher_block["pageInfo"]
            if not page_info.get("hasNextPage"):
                break
            variables["after"] = page_info.get("endCursor") or ""

    def iter_teacher_ratings(self, teacher_id: str) -> Iterator[RatingRecord]:
        """Paginate all ratings for a teacher GraphQL node id (or use teacher_gid_from_legacy)."""
        ratings_after: Optional[str] = ""
        first_name: Optional[str] = None
        last_name: Optional[str] = None

        while True:
            if ratings_after:
                time.sleep(self.delay)
            payload = {
                "query": TEACHER_RATINGS_QUERY,
                "variables": {
                    "id": teacher_id,
                    "ratingsFirst": self.ratings_page_size,
                    "ratingsAfter": ratings_after or None,
                },
            }
            data = self._graphql(payload)
            node = data.get("data", {}).get("node")
            if node is None:
                raise RuntimeError(f"No teacher node returned for id={teacher_id!r}")
            first_name = node.get("firstName") or first_name
            last_name = node.get("lastName") or last_name
            ratings = node.get("ratings") or {}
            for edge in ratings.get("edges", []):
                rnode = edge["node"]
                yield RatingRecord(
                    teacher_id=teacher_id,
                    teacher_first_name=first_name,
                    teacher_last_name=last_name,
                    date=rnode.get("date"),
                    course_code=rnode.get("class"),
                    comment=rnode.get("comment"),
                    clarity_rating=rnode.get("clarityRating"),
                    difficulty_rating=rnode.get("difficultyRating"),
                    would_take_again=rnode.get("wouldTakeAgain"),
                    grade=rnode.get("grade"),
                )
            page_info = ratings.get("pageInfo") or {}
            if not page_info.get("hasNextPage"):
                break
            ratings_after = page_info.get("endCursor")
            if not ratings_after:
                break
