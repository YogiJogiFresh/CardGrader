import {
  CONDITION_CATEGORIES,
  ConditionCategory,
  Grader,
  GraderPrediction,
} from './grading';

const CATEGORY_LABELS: Record<ConditionCategory, string> = {
  centering: 'Centering',
  corners: 'Corners',
  edges: 'Edges',
  surface: 'Surface',
};

const GRADER_LABELS: Record<Grader, string> = {
  psa: 'PSA',
  bgs: 'BGS',
  cgc: 'CGC',
};

export interface PredictionExplanation {
  graderLabel: string;
  confidenceLabel: 'Low confidence' | 'Moderate confidence' | 'High confidence';
  summary: string;
  categoryLines: string[];
}

export function buildPredictionExplanation(
  prediction: GraderPrediction,
): PredictionExplanation {
  const scoredCategories = prediction.categories.filter(
    (assessment) => assessment.score !== null,
  );
  const weakest = [...scoredCategories].sort(
    (left, right) => (left.score ?? 10) - (right.score ?? 10),
  )[0];
  const missing = CONDITION_CATEGORIES.filter(
    (category) =>
      !prediction.categories.some(
        (assessment) =>
          assessment.category === category && assessment.score !== null,
      ),
  );

  let summary = `The likely range is ${formatGrade(prediction.range.minimum)}-${formatGrade(
    prediction.range.maximum,
  )}, with ${formatGrade(prediction.range.mostLikely)} currently most likely.`;

  if (weakest) {
    summary += ` ${CATEGORY_LABELS[weakest.category]} is the strongest visible limit on the estimate.`;
  }

  if (missing.length > 0) {
    summary += ` ${missing.map((category) => CATEGORY_LABELS[category]).join(
      ', ',
    )} could not be fully assessed.`;
  }

  return {
    graderLabel: GRADER_LABELS[prediction.grader],
    confidenceLabel: confidenceLabel(prediction.confidence),
    summary,
    categoryLines: prediction.categories.map((assessment) => {
      const label = CATEGORY_LABELS[assessment.category];
      const score =
        assessment.score === null
          ? 'Unable to assess'
          : formatGrade(assessment.score);
      return `${label}: ${score} (${Math.round(
        assessment.confidence * 100,
      )}% evidence confidence)`;
    }),
  };
}

export function confidenceLabel(
  confidence: number,
): PredictionExplanation['confidenceLabel'] {
  if (confidence >= 0.8) {
    return 'High confidence';
  }

  if (confidence >= 0.6) {
    return 'Moderate confidence';
  }

  return 'Low confidence';
}

export function formatGrade(grade: number): string {
  return Number.isInteger(grade) ? grade.toFixed(0) : grade.toFixed(1);
}
