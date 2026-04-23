import { describe, expect, it, vi } from "vitest";
import { __internal, loadProfessorArtifact } from "./professorArtifactLoader";

const VALID_ARTIFACT = {
  schema_version: "1.0.0",
  generated_at: "2026-04-20T00:00:00Z",
  freshness: {
    generated_at: "2026-04-20T00:00:00Z",
    ttl_hours: 24 * 30,
  },
  schools: [
    {
      school_id: "school:st:test-university",
      name: "Test University",
      state: "ST",
      rank: 1,
    },
  ],
  professors: [
    {
      professor_id: "prof:1",
      school_id: "school:st:test-university",
      legacy_id: 1,
      first_name: "Jane",
      last_name: "Doe",
      department: "Mathematics",
      profile_url: "https://example.com",
      metrics: {
        avg_rating: 4.2,
        avg_difficulty: 3.4,
        would_take_again_percent: 72,
        num_ratings: 15,
      },
    },
  ],
};

const VALID_CSV = [
  "school_rank,school_name,school_id,school_state,professor_id,professor_legacy_id,professor_first,professor_last,department,avg_rating,avg_difficulty,would_take_again_percent,num_ratings,profile_url",
  "1,Test University,S_1,ST,P_1,1,Jane,Doe,Mathematics,4.2,3.4,72,15,https://example.com",
  "2,Pennsylvania State University - Behrend,S_2,PA,P_2,2,Alex,Morgan,Computer Science,4.1,3.1,76,19,https://example.com/alex",
].join("\n");

describe("professorArtifactLoader", () => {
  it("rejects empty artifacts", () => {
    expect(() => __internal.validateArtifactShape({})).toThrow(/schema_version/i);
  });

  it("rejects malformed artifacts", () => {
    const malformed = {
      ...VALID_ARTIFACT,
      professors: [{ school_id: "school:st:test-university" }],
    };
    expect(() => __internal.validateArtifactShape(malformed)).toThrow(/professor_id/i);
  });

  it("rejects stale artifacts", () => {
    const stale = {
      ...VALID_ARTIFACT,
      freshness: {
        generated_at: "2000-01-01T00:00:00Z",
        ttl_hours: 1,
      },
    };
    expect(() => __internal.validateArtifactFreshness(stale, Date.parse("2026-04-20T00:00:00Z"))).toThrow(
      /stale/i
    );
  });

  it("loads valid artifact and maps to legacy UI fields", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => VALID_ARTIFACT,
    }));
    const loaded = await loadProfessorArtifact({
      artifactPaths: ["/data/professors.normalized.v1.json"],
      fetchImpl,
    });
    expect(loaded.professors).toHaveLength(1);
    expect(loaded.professors[0].professor_first).toBe("Jane");
    expect(loaded.professors[0].school_name).toBe("Test University");
    expect(loaded.schools[0].name).toBe("Test University");
  });

  it("loads CSV fallback artifacts and maps to legacy UI fields", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => VALID_CSV,
    }));
    const loaded = await loadProfessorArtifact({
      artifactPaths: ["/data/top200_plus_behrend_professors.csv"],
      fetchImpl,
    });

    expect(loaded.professors).toHaveLength(2);
    expect(loaded.schools).toHaveLength(2);
    expect(loaded.professors[0].professor_first).toBe("Jane");
    expect(loaded.professors[0].school_name).toBe("Test University");
    expect(loaded.professors[1].department).toBe("Computer Science");
    expect(loaded.schools[1].name).toBe("Pennsylvania State University - Behrend");
  });

  it("falls back to CSV when the full normalized JSON is unavailable", async () => {
    const fetchImpl = vi.fn(async (path) => {
      if (String(path).endsWith(".json")) {
        return { ok: false };
      }
      return {
        ok: true,
        text: async () => VALID_CSV,
      };
    });
    const loaded = await loadProfessorArtifact({
      artifactPaths: ["/data/professors.normalized.v1.json", "/data/top200_plus_behrend_professors.csv"],
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(loaded.schools.map((school) => school.name)).toEqual([
      "Test University",
      "Pennsylvania State University - Behrend",
    ]);
  });
});
