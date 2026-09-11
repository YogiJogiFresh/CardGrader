import type {
  BlemishAnnotation,
  PercentagePair,
  QualityCheck,
} from './inspection';

export type ComparisonGrader = 'psa' | 'tag' | 'cgc' | 'beckett';

export interface GradeEvidenceSide {
  horizontal: PercentagePair;
  vertical: PercentagePair;
  annotations: BlemishAnnotation[];
  qualityChecks: QualityCheck[];
}

export interface GradeEstimate {
  grader: ComparisonGrader;
  graderLabel: string;
  minimum: number;
  maximum: number;
  mostLikely: number;
  confidence: number;
  centeringMaximum: number;
  categoryMaximums: {
    corners: number;
    edges: number;
    surface: number;
  };
  limitingFactors: string[];
  evidenceGaps: string[];
  sourceUrl: string;
  methodologyNote: string;
}

interface CenteringThreshold {
  grade: number;
  front: number;
  back: number;
}

interface GraderProfile {
  label: string;
  increment: number;
  sourceUrl: string;
  thresholds: CenteringThreshold[];
  blemishCaps: Record<BlemishAnnotation['type'], number>;
  methodologyNote: string;
}

const PROFILES: Record<ComparisonGrader, GraderProfile> = {
  psa: {
    label: 'PSA',
    increment: 1,
    sourceUrl: 'https://www.psacard.com/gradingstandards#cards',
    thresholds: [
      { grade: 10, front: 55, back: 75 },
      { grade: 9, front: 60, back: 90 },
      { grade: 8, front: 65, back: 90 },
      { grade: 7, front: 70, back: 90 },
      { grade: 6, front: 80, back: 90 },
      { grade: 5, front: 85, back: 95 },
      { grade: 3, front: 90, back: 100 },
      { grade: 1, front: 100, back: 100 },
    ],
    blemishCaps: {
      scratch: 9,
      whitening: 9,
      dent: 7,
      stain: 5,
      'print-line': 9,
      other: 8,
    },
    methodologyNote:
      'Uses PSA-style whole-number ranges and published centering tolerances. PSA grades holistically, so this comparison cannot reproduce an official grade.',
  },
  tag: {
    label: 'TAG',
    increment: 0.5,
    sourceUrl: 'https://taggrading.com/pages/rubric',
    thresholds: [
      { grade: 10, front: 55, back: 65 },
      { grade: 9, front: 60, back: 75 },
      { grade: 8.5, front: 62.5, back: 85 },
      { grade: 8, front: 65, back: 95 },
      { grade: 7.5, front: 67.5, back: 100 },
      { grade: 7, front: 70, back: 100 },
      { grade: 6.5, front: 72.5, back: 100 },
      { grade: 6, front: 75, back: 100 },
      { grade: 1, front: 100, back: 100 },
    ],
    blemishCaps: {
      scratch: 9,
      whitening: 9,
      dent: 7.5,
      stain: 6.5,
      'print-line': 9,
      other: 8,
    },
    methodologyNote:
      'Compares against TAG’s published TCG rubric bands. It does not reproduce TAG imaging, DINGS, region weighting, Pristine determination, or the proprietary 1,000-point score.',
  },
  cgc: {
    label: 'CGC',
    increment: 0.5,
    sourceUrl: 'https://www.cgccards.com/card-grading/grading-scale/',
    thresholds: [
      { grade: 10, front: 55, back: 75 },
      { grade: 9, front: 60, back: 90 },
      { grade: 8, front: 65, back: 95 },
      { grade: 7, front: 70, back: 100 },
      { grade: 6, front: 75, back: 100 },
      { grade: 4.5, front: 85, back: 100 },
      { grade: 1, front: 100, back: 100 },
    ],
    blemishCaps: {
      scratch: 9,
      whitening: 9,
      dent: 7.5,
      stain: 6,
      'print-line': 9,
      other: 8,
    },
    methodologyNote:
      'Uses CGC’s published condition descriptions and high-grade centering limits. It cannot distinguish Gem Mint from Pristine without magnified physical inspection.',
  },
  beckett: {
    label: 'Beckett / BGS',
    increment: 0.5,
    sourceUrl: 'https://www.beckett.com/grading/scale',
    thresholds: [
      { grade: 10, front: 50.5, back: 60 },
      { grade: 9.5, front: 55, back: 60 },
      { grade: 9, front: 55, back: 70 },
      { grade: 8, front: 60, back: 80 },
      { grade: 7, front: 65, back: 90 },
      { grade: 6, front: 70, back: 95 },
      { grade: 5, front: 75, back: 100 },
      { grade: 4, front: 80, back: 100 },
      { grade: 1, front: 100, back: 100 },
    ],
    blemishCaps: {
      scratch: 9,
      whitening: 9,
      dent: 7.5,
      stain: 6,
      'print-line': 9,
      other: 8,
    },
    methodologyNote:
      'Produces a BGS-style comparison using centering, corners, edges, and surface ceilings. It is not an official subgrade calculation or Black Label determination.',
  },
};

