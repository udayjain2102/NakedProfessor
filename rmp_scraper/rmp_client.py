from __future__ import annotations

import base64
import logging
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
    ):
        self.session = session or requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)
        self.delay = delay
        self.page_size = page_size
        self.ratings_page_size = ratings_page_size

    def _graphql(self, payload: dict) -> dict:
        response = self.session.post(RMP_GRAPHQL_URL, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
        if "errors" in data and data.get("errors"):
            raise RuntimeError(f"GraphQL error: {data['errors']}")
        return data

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
        max_results: int = 15,
        default_index: int = 0,
    ) -> Optional[SchoolMatch]:
        """Search RMP schools and pick a row (filter by name/city) or fall back to ``default_index``."""
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
