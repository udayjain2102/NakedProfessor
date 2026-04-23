/**
 * Derive teaching profile parameters from professor CSV data
 * All calculations are client-side with no LLM calls
 */

export function deriveProfile(professor) {
  const rating = parseFloat(professor.avg_rating) || null;
  const difficulty = parseFloat(professor.avg_difficulty) || null;
  const wta = parseFloat(professor.would_take_again_percent) || null;

  return {
    clarity: rating !== null
      ? rating >= 4.2 ? 'high' : rating >= 3.2 ? 'medium' : 'low'
      : 'unknown',
    workload: difficulty !== null
      ? difficulty >= 3.8 ? 'high' : difficulty >= 2.8 ? 'medium' : 'low'
      : 'unknown',
    support: wta !== null
      ? wta >= 70 ? 'high' : wta >= 40 ? 'medium' : 'low'
      : 'unknown',
    assessment: (difficulty !== null && rating !== null)
      ? (difficulty >= 3.8 && rating < 3.2) ? 'unpredictable'
        : difficulty <= 2.5 ? 'lenient' : 'balanced'
      : 'unknown',
    sentiment: rating !== null
      ? rating >= 4.0 ? 'high' : rating >= 2.8 ? 'medium' : 'low'
      : 'unknown',
    reliability: parseInt(professor.num_ratings) >= 20 ? 'solid'
      : parseInt(professor.num_ratings) >= 5 ? 'limited' : 'sparse'
  };
}

export function buildTensions(profile, professorName) {
  const tensions = [];

  if (profile.clarity === 'low') {
    tensions.push({
      level: 'high',
      text: `${professorName} rated low on clarity — supplement every lecture with outside resources before the next class.`
    });
  }

  if (profile.workload === 'high') {
    tensions.push({
      level: 'medium',
      text: 'Heavy workload detected — block 3+ hrs per week beyond class time from day one.'
    });
  }

  if (profile.support === 'low') {
    tensions.push({
      level: 'high',
      text: 'Low support accessibility — go to office hours in week 1, not week 8.'
    });
  }

  if (profile.assessment === 'unpredictable') {
    tensions.push({
      level: 'high',
      text: `Assessments trend difficult without matching clarity — build your own checkpoints and don't rely on rubrics alone.`
    });
  }

  if (profile.reliability === 'sparse') {
    tensions.push({
      level: 'medium',
      text: 'Fewer than 5 reviews — treat these signals as directional, not definitive.'
    });
  }

  if (!tensions.length) {
    tensions.push({
      level: 'low',
      text: 'No major risk flags from the data. Stay consistent and you should be fine.'
    });
  }

  return tensions;
}

export const levelScore = {
  low: 1,
  medium: 3,
  high: 5,
  unknown: 0,
  lenient: 1,
  balanced: 3,
  unpredictable: 5,
  solid: 5,
  limited: 3,
  sparse: 1
};

export const levelLabel = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  unknown: 'Unknown',
  lenient: 'Lenient',
  balanced: 'Balanced',
  unpredictable: 'Unpredictable',
  solid: 'Solid',
  limited: 'Limited',
  sparse: 'Sparse'
};