export function estimateGrade(
  grader: ComparisonGrader,
  front: GradeEvidenceSide,
  back: GradeEvidenceSide,
): GradeEstimate {
  const profile = PROFILES[grader];
  const frontRatio = worstRatio(front);
  const backRatio = worstRatio(back);
  const centeringMaximum =
    profile.thresholds.find(
      (threshold) =>
        frontRatio <= threshold.front && backRatio <= threshold.back,
    )?.grade ?? 1;
  const annotations = [...front.annotations, ...back.annotations];
  const categoryMaximums = blemishCategoryMaximums(
    annotations,
    profile,
  );
  const maximum = quantize(
    Math.min(
      centeringMaximum,
      categoryMaximums.corners,
      categoryMaximums.edges,
      categoryMaximums.surface,
    ),
    profile.increment,
  );
  const qualityChecks = [...front.qualityChecks, ...back.qualityChecks];
  const qualityErrors = qualityChecks.filter(
    (check) => check.severity === 'error',
  ).length;
  const qualityWarnings = qualityChecks.filter(
    (check) => check.severity === 'warning',
  ).length;
  const uncertainty =
    (annotations.length === 0 ? 2 : 1) +
    Math.min(1.5, qualityErrors * 0.5 + qualityWarnings * 0.25);
  const minimum = quantizeDown(
    Math.max(1, maximum - uncertainty),
    profile.increment,
  );
  const mostLikely = quantize(
    Math.max(minimum, maximum - profile.increment),
    profile.increment,
  );
  const confidence = clamp(
    0.68 -
      (annotations.length === 0 ? 0.12 : 0) -
      qualityErrors * 0.1 -
      qualityWarnings * 0.04,
    0.2,
    0.7,
  );
  const limitingFactors = buildLimitingFactors(
    centeringMaximum,
    categoryMaximums,
    annotations,
    frontRatio,
    backRatio,
  );
  const evidenceGaps = [
    'Manual markers do not record defect severity, depth, length, or whether a flaw penetrates the gloss.',
    'Photos cannot reliably establish microscopic wear, card stock alteration, trimming, restoration, or authenticity.',
  ];

  if (annotations.length === 0) {
    evidenceGaps.unshift(
      'No blemishes were marked; this means no defects were reported, not that the card is flawless.',
    );
  }
  if (qualityErrors > 0 || qualityWarnings > 0) {
    evidenceGaps.push(
      'Image-quality warnings widen the range because glare, blur, exposure, or cropping may hide defects.',
    );
  }

  return {
    grader,
    graderLabel: profile.label,
    minimum,
    maximum,
    mostLikely,
    confidence,
    centeringMaximum,
    categoryMaximums,
    limitingFactors,
    evidenceGaps,
    sourceUrl: profile.sourceUrl,
    methodologyNote: profile.methodologyNote,
  };
}

export function graderLabel(grader: ComparisonGrader): string {
  return PROFILES[grader].label;
}

export function graderRubricUrl(grader: ComparisonGrader): string {
  return PROFILES[grader].sourceUrl;
}

function blemishCategoryMaximums(
  annotations: BlemishAnnotation[],
  profile: GraderProfile,
) {
  const grouped = {
    corners: [] as BlemishAnnotation[],
    edges: [] as BlemishAnnotation[],
    surface: [] as BlemishAnnotation[],
  };

  annotations.forEach((annotation) => {
    grouped[annotationCategory(annotation)].push(annotation);
  });

  return {
    corners: categoryMaximum(grouped.corners, profile),
    edges: categoryMaximum(grouped.edges, profile),
    surface: categoryMaximum(grouped.surface, profile),
  };
}

function categoryMaximum(
  annotations: BlemishAnnotation[],
  profile: GraderProfile,
): number {
  if (annotations.length === 0) {
    return 10;
  }

  const base = Math.min(
    ...annotations.map((annotation) => profile.blemishCaps[annotation.type]),
  );
  const repetitionPenalty =
    annotations.length <= 1 ? 0 : Math.min(2, (annotations.length - 1) * 0.5);
  return quantizeDown(Math.max(1, base - repetitionPenalty), profile.increment);
}

function annotationCategory(
  annotation: BlemishAnnotation,
): keyof GradeEstimate['categoryMaximums'] {
  const nearHorizontalEdge = annotation.x <= 0.15 || annotation.x >= 0.85;
  const nearVerticalEdge = annotation.y <= 0.15 || annotation.y >= 0.85;
  const nearCorner = nearHorizontalEdge && nearVerticalEdge;

  if (
    nearCorner &&
    (annotation.type === 'whitening' ||
      annotation.type === 'dent' ||
      annotation.type === 'other')
  ) {
    return 'corners';
  }
  if (
    annotation.type === 'whitening' ||
    (nearHorizontalEdge && annotation.type === 'other') ||
    (nearVerticalEdge && annotation.type === 'other')
  ) {
    return 'edges';
  }
  return 'surface';
}

function buildLimitingFactors(
  centeringMaximum: number,
  categories: GradeEstimate['categoryMaximums'],
  annotations: BlemishAnnotation[],
  frontRatio: number,
  backRatio: number,
): string[] {
  const factors = [
    `Worst measured centering is ${formatRatio(frontRatio)} front and ${formatRatio(backRatio)} back, limiting the centering comparison to ${formatGrade(centeringMaximum)}.`,
  ];

  if (annotations.length > 0) {
    factors.push(
      `${annotations.length} manually marked blemish${annotations.length === 1 ? '' : 'es'} limit corners to ${formatGrade(categories.corners)}, edges to ${formatGrade(categories.edges)}, and surface to ${formatGrade(categories.surface)}.`,
    );
  } else {
    factors.push(
      'No manual blemishes currently reduce the estimate, but unmarked defects may still be present.',
    );
  }

  return factors;
}

function worstRatio(side: GradeEvidenceSide): number {
  return Math.max(
    side.horizontal.first,
    side.horizontal.second,
    side.vertical.first,
    side.vertical.second,
  );
}

function formatRatio(value: number): string {
  return `${value.toFixed(1)}/${(100 - value).toFixed(1)}`;
}

function formatGrade(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function quantize(value: number, increment: number): number {
  return Math.round(value / increment) * increment;
}

function quantizeDown(value: number, increment: number): number {
  return Math.floor(value / increment) * increment;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
