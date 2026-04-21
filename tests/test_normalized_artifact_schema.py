from rmp_scraper.pipeline import (
    ARTIFACT_SCHEMA_VERSION,
    build_normalized_professor_artifact,
)
from rmp_scraper.rmp_client import ProfessorRecord


def _sample_records():
    first = ProfessorRecord(
        id="T_abc",
        legacy_id=1234,
        first_name="Jane",
        last_name="Doe",
        department="Mathematics",
        avg_rating=4.2,
        avg_difficulty=3.1,
        would_take_again_percent=80.0,
        num_ratings=11,
        school_id="S_1",
        school_name="Pennsylvania State University - Behrend",
        metadata={"rank": 201, "state": "PA"},
    )
    second = ProfessorRecord(
        id="T_xyz",
        legacy_id=5678,
        first_name="John",
        last_name="Smith",
        department="Physics",
        avg_rating=3.8,
        avg_difficulty=3.4,
        would_take_again_percent=61.0,
        num_ratings=9,
        school_id="S_1",
        school_name="Pennsylvania State University - Behrend",
        metadata={"rank": 201, "state": "PA"},
    )
    return [first, second]


def test_artifact_has_required_top_level_contract():
    artifact = build_normalized_professor_artifact(_sample_records())
    assert artifact["schema_version"] == ARTIFACT_SCHEMA_VERSION
    assert "generated_at" in artifact
    assert "freshness" in artifact
    assert "source_provenance" in artifact
    assert isinstance(artifact["schools"], list)
    assert isinstance(artifact["professors"], list)
    assert artifact["schools"]
    assert artifact["professors"]


def test_school_entries_include_canonical_ids_aliases_tokens_and_provenance():
    artifact = build_normalized_professor_artifact(_sample_records())
    school = artifact["schools"][0]
    assert school["school_id"].startswith("school:")
    assert school["upstream_school_id"] == "S_1"
    assert school["name"] == "Pennsylvania State University - Behrend"
    assert school["state"] == "PA"
    assert school["rank"] == 201
    assert isinstance(school["aliases"], list) and school["aliases"]
    assert isinstance(school["search_tokens"], list) and school["search_tokens"]
    assert school["source_provenance"]["provider"] == "ratemyprofessors"
    assert school["source_provenance"]["provider_school_id"] == "S_1"


def test_professor_entries_include_canonical_ids_aliases_tokens_freshness_and_metrics():
    artifact = build_normalized_professor_artifact(_sample_records())
    professor = artifact["professors"][0]
    assert professor["professor_id"].startswith("prof:")
    assert professor["school_id"].startswith("school:")
    assert professor["upstream_professor_id"]
    assert professor["legacy_id"]
    assert professor["first_name"]
    assert professor["last_name"]
    assert professor["full_name"]
    assert isinstance(professor["aliases"], list) and professor["aliases"]
    assert isinstance(professor["search_tokens"], list) and professor["search_tokens"]
    assert "observed_at" in professor["freshness"]
    assert professor["source_provenance"]["provider"] == "ratemyprofessors"
    assert "metrics" in professor
    assert {"avg_rating", "avg_difficulty", "would_take_again_percent", "num_ratings"} <= set(
        professor["metrics"].keys()
    )
