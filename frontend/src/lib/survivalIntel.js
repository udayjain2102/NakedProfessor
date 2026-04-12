/**
 * Deterministic “decision intel” derived from professor CSV + profile.
 * Turns signals into percentiles, scenarios, and actions — no API calls.
 */

import { deriveProfile, buildTensions } from "./profileDeriver";

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** Stable pseudo-random 0–99 from professor id + salt */
function pctFromId(id, salt) {
  const s = String(id || "") + salt;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h) % 100;
}

function gpaToLetter(g) {
  if (g >= 3.85) return "A";
  if (g >= 3.5) return "A-";
  if (g >= 3.15) return "B+";
  if (g >= 2.85) return "B";
  if (g >= 2.5) return "B-";
  if (g >= 2.1) return "C+";
  if (g >= 1.8) return "C";
  return "C– / D range";
}

function letterBandFromGpa(lowGpa, highGpa) {
  const a = gpaToLetter(lowGpa);
  const b = gpaToLetter(highGpa);
  return a === b ? a : `${a}–${b}`;
}

export function computeRiskLevel(profile, professor) {
  const rating = parseFloat(professor.avg_rating);
  const diff = parseFloat(professor.avg_difficulty);
  const n = parseInt(professor.num_ratings, 10) || 0;
  let score = 0;
  if (profile.clarity === "low") score += 2;
  if (profile.workload === "high") score += 1.5;
  if (profile.support === "low") score += 1.5;
  if (profile.assessment === "unpredictable") score += 2;
  if (rating != null && rating < 3) score += 1;
  if (diff != null && diff >= 4) score += 1.5;
  if (n < 5) score += 0.5;

  let level = "Low";
  let explanation =
    "Signals are manageable — consistency and early clarity-seeking usually win.";
  if (score >= 4 && score < 7) {
    level = "Medium";
    explanation =
      "Mixed signals — grading may be predictable, but prep load or clarity gaps add variance.";
  }
  if (score >= 7) {
    level = "High";
    explanation =
      "Several compounding risks — treat this as a class you actively manage, not cruise.";
  }

  return { level, explanation, score };
}

export function buildTldr(profile, risk) {
  const bits = [];
  if (profile.workload === "high") bits.push("Heavy workload");
  else if (profile.workload === "low") bits.push("Moderate workload");
  if (profile.assessment === "unpredictable")
    bits.push("unpredictable assessments");
  else if (profile.assessment === "lenient") bits.push("forgiving grading tone");
  if (profile.clarity === "low") bits.push("low lecture clarity");
  else bits.push("usable explanations");

  const tail =
    risk.level === "High"
      ? "— plan for sustained effort and exam-heavy prep."
      : risk.level === "Medium"
        ? "— A is realistic if you front-load practice."
        : "— A possible with consistency.";

  const head = bits.slice(0, 2).join(", ") || "Typical course";
  return `${head.charAt(0).toUpperCase() + head.slice(1)} ${tail}`;
}

export function computeSurvivalA(professor, profile) {
  const rating = parseFloat(professor.avg_rating);
  const diff = parseFloat(professor.avg_difficulty);
  const wta = parseFloat(professor.would_take_again_percent);
  const n = parseInt(professor.num_ratings, 10) || 0;

  let mid = 48;
  if (!Number.isNaN(rating)) mid += (rating - 3) * 11;
  if (!Number.isNaN(diff)) mid -= (diff - 3) * 9;
  if (!Number.isNaN(wta)) mid += (wta - 50) * 0.12;
  if (profile.clarity === "low") mid -= 6;
  if (profile.workload === "high") mid -= 5;
  if (profile.assessment === "unpredictable") mid -= 7;
  mid = clamp(Math.round(mid), 6, 91);

  const band = n < 5 ? 16 : n < 15 ? 11 : 7;
  return {
    mid,
    low: clamp(mid - band, 1, 99),
    high: clamp(mid + band, 1, 99),
    confidenceNote:
      n < 5
        ? `Sparse data (${n} reviews) — range is wider.`
        : `Based on ${n} student reviews and difficulty/clarity signals.`,
  };
}

/**
 * Percentile: higher = more of that trait (e.g. workload = heavier).
 * displayPct is 0–100 for bar fill.
 */
