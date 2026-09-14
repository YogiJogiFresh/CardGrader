import type { CenteringCorners, CenteringPoint } from './centering';

export interface ContourCandidateMetrics {
  aspectScore: number;
  geometryScore: number;
  guideDistance: number;
  guideScore: number;
  minimumSideCoverage: number;
  meanSideCoverage: number;
}

export function orderContourCorners(
  points: CenteringPoint[],
  width: number,
  height: number,
): CenteringCorners;

export function contourCandidateMetrics(
  corners: CenteringCorners,
  guide: CenteringCorners | undefined,
  sideCoverage: number[],
  width: number,
  height: number,
): ContourCandidateMetrics;

export function contourAgreement(
  candidate: CenteringCorners,
  peers: CenteringCorners[],
  tolerance?: number,
): number;

export function polygonArea(corners: CenteringCorners): number;
export function isConvexQuad(corners: CenteringCorners): boolean;
