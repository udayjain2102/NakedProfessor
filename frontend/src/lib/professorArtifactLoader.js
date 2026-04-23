/**
 * @typedef {Object} NormalizedSchool
 * @property {string} school_id
 * @property {string} name
 * @property {string | null | undefined} [state]
 * @property {number | null | undefined} [rank]
 */

/**
 * @typedef {Object} NormalizedProfessor
 * @property {string} professor_id
 * @property {string} school_id
 * @property {number | null | undefined} [legacy_id]
 * @property {string} first_name
 * @property {string} last_name
 * @property {string | null | undefined} [department]
 * @property {string | null | undefined} [profile_url]
 * @property {Object} [metrics]
 */

/**
 * @typedef {Object} NormalizedArtifact
 * @property {string} schema_version
 * @property {string} generated_at
 * @property {{ generated_at?: string, ttl_hours?: number }} [freshness]
 * @property {NormalizedSchool[]} schools
 * @property {NormalizedProfessor[]} professors
 */

const DEFAULT_ARTIFACT_PATHS = [
  "/data/professors.normalized.v1.json",
  "/data/top200_plus_behrend_professors.csv",
  "/data/behrend_professors.normalized.v1.json",
];

function resolveArtifactPaths() {
  const configuredPaths = import.meta.env.VITE_PROFESSOR_ARTIFACT_PATHS;
  if (!configuredPaths) return DEFAULT_ARTIFACT_PATHS;

  const paths = configuredPaths
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean);

  return paths.length ? paths : DEFAULT_ARTIFACT_PATHS;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateArtifactShape(artifact) {
  assert(isPlainObject(artifact), "Artifact must be a JSON object.");
  assert(typeof artifact.schema_version === "string", "Missing schema_version.");
  assert(Array.isArray(artifact.schools), "Artifact schools must be an array.");
  assert(Array.isArray(artifact.professors), "Artifact professors must be an array.");
  assert(artifact.professors.length > 0, "Artifact professors array is empty.");

  for (const school of artifact.schools) {
    assert(isPlainObject(school), "Each school must be an object.");
    assert(typeof school.school_id === "string" && school.school_id, "school_id is required.");
    assert(typeof school.name === "string" && school.name, "school name is required.");
  }

  for (const professor of artifact.professors) {
    assert(isPlainObject(professor), "Each professor must be an object.");
    assert(
      typeof professor.professor_id === "string" && professor.professor_id,
      "professor_id is required."
    );
    assert(typeof professor.school_id === "string" && professor.school_id, "school_id is required.");
    assert(
      typeof professor.first_name === "string" && typeof professor.last_name === "string",
      "first_name and last_name are required."
    );
  }
}

function validateArtifactFreshness(artifact, nowMs = Date.now()) {
  const freshness = artifact.freshness;
  if (!freshness || typeof freshness.ttl_hours !== "number") return;
  const generatedAt = Date.parse(freshness.generated_at || artifact.generated_at || "");
  if (!Number.isFinite(generatedAt)) {
    throw new Error("Artifact freshness metadata is malformed.");
  }
  const ttlMs = freshness.ttl_hours * 60 * 60 * 1000;
  if (nowMs - generatedAt > ttlMs) {
    throw new Error("Artifact is stale.");
  }
}

function toLegacyProfessorShape(artifact) {
  const schoolsById = new Map(artifact.schools.map((school) => [school.school_id, school]));
  return artifact.professors.map((prof) => {
    const school = schoolsById.get(prof.school_id) || {};
    const metrics = isPlainObject(prof.metrics) ? prof.metrics : {};
    return {
      professor_id: prof.professor_id,
      professor_legacy_id: prof.legacy_id || "",
      professor_first: prof.first_name,
      professor_last: prof.last_name,
      department: prof.department || "",
      profile_url: prof.profile_url || "",
      school_id: prof.school_id,
      school_name: school.name || "",
      school_state: school.state || "",
      school_rank: school.rank ?? "",
      avg_rating: metrics.avg_rating ?? "",
      avg_difficulty: metrics.avg_difficulty ?? "",
      would_take_again_percent: metrics.would_take_again_percent ?? "",
      num_ratings: metrics.num_ratings ?? "",
    };
  });
}