export function buildInsightMetrics(professor, profile) {
  const rating = parseFloat(professor.avg_rating);
  const diff = parseFloat(professor.avg_difficulty);
  const wta = parseFloat(professor.would_take_again_percent);

  const clarityPct = Number.isNaN(rating)
    ? 50
    : clamp(Math.round(((rating - 1) / 4) * 100), 5, 95);
  const workloadPct = Number.isNaN(diff)
    ? 50
    : clamp(Math.round(((diff - 1) / 4) * 100), 5, 95);
  const strictnessPct = Number.isNaN(wta)
    ? 50
    : clamp(Math.round(100 - wta), 5, 95);
  const examHardPct = Number.isNaN(diff)
    ? 50
    : clamp(
        Math.round(
          ((diff - 1) / 4) * 100 +
            (profile.assessment === "unpredictable" ? 12 : 0)
        ),
        5,
        98
      );
  const sentimentPct = Number.isNaN(rating)
    ? 50
    : clamp(Math.round(((rating - 2.5) / 2.5) * 100), 5, 95);

  const top = (p) => `Top ${clamp(100 - p, 1, 99)}%`;
  const bottom = (p) => `Bottom ${clamp(p, 1, 99)}%`;

  return [
    {
      key: "clarity",
      label: "Clarity",
      percentileLabel: clarityPct >= 50 ? top(clarityPct) : bottom(clarityPct),
      barPct: clarityPct,
      interpretation: Number.isNaN(rating)
        ? "Not enough rating data to place clarity."
        : `${bottom(clarityPct)} of courses on explanation quality vs peers.`,
      benchmark: "vs. dept / similar difficulty courses (proxy: RMP distribution).",
      implication:
        clarityPct < 40
          ? "Exams may not match what felt “fair” in lecture — verify with past work."
          : "You can lean on lecture structure if you stay caught up.",
      action:
        clarityPct < 42
          ? "Build a question bank after each class; confirm scope in office hours early."
          : "Skim recordings/slides same day; don’t defer synthesis to exam week.",
    },
    {
      key: "workload",
      label: "Workload",
      percentileLabel: top(workloadPct),
      barPct: workloadPct,
      interpretation: Number.isNaN(diff)
        ? "Difficulty unknown — assume medium until syllabus confirms."
        : `${top(workloadPct)} heaviest → expect ${diff >= 3.5 ? "8–12" : "5–8"} hrs/week outside class.`,
      benchmark: "Derived from avg difficulty (1–5) vs typical STEM distribution.",
      implication:
        workloadPct >= 65
          ? "Time is the bottleneck — protect deep-work blocks weekly."
          : "Room for depth if you avoid last-minute cramming.",
      action:
        workloadPct >= 60
          ? "Calendar 2× fixed weekly problem blocks; treat them as non-negotiable."
          : "Add one active-recall session weekly even if load feels light.",
    },
    {
      key: "strictness",
      label: "Strictness",
      percentileLabel: top(strictnessPct),
      barPct: strictnessPct,
      interpretation: Number.isNaN(wta)
        ? "Strictness unclear — scan syllabus for late policies."
        : `${top(strictnessPct)} strict on expectations (inverse of “would take again”).`,
      benchmark: "Proxy: would-take-again % + difficulty (students vote with feet).",
      implication:
        strictnessPct >= 55
          ? "Small misses (deadlines, format) may cost more than content gaps."
          : "Policy risk is moderate — still read rubrics literally.",
      action:
        "Submit everything 24h early the first month to eliminate avoidable losses.",
    },
    {
      key: "exam",
      label: "Exam difficulty",
      percentileLabel: top(examHardPct),
      barPct: examHardPct,
      interpretation:
        profile.assessment === "unpredictable"
          ? `${top(examHardPct)} hard + unpredictable style — practice > re-reading.`
          : `${top(examHardPct)} difficult vs typical — tests reward pattern recognition.`,
      benchmark: "Difficulty index + clarity gap (hard + opaque = worse outcomes).",
      implication:
        examHardPct >= 62
          ? "Mimic exam format with timed practice, not chapter summaries."
          : "Standard prep works if you don’t skip reps.",
      action:
        "Do 2 timed past exams (or parallel problems) before each high-stakes test.",
    },
    {
      key: "sentiment",
      label: "Student sentiment",
      percentileLabel: sentimentPct >= 50 ? top(sentimentPct) : bottom(sentimentPct),
      barPct: sentimentPct,
      interpretation: Number.isNaN(rating)
        ? "Sentiment unknown."
        : rating >= 4
          ? "Strong overall sentiment — effort tends to correlate with outcomes."
          : "Polarized or lukewarm sentiment — verify expectations yourself.",
      benchmark: "Average star rating vs cohort.",
      implication:
        sentimentPct < 45
          ? "Don’t trust vibe — trust your own checkpoints and practice scores."
          : "Class culture rewards steady work; don’t coast on optimism alone.",
      action:
        "Track your own mock scores; ignore anonymous extremes at the tails.",
    },
  ];
}

