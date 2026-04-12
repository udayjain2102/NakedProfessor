/**
 * Lightweight syllabus parser for keyword extraction
 */

export function parseSyllabus(text) {
  const lower = text.toLowerCase();

  return {
    hasExams: /exam|test|quiz|assessment/.test(lower),
    hasProjects: /project|assignment|paper|presentation|group work/.test(lower),
    hasParticipation: /participation|discussion|attendance|engagement/.test(lower),
    numSections: (text.match(/^[A-Z]/gm) || []).length,
    keywords: extractKeywords(text),
    grading: parseGradingBreakdown(text),
  };
}

/**
 * Best-effort extraction of grading weights (percents) for strategy copy.
 */
export function parseGradingBreakdown(text) {
  if (!text || !text.trim()) {
    return {
      examTotal: null,
      homeworkTotal: null,
      participationPct: null,
      projectPct: null,
      confidence: "none",
      summary: "Paste grading breakdown to auto-detect weights.",
    };
  }

  const lower = text.toLowerCase();
  let examTotal = 0;
  let homeworkTotal = 0;
  let participationPct = null;
  let projectPct = null;

  const examKeywords =
    /(\d+)\s*%\s*(?:for|of|on)?[^.\n]{0,40}?(?:exam|exams|midterm|midterms|final|tests?)/gi;
  const hwKeywords =
    /(\d+)\s*%\s*(?:for|of|on)?[^.\n]{0,40}?(?:homework|hw|assignments?|problem sets?|labs?)/gi;
  const partKeywords =
    /(\d+)\s*%\s*(?:for|of|on)?[^.\n]{0,40}?(?:participation|discussion|attendance)/i;
  const projKeywords =
    /(\d+)\s*%\s*(?:for|of|on)?[^.\n]{0,40}?(?:project|projects|paper|papers)/i;

  const examMatches = [...text.matchAll(examKeywords)];
  for (const x of examMatches) {
    const v = parseInt(x[1], 10);
    if (!Number.isNaN(v)) examTotal += v;
  }

  const hwMatches = [...text.matchAll(hwKeywords)];
  for (const x of hwMatches) {
    const v = parseInt(x[1], 10);
    if (!Number.isNaN(v)) homeworkTotal += v;
  }

  const pm = lower.match(partKeywords);
  if (pm) participationPct = parseInt(pm[1], 10);
  const jm = lower.match(projKeywords);
  if (jm) projectPct = parseInt(jm[1], 10);

  if (!examMatches.length) {
    const loose = [...text.matchAll(/(\d+)\s*%/g)].map((x) => parseInt(x[1], 10));
    if (loose.length && /exam|midterm|final|test/.test(lower)) {
      examTotal = loose[0];
    }
  }

  const confidence =
    examTotal > 0 || homeworkTotal > 0 ? "medium" : "low";

  let summary = "Could not confidently parse weights — add lines like “Exams 60%”.";
  if (examTotal > 0) {
    summary = `Detected ~${examTotal}% exam-weighted — exam-heavy strategy recommended.`;
    if (examTotal >= 55) summary += " Prioritize timed practice and past tests.";
    else summary += " Balance exams with recurring HW.";
  } else if (homeworkTotal > 0) {
    summary = `Detected ~${homeworkTotal}% homework/assignments — consistency beats cramming.`;
  }

  return {
    examTotal: examTotal || null,
    homeworkTotal: homeworkTotal || null,
    participationPct,
    projectPct,
    confidence,
    summary,
  };
}

function extractKeywords(text) {
  const keywords = [
    'exam', 'test', 'quiz', 'project', 'assignment', 'paper', 'presentation',
    'participation', 'discussion', 'attendance', 'group', 'peer review',
    'midterm', 'final', 'weekly', 'daily', 'rubric', 'grading', 'office hours'
  ];
  
  const found = new Set();
  const lower = text.toLowerCase();
  
  keywords.forEach(kw => {
    if (lower.includes(kw)) found.add(kw);
  });
  
  return Array.from(found);
}
