import cvModule from '@techstark/opencv-js';
import {
  contourAgreement,
  contourCandidateMetrics,
  orderContourCorners,
  polygonArea,
} from './cardContourGeometry.mjs';
import type {
  CardContourDiagnostics,
  CardContourResult,
} from './cardContour';
import type { CenteringCorners, CenteringPoint } from './centering';

interface ContourWorkerRequest {
  id: number;
  pixels: ArrayBuffer;
  width: number;
  height: number;
  guide?: CenteringCorners;
}

interface ContourWorkerResponse {
  id: number;
  result?: CardContourResult | null;
  error?: string;
}

interface CvMat {
  rows: number;
  data32S: Int32Array;
  ucharPtr(row: number, column: number): Uint8Array;
  delete(): void;
}

interface CvMatVector {
  size(): number;
  get(index: number): CvMat;
  delete(): void;
}

interface CvApi {
  Mat: {
    new (...args: unknown[]): CvMat;
    zeros(rows: number, columns: number, type: number): CvMat;
  };
  MatVector: new () => CvMatVector;
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  Scalar: new (...values: number[]) => unknown;
  CV_8UC1: number;
  CV_8UC4: number;
  CV_32SC2: number;
  COLOR_RGBA2GRAY: number;
  RETR_EXTERNAL: number;
  CHAIN_APPROX_SIMPLE: number;
  MORPH_ELLIPSE: number;
  MORPH_CLOSE: number;
  BORDER_DEFAULT: number;
  matFromArray(
    rows: number,
    columns: number,
    type: number,
    data: ArrayLike<number>,
  ): CvMat;
  cvtColor(source: CvMat, destination: CvMat, code: number): void;
  GaussianBlur(
    source: CvMat,
    destination: CvMat,
    size: unknown,
    sigmaX: number,
    sigmaY: number,
    borderType: number,
  ): void;
  Canny(
    source: CvMat,
    destination: CvMat,
    threshold1: number,
    threshold2: number,
  ): void;
  getStructuringElement(shape: number, size: unknown): CvMat;
  morphologyEx(
    source: CvMat,
    destination: CvMat,
    operation: number,
    kernel: CvMat,
  ): void;
  rectangle(
    image: CvMat,
    first: unknown,
    second: unknown,
    color: unknown,
    thickness: number,
  ): void;
  fillConvexPoly(
    image: CvMat,
    points: CvMat,
    color: unknown,
  ): void;
  bitwise_and(
    first: CvMat,
    second: CvMat,
    destination: CvMat,
    mask?: CvMat,
  ): void;
  findContours(
    image: CvMat,
    contours: CvMatVector,
    hierarchy: CvMat,
    mode: number,
    method: number,
  ): void;
  contourArea(contour: CvMat): number;
  arcLength(contour: CvMat, closed: boolean): number;
  convexHull(
    points: CvMat,
    hull: CvMat,
    clockwise?: boolean,
    returnPoints?: boolean,
  ): void;
  approxPolyDP(
    curve: CvMat,
    approximation: CvMat,
    epsilon: number,
    closed: boolean,
  ): void;
  isContourConvex(contour: CvMat): boolean;
}

interface RawCandidate {
  corners: CenteringCorners;
  variant: number;
  sideCoverage: [number, number, number, number];
  aspectScore: number;
  geometryScore: number;
  rectangularity: number;
  guideScore: number;
  guideDistance: number;
  minimumSideCoverage: number;
  meanSideCoverage: number;
  baseScore: number;
}

const workerScope = self as unknown as {
  postMessage(message: ContourWorkerResponse): void;
  onmessage: ((event: MessageEvent<ContourWorkerRequest>) => void) | null;
};

let cvPromise: Promise<CvApi> | undefined;

workerScope.onmessage = async (event) => {
  const { id, pixels, width, height, guide } = event.data;
  try {
    const cv = await getOpenCv();
    const result = detectContour(
      cv,
      new Uint8Array(pixels),
      width,
      height,
      guide,
    );
    workerScope.postMessage({ id, result });
  } catch (error) {
    workerScope.postMessage({
      id,
      error:
        error instanceof Error
          ? error.message
          : 'Local contour analysis failed.',
    });
  }
};

async function getOpenCv(): Promise<CvApi> {
  if (!cvPromise) {
    cvPromise = Promise.resolve(cvModule)
      .then((module) => module as unknown as CvApi)
      .catch((error) => {
        cvPromise = undefined;
        throw error;
      });
  }
  return cvPromise;
}

