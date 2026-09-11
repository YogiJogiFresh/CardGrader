import { CaptureViewId } from '../domain/capture';

export const MODEL_MANIFEST_SCHEMA_VERSION = 1;

export interface ModelManifest {
  schemaVersion: typeof MODEL_MANIFEST_SCHEMA_VERSION;
  modelVersion: string;
  preprocessingVersion: string;
  gradingProfileVersion: string;
  input: {
    width: number;
    height: number;
    colorSpace: 'RGB';
    layout: 'NCHW' | 'NHWC';
    requiredViews: CaptureViewId[];
  };
  outputs: {
    gradeDistribution: string;
    categoryScores: string;
    evidence: string;
  };
}

export function assertCompatibleManifest(
  manifest: ModelManifest,
  expectedPreprocessingVersion: string,
): void {
  if (manifest.schemaVersion !== MODEL_MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported model manifest schema: ${manifest.schemaVersion}.`,
    );
  }

  if (manifest.preprocessingVersion !== expectedPreprocessingVersion) {
    throw new Error(
      `Model preprocessing ${manifest.preprocessingVersion} does not match app preprocessing ${expectedPreprocessingVersion}.`,
    );
  }
}
