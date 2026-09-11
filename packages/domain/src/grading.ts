export const GRADERS = ['psa', 'bgs', 'cgc'] as const;
export type Grader = (typeof GRADERS)[number];

export const CONDITION_CATEGORIES = [
  'centering',
  'corners',
  'edges',
  'surface',
] as const;
export type ConditionCategory = (typeof CONDITION_CATEGORIES)[number];

export type EvidenceKind =
  | 'measurement'
  | 'visible-defect'
  | 'obscured-region'
  | 'capture-quality';

export interface NormalizedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GradeEvidence {
  id: string;
  kind: EvidenceKind;
  category: ConditionCategory;
  captureId: string;
  description: string;
  confidence: number;
  region?: NormalizedRegion;
}

export interface CategoryAssessment {
  category: ConditionCategory;
  score: number | null;
  confidence: number;
  evidenceIds: string[];
}

export interface GradeRange {
  minimum: number;
  maximum: number;
  mostLikely: number;
}

export interface GraderPrediction {
  grader: Grader;
  range: GradeRange;
  confidence: number;
  categories: CategoryAssessment[];
  evidence: GradeEvidence[];
  limitations: string[];
  profileVersion: string;
}

export interface GradingResult {
  scanId: string;
  source: 'model' | 'demo';
  modelVersion: string;
  preprocessingVersion: string;
  createdAt: string;
  predictions: GraderPrediction[];
  unofficial: true;
}

export interface InsufficientEvidenceResult {
  scanId: string;
  source: 'model';
  status: 'insufficient-evidence';
  createdAt: string;
  reasons: string[];
  recommendedRetakes: string[];
}

export type AnalysisResult =
  | {
      status: 'ready';
      result: GradingResult;
    }
  | InsufficientEvidenceResult;