export function buildFailureStack(profile, professor) {
  const base = [];
  if (profile.clarity === "low") {
    base.push({
      reason: "Misread what exams actually test",
      pct: 22 + (pctFromId(professor.professor_id, "a") % 12),
      tip: "Use past rubrics + office hours to confirm scope by week 3.",
    });
  }
  if (profile.workload === "high") {
    base.push({
      reason: "Time debt — falling behind on problem sets",
      pct: 18 + (pctFromId(professor.professor_id, "b") % 15),
      tip: "Block time before new topics land; never skip two assignments in a row.",
    });
  }
  if (profile.support === "low") {
    base.push({
      reason: "Late help-seeking after first bad exam",
      pct: 15 + (pctFromId(professor.professor_id, "c") % 10),
      tip: "Book office hours in week 2 with a concrete question list.",
    });
  }
  if (profile.assessment === "unpredictable") {
    base.push({
      reason: "Under-practicing under exam-like conditions",
      pct: 20 + (pctFromId(professor.professor_id, "d") % 14),
      tip: "Swap passive review for timed, closed-notes drills.",
    });
  }
  base.push({
    reason: "Fatigue at root — inconsistent weekly effort",
    pct: 12 + (pctFromId(professor.professor_id, "e") % 9),
    tip: "Run a fixed weekly rhythm even when nothing is due.",
  });

  const total = base.reduce((s, x) => s + x.pct, 0);
  return base.map((x) => ({
    ...x,
    pct: Math.round((x.pct / total) * 100),
  }));
}

export function buildGradeScenarios(profile, professor) {
  const rating = parseFloat(professor.avg_rating);
  const diff = parseFloat(professor.avg_difficulty);
  let baseGpa = 3.1;
  if (!Number.isNaN(rating)) baseGpa += (rating - 3) * 0.25;
  if (!Number.isNaN(diff)) baseGpa -= (diff - 3) * 0.2;
  if (profile.clarity === "low") baseGpa -= 0.25;
  if (profile.workload === "high") baseGpa -= 0.12;

  const consistent = clamp(baseGpa + 0.45, 2.4, 4);
  const average = clamp(baseGpa, 2.1, 3.7);
  const low = clamp(baseGpa - 0.65, 1.5, 3.2);

  return {
    consistent: {
      label: "Consistent (recommended effort)",
      grades: letterBandFromGpa(consistent - 0.12, consistent + 0.1),
      condition: "Follow plan, no missed deadlines, 2+ exam reps per test.",
    },
    average: {
      label: "Average student effort",
      grades: letterBandFromGpa(average - 0.18, average + 0.12),
      condition: "Typical time allocation; some cramming before exams.",
    },
    low: {
      label: "Low effort",
      grades: letterBandFromGpa(low - 0.35, low + 0.15),
      condition: "Minimal prep, late starts, skipped practice — grade floor drops fast.",
    },
  };
}

export function buildProfessorPredictions(profile, professor) {
  const preds = [];
  if (profile.assessment === "unpredictable") {
    preds.push({
      text: "Midterm may include synthesis not spelled out in slides — expect twist questions.",
      confidence: "Medium",
      ifWrong: "If exam is straight, you over-prepared — that’s a good problem.",
    });
  } else {
    preds.push({
      text: "Assessments likely track homework themes — prioritize HW mastery over textbook breadth.",
      confidence: "Medium-high",
      ifWrong: "Pivot to past exams if HW doesn’t match test.",
    });
  }
  if (profile.workload === "high") {
    preds.push({
      text: "Workload spikes before midterm weeks — front-load problem sets in weeks 3–5.",
      confidence: "High",
      ifWrong: "Shift blocks earlier if your calendar shows conflicts sooner.",
    });
  }
  preds.push({
    text: "Participation and early deadlines matter most in the opening month.",
    confidence: "Medium",
    ifWrong: "If syllabus shows pure exam weighting, deprioritize participation noise.",
  });
  return preds.slice(0, 4);
}

export function effortToGradeBand(hours, profile, professor) {
  const h = clamp(hours, 2, 18);
  const diff = parseFloat(professor.avg_difficulty) || 3;
  let gpa = 2.4 + (h - 4) * 0.07 - (diff - 3) * 0.12;
  if (profile.clarity === "low") gpa -= 0.08;
  gpa = clamp(gpa, 1.7, 3.95);
  return letterBandFromGpa(gpa - 0.2, gpa + 0.18);
}

export function alignmentPercent(hours, profile) {
  const target = profile.workload === "high" ? 10 : profile.workload === "low" ? 6 : 8;
  const raw = 100 - Math.abs(hours - target) * 8;
  return clamp(Math.round(raw), 38, 96);
}

export function getFullIntel(professor) {
  if (!professor) return null;
  const profile = deriveProfile(professor);
  const risk = computeRiskLevel(profile, professor);
  return {
    profile,
    risk,
    tldr: buildTldr(profile, risk),
    survival: computeSurvivalA(professor, profile),
    metrics: buildInsightMetrics(professor, profile),
    failureStack: buildFailureStack(profile, professor),
    scenarios: buildGradeScenarios(profile, professor),
    predictions: buildProfessorPredictions(profile, professor),
    tensions: buildTensions(profile, professor.professor_first),
  };
}
