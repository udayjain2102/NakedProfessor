"""Helper package for scraping professor data from RateMyProfessors."""

from .rankings import RankedCollege, fetch_top_ranked_colleges
from .rmp_client import RateMyProfessorsClient, ProfessorRecord, SchoolMatch

__all__ = [
    "RankedCollege",
    "fetch_top_ranked_colleges",
    "RateMyProfessorsClient",
    "ProfessorRecord",
    "SchoolMatch",
]
