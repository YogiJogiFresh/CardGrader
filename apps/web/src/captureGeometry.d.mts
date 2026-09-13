import type { CenteringCorners, CenteringPoint } from './centering';

export interface PixelRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GuideCrop extends PixelRectangle {
  guideCorners: CenteringCorners;
}

export function computeVisibleSourceRect(
  sourceWidth: number,
  sourceHeight: number,
  viewportAspectRatio?: number,
): PixelRectangle;

export function computeSymmetricGuideCrop(
  sourceWidth: number,
  sourceHeight: number,
  guideCorners: CenteringCorners,
  paddingFraction?: number,
): GuideCrop;

export function constrainPointToGuide(
  guide: CenteringPoint,
  detected: CenteringPoint,
  strength: number,
  maximumShift: number,
): CenteringPoint;

export function computeCornerAgreement(
  candidate: CenteringCorners,
  peers: CenteringCorners[],
  tolerance?: number,
): number;

export function validateGuideCorners(corners: CenteringCorners): void;