function detectContour(
  cv: CvApi,
  pixels: Uint8Array,
  width: number,
  height: number,
  guide?: CenteringCorners,
): CardContourResult | null {
  const source = cv.matFromArray(height, width, cv.CV_8UC4, pixels);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const roiMask = createRoiMask(cv, width, height, guide);
  const candidates: RawCandidate[] = [];
  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(
      gray,
      blurred,
      new cv.Size(5, 5),
      0,
      0,
      cv.BORDER_DEFAULT,
    );
    const thresholds = [
      [35, 105],
      [55, 150],
      [80, 210],
    ];
    thresholds.forEach(([low, high], variant) => {
      const edges = new cv.Mat();
      const masked = new cv.Mat();
      const closed = new cv.Mat();
      const kernel = cv.getStructuringElement(
        cv.MORPH_ELLIPSE,
        new cv.Size(5, 5),
      );
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      try {
        cv.Canny(blurred, edges, low, high);
        cv.bitwise_and(edges, roiMask, masked);
        cv.morphologyEx(masked, closed, cv.MORPH_CLOSE, kernel);
        cv.findContours(
          closed,
          contours,
          hierarchy,
          cv.RETR_EXTERNAL,
          cv.CHAIN_APPROX_SIMPLE,
        );
        collectCandidates(
          cv,
          contours,
          closed,
          width,
          height,
          guide,
          variant,
          candidates,
        );
      } finally {
        hierarchy.delete();
        contours.delete();
        kernel.delete();
        closed.delete();
        masked.delete();
        edges.delete();
      }
    });
  } finally {
    roiMask.delete();
    blurred.delete();
    gray.delete();
    source.delete();
  }
  return selectCandidate(candidates);
}

function createRoiMask(
  cv: CvApi,
  width: number,
  height: number,
  guide?: CenteringCorners,
): CvMat {
  const mask = cv.Mat.zeros(height, width, cv.CV_8UC1);
  if (guide) {
    const center = {
      x:
        (guide.topLeft.x +
          guide.topRight.x +
          guide.bottomRight.x +
          guide.bottomLeft.x) /
        4,
      y:
        (guide.topLeft.y +
          guide.topRight.y +
          guide.bottomRight.y +
          guide.bottomLeft.y) /
        4,
    };
    const expanded = [
      guide.topLeft,
      guide.topRight,
      guide.bottomRight,
      guide.bottomLeft,
    ].flatMap((point) => [
      Math.round(
        clamp(center.x + (point.x - center.x) * 1.2, 0, 1) * width,
      ),
      Math.round(
        clamp(center.y + (point.y - center.y) * 1.2, 0, 1) * height,
      ),
    ]);
    const polygon = cv.matFromArray(
      4,
      1,
      cv.CV_32SC2,
      Int32Array.from(expanded),
    );
    try {
      cv.fillConvexPoly(mask, polygon, new cv.Scalar(255));
    } finally {
      polygon.delete();
    }
    return mask;
  }
  const bounds = guide
    ? { left: 0, top: 0, right: 1, bottom: 1 }
    : { left: 0.04, top: 0.04, right: 0.96, bottom: 0.96 };
  const padding = 0;
  cv.rectangle(
    mask,
    new cv.Point(
      Math.max(0, Math.floor((bounds.left - padding) * width)),
      Math.max(0, Math.floor((bounds.top - padding) * height)),
    ),
    new cv.Point(
      Math.min(width - 1, Math.ceil((bounds.right + padding) * width)),
      Math.min(height - 1, Math.ceil((bounds.bottom + padding) * height)),
    ),
    new cv.Scalar(255),
    -1,
  );
  return mask;
}

function collectCandidates(
  cv: CvApi,
  contours: CvMatVector,
  edges: CvMat,
  width: number,
  height: number,
  guide: CenteringCorners | undefined,
  variant: number,
  output: RawCandidate[],
) {
  const imageArea = width * height;
  for (let index = 0; index < contours.size(); index += 1) {
    const contour = contours.get(index);
    const hull = new cv.Mat();
    try {
      const contourArea = cv.contourArea(contour);
      if (contourArea < imageArea * 0.08 || contourArea > imageArea * 0.9) {
        continue;
      }
      cv.convexHull(contour, hull, false, true);
      const perimeter = cv.arcLength(hull, true);
      const approximation = approximateQuad(cv, hull, perimeter);
      if (!approximation) continue;
      try {
        if (!cv.isContourConvex(approximation)) continue;
        const points = pointsFromMat(approximation);
        let corners: CenteringCorners;
        try {
          corners = orderContourCorners(points, width, height);
        } catch {
          continue;
        }
        const area = polygonArea(corners);
        if (area < 0.08 || area > 0.9) continue;
        const sideCoverage = measureSideCoverage(
          edges,
          corners,
          width,
          height,
        );
        const metrics = contourCandidateMetrics(
          corners,
          guide,
          sideCoverage,
          width,
          height,
        );
        const rectangularity = Math.min(
          1,
          contourArea / Math.max(1, area * imageArea),
        );
        if (
          metrics.minimumSideCoverage < 0.22 ||
          metrics.aspectScore < 0.35 ||
          metrics.geometryScore < 0.42 ||
          rectangularity < 0.58 ||
          (guide && metrics.guideDistance > 0.11)
        ) {
          continue;
        }
        const baseScore =
          metrics.minimumSideCoverage * 0.3 +
          metrics.meanSideCoverage * 0.18 +
          metrics.aspectScore * 0.16 +
          metrics.geometryScore * 0.16 +
          rectangularity * 0.2;
        output.push({
          corners,
          variant,
          sideCoverage,
          rectangularity,
          baseScore,
          ...metrics,
        });
      } finally {
        approximation.delete();
      }
    } finally {
      hull.delete();
      contour.delete();
    }
  }
}

