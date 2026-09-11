import { Capture } from '../domain/capture';
import {
  CONDITION_CATEGORIES,
  GradeEvidence,
  Grader,
  GraderPrediction,
  GradingResult,
} from '../domain/grading';

const DEMO_GRADES: Record<Grader, { minimum: number; maximum: number; likely: number }> =
  {
    psa: { minimum: 8, maximum: 9, likely: 9 },
    bgs: { minimum: 8, maximum: 9, likely: 8.5 },
    cgc: { minimum: 8, maximum: 9, likely: 8.5 },
  };

export function createDemoResult(captures: Capture[]): GradingResult {
  const frontCapture = captures.find(
    (capture) => capture.viewId === 'front-straight',
  );
  const backCapture = captures.find(
    (capture) => capture.viewId === 'back-straight',
  );

  if (!frontCapture || !backCapture) {
    throw new Error('The demo result requires front and back captures.');
  }

  const evidence: GradeEvidence[] = [
    {
      id: 'demo-centering',
      kind: 'measurement',
      category: 'centering',
      captureId: frontCapture.id,
      description: 'Example centering measurement region.',
      confidence: 0.88,
      region: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
    },
    {
      id: 'demo-corner',
      kind: 'visible-defect',
      category: 'corners',
      captureId: backCapture.id,
      description: 'Example corner evidence region.',
      confidence: 0.72,
      region: { x: 0.72, y: 0.72, width: 0.2, height: 0.2 },
    },
    {
      id: 'demo-surface',
      kind: 'obscured-region',
      category: 'surface',
      captureId: frontCapture.id,
      description: 'Example uncertain surface region.',
      confidence: 0.44,
      region: { x: 0.24, y: 0.36, width: 0.5, height: 0.18 },
    },
  ];

  const predictions = (Object.keys(DEMO_GRADES) as Grader[]).map(
    (grader): GraderPrediction => {
      const grades = DEMO_GRADES[grader];

      return {
        grader,
        range: {
          minimum: grades.minimum,
          maximum: grades.maximum,
          mostLikely: grades.likely,
        },
        confidence: 0.68,
        profileVersion: 'demo-only',
        categories: CONDITION_CATEGORIES.map((category, index) => ({
          category,
          score: category === 'surface' ? null : 9 - index * 0.5,
          confidence: category === 'surface' ? 0.44 : 0.82 - index * 0.05,
          evidenceIds: evidence
            .filter((item) => item.category === category)
            .map((item) => item.id),
        })),
        evidence,
        limitations: [
          'This is synthetic preview data and is not based on the captured card.',
          'The example surface region is intentionally marked unable to assess.',
        ],
      };
    },
  );

  return {
    scanId: 'demo-scan',
    source: 'demo',
    modelVersion: 'demo-only',
    preprocessingVersion: 'demo-only',
    createdAt: new Date().toISOString(),
    predictions,
    unofficial: true,
  };
}