function toSchoolRankingShape(artifact) {
  return artifact.schools.map((school) => ({
    rank: school.rank ?? null,
    name: school.name,
    state: school.state || "",
  }));
}

function parseCsvRows(text, onRow) {
  let row = [];
  let field = "";
  let inQuotes = false;

  function emitRow() {
    if (!row.length && !field) return;
    row.push(field);
    onRow(row);
    row = [];
    field = "";
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      emitRow();
    } else if (char !== "\r") {
      field += char;
    }
  }

  emitRow();
}

function normalizeHeader(value) {
  return value.replace(/^\uFEFF/, "").trim();
}

function parseCsvRecords(text, onRecord) {
  let headers = null;

  parseCsvRows(text, (row) => {
    if (!headers) {
      headers = row.map(normalizeHeader);
      return;
    }

    if (row.every((value) => !String(value || "").trim())) return;

    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    onRecord(record);
  });

  return headers || [];
}

function parseRank(value) {
  const rank = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(rank) ? rank : null;
}

function toCsvArtifactShape(csvText) {
  const professors = [];
  const schoolsByKey = new Map();
  const headers = parseCsvRecords(csvText, (row) => {
    const schoolName = String(row.school_name || "").trim();
    const professorId = String(row.professor_id || "").trim();
    if (!schoolName || !professorId) return;

    const schoolState = String(row.school_state || "").trim();
    const schoolRank = parseRank(row.school_rank);
    const schoolId = String(row.school_id || "").trim();

    professors.push({
      school_rank: schoolRank ?? "",
      school_name: schoolName,
      school_id: schoolId,
      school_state: schoolState,
      professor_id: professorId,
      professor_legacy_id: String(row.professor_legacy_id || "").trim(),
      professor_first: String(row.professor_first || "").trim(),
      professor_last: String(row.professor_last || "").trim(),
      department: String(row.department || "").trim(),
      avg_rating: String(row.avg_rating || "").trim(),
      avg_difficulty: String(row.avg_difficulty || "").trim(),
      would_take_again_percent: String(row.would_take_again_percent || "").trim(),
      num_ratings: String(row.num_ratings || "").trim(),
      profile_url: String(row.profile_url || "").trim(),
    });

    const schoolKey = schoolId || `${schoolName}:${schoolState}`;
    if (!schoolsByKey.has(schoolKey)) {
      schoolsByKey.set(schoolKey, {
        rank: schoolRank,
        name: schoolName,
        state: schoolState,
      });
    }
  });

  const requiredHeaders = ["school_name", "professor_id", "professor_first", "professor_last"];
  for (const header of requiredHeaders) {
    assert(headers.includes(header), `CSV artifact is missing ${header}.`);
  }
  assert(professors.length > 0, "CSV artifact professors array is empty.");

  return {
    artifact: null,
    professors,
    schools: Array.from(schoolsByKey.values()).sort(
      (left, right) =>
        (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER) ||
        left.name.localeCompare(right.name)
    ),
  };
}

function isCsvPath(path) {
  return String(path || "").toLowerCase().split("?")[0].endsWith(".csv");
}

/**
 * @param {{ artifactPaths?: string[], fetchImpl?: typeof fetch, nowMs?: number }} [options]
 */
export async function loadProfessorArtifact(options = {}) {
  const artifactPaths = options.artifactPaths || resolveArtifactPaths();
  const fetchImpl = options.fetchImpl || fetch;
  const nowMs = options.nowMs ?? Date.now();
  let lastError = null;

  for (const path of artifactPaths) {
    try {
      const response = await fetchImpl(path);
      if (!response.ok) continue;

      if (isCsvPath(path)) {
        return toCsvArtifactShape(await response.text());
      }

      const payload = await response.json();
      validateArtifactShape(payload);
      validateArtifactFreshness(payload, nowMs);
      return {
        artifact: payload,
        professors: toLegacyProfessorShape(payload),
        schools: toSchoolRankingShape(payload),
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  throw new Error("Unable to fetch professor artifact.");
}

export const __internal = {
  parseCsvRows,
  resolveArtifactPaths,
  validateArtifactShape,
  validateArtifactFreshness,
};
