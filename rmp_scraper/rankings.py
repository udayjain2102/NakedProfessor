from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import List, Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
import requests

BASE_URL = "https://www.stateuniversity.com/rank/score_rank_by_4yrc"
LOG = logging.getLogger(__name__)


@dataclass
class RankedCollege:
    """Representation of a ranked school from StateUniversity.com."""

    rank: int
    name: str
    url: Optional[str] = None
    state: Optional[str] = None
    score: Optional[float] = None
    previous_rank: Optional[int] = None
    metadata: dict = field(default_factory=dict)


class RankingScrapeError(RuntimeError):
    """Raised when the rankings list cannot be parsed."""


def fetch_top_ranked_colleges(
    session: requests.Session,
    limit: int = 500,
) -> List[RankedCollege]:
    """Fetch the top-ranked colleges from StateUniversity.com."""

    colleges: List[RankedCollege] = []
    page = 1
    while len(colleges) < limit:
        page_url = _page_url(page)
        LOG.debug("Fetching ranking page %s", page_url)
        response = session.get(page_url, timeout=30)
        if response.status_code >= 500:
            raise RankingScrapeError(
                f"StateUniversity.com returned {response.status_code} for {page_url}"
            )
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        table = _locate_ranking_table(soup)
        if table is None:
            raise RankingScrapeError(
                "Could not locate rankings table on StateUniversity.com page"
            )

        rows = table.find_all("tr")
        extracted = 0
        for row in rows:
            cells = row.find_all("td")
            if len(cells) < 3:
                continue
            rank = _extract_rank(cells[0].get_text(strip=True))
            name_cell = cells[2]
            name = name_cell.get_text(" ", strip=True)
            if not name or rank is None:
                continue
            school_url, state_code = _extract_school_link(name_cell)
            score = _extract_score(cells, index=3)
            prev_rank = _extract_rank(cells[1].get_text(strip=True)) if len(cells) > 1 else None

            colleges.append(
                RankedCollege(
                    rank=rank,
                    name=name,
                    url=school_url,
                    state=state_code,
                    score=score,
                    previous_rank=prev_rank,
                )
            )
            extracted += 1
            if len(colleges) >= limit:
                break

        LOG.debug("Parsed %d schools from page %d", extracted, page)
        if extracted == 0:
            raise RankingScrapeError(
                "Stopped early because no rows were parsed; page structure likely changed"
            )
        page += 1
        if page > 100:  # safety guard
            break

    return sorted(colleges, key=lambda c: c.rank)[:limit]


def _page_url(page: int) -> str:
    if page <= 1:
        return f"{BASE_URL}.html"
    return f"{BASE_URL}/{page}"


def _locate_ranking_table(soup: BeautifulSoup):
    tables = soup.find_all("table")
    for table in tables:
        headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]
        joined_headers = " ".join(headers)
        if "school" in joined_headers or "colleges" in joined_headers:
            return table
    return None


def _extract_rank(text: str) -> Optional[int]:
    digits = re.findall(r"\d+", text)
    return int(digits[0]) if digits else None


def _extract_score(cells: List, index: int) -> Optional[float]:
    if len(cells) <= index:
        return None
    try:
        return float(cells[index].get_text(strip=True).replace(",", ""))
    except ValueError:
        return None


def _extract_school_link(name_cell) -> tuple[Optional[str], Optional[str]]:
    anchor = name_cell.find("a")
    if not anchor:
        return None, None
    href = anchor.get("href")
    if not href:
        return None, None
    absolute = urljoin(BASE_URL, href)
    path_parts = [part for part in urlparse(absolute).path.split("/") if part]
    state_code = None
    if len(path_parts) >= 3 and path_parts[0].lower() == "universities":
        state_code = path_parts[1]
    return absolute, state_code