function approximateQuad(
  cv: CvApi,
  hull: CvMat,
  perimeter: number,
): CvMat | null {
  for (const fraction of [0.012, 0.02, 0.03, 0.045, 0.06]) {
    const approximation = new cv.Mat();
    cv.approxPolyDP(hull, approximation, perimeter * fraction, true);
    if (approximation.rows === 4) return approximation;
    approximation.delete();
  }
  return null;
}

function pointsFromMat(contour: CvMat): CenteringPoint[] {
  const points: CenteringPoint[] = [];
  for (let index = 0; index < contour.data32S.length; index += 2) {
    points.push({
      x: contour.data32S[index],
      y: contour.data32S[index + 1],
    });
  }
  return points;
}

function measureSideCoverage(
  edges: CvMat,
  corners: CenteringCorners,
  width: number,
  height: number,
): [number, number, number, number] {
  return [
    edgeCoverage(edges, corners.topLeft, corners.topRight, width, height),
    edgeCoverage(edges, corners.topRight, corners.bottomRight, width, height),
    edgeCoverage(edges, corners.bottomRight, corners.bottomLeft, width, height),
    edgeCoverage(edges, corners.bottomLeft, corners.topLeft, width, height),
  ];
}

function edgeCoverage(
  edges: CvMat,
  start: CenteringPoint,
  end: CenteringPoint,
  width: number,
  height: number,
): number {
  const samples = 48;
  let supported = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const fraction = (sample + 0.5) / samples;
    const x = Math.round((start.x + (end.x - start.x) * fraction) * width);
    const y = Math.round((start.y + (end.y - start.y) * fraction) * height);
    let found = false;
    for (let offsetY = -2; offsetY <= 2 && !found; offsetY += 1) {
      const row = y + offsetY;
      if (row < 0 || row >= height) continue;
      for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
        const column = x + offsetX;
        if (column < 0 || column >= width) continue;
        if (edges.ucharPtr(row, column)[0] > 0) {
          found = true;
          break;
        }
      }
    }
    if (found) supported += 1;
  }
  return supported / samples;
}

function selectCandidate(candidates: RawCandidate[]): CardContourResult | null {
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((candidate) => {
      const peers = candidates.filter(
        (other) => other.variant !== candidate.variant,
      );
      const peerVariants = [...new Set(peers.map((peer) => peer.variant))];
      const agreementByVariant = peerVariants.map((variant) =>
        Math.max(
          ...peers
            .filter((peer) => peer.variant === variant)
            .map((peer) =>
              contourAgreement(candidate.corners, [peer.corners]),
            ),
        ),
      );
      const agreementScore =
        agreementByVariant.length > 0
          ? agreementByVariant.reduce((sum, value) => sum + value, 0) /
            agreementByVariant.length
          : 0;
      const variantCount =
        1 +
        agreementByVariant.filter((agreement) => agreement >= 0.45).length;
      return {
        ...candidate,
        agreementScore,
        variantCount,
        score: candidate.baseScore * 0.78 + agreementScore * 0.22,
      };
    })
    .sort((first, second) => second.score - first.score);
  const best = ranked[0];
  const strongestPeerAgreement = Math.max(
    0,
    ...candidates
      .filter((candidate) => candidate.variant !== best.variant)
      .map((candidate) =>
        contourAgreement(best.corners, [candidate.corners]),
      ),
  );
  if (
    best.variantCount < 2 ||
    strongestPeerAgreement < 0.45 ||
    best.minimumSideCoverage < 0.3 ||
    best.score < 0.52
  ) {
    return null;
  }
  const diagnostics: CardContourDiagnostics = {
    score: best.score,
    sideCoverage: best.sideCoverage,
    minimumSideCoverage: best.minimumSideCoverage,
    meanSideCoverage: best.meanSideCoverage,
    aspectScore: best.aspectScore,
    geometryScore: best.geometryScore,
    rectangularity: best.rectangularity,
    guideScore: best.guideScore,
    guideDistance: best.guideDistance,
    agreementScore: best.agreementScore,
    variantCount: best.variantCount,
  };
  return { corners: best.corners, diagnostics };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
