import { Capture } from '@cardgrader/domain';

const MAX_ANALYSIS_DIMENSION = 1000;
const CARD_ASPECT = 2.5 / 3.5;
const RECTIFIED_WIDTH = 280;
const RECTIFIED_HEIGHT = 392;
const SCAN_COUNT = 24;

export interface CenteringPoint {
  x: number;
  y: number;
}

export interface CenteringCorners {
  topLeft: CenteringPoint;
  topRight: CenteringPoint;
  bottomRight: CenteringPoint;
  bottomLeft: CenteringPoint;
}

export interface CenteringBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CenteringAnalysisOptions {
  expectedOuterBounds?: CenteringBounds;
}

export interface CenteringMeasurement {
  captureId: string;
  viewId: Capture['viewId'];
  method: 'automatic' | 'manual';
  frameType: 'bordered' | 'borderless-or-full-art' | 'uncertain';
  outerBounds: CenteringBounds;
  innerBounds: CenteringBounds;
  outerCorners?: CenteringCorners;
  innerCorners?: CenteringCorners;
  horizontal: {
    leftPercent: number;
    rightPercent: number;
  };
  vertical: {
    topPercent: number;
    bottomPercent: number;
  };
  confidence: number;
  warnings: string[];
  diagnostics?: {
    candidateScore: number;
    edgeSupport: number;
    aspectScore: number;
    guideScore: number;
    geometryScore: number;
    innerFrameSupport: number;
    guideReferenced: boolean;
  };
}

interface PixelChannels {
  luminance: Float32Array;
  red: Uint8Array;
  green: Uint8Array;
  blue: Uint8Array;
}

interface EdgeMaps {
  x: Float32Array;
  y: Float32Array;
}

interface EdgePoint {
  x: number;
  y: number;
  weight: number;
}

interface FittedLine {
  slope: number;
  intercept: number;
  support: number;
}

interface OuterCandidate {
  corners: CenteringCorners;
  score: number;
  edgeSupport: number;
  aspectScore: number;
  guideScore: number;
  geometryScore: number;
  guideDistance: number;
  guidedSearch: boolean;
}

interface InnerFrameDetection {
  left: number;
  top: number;
  right: number;
  bottom: number;
  support: number;
  frameType: CenteringMeasurement['frameType'];
}

export function createManualCenteringMeasurement(
  capture: Capture,
  outerBounds = defaultManualOuterBounds(capture),
): CenteringMeasurement {
  const innerBounds = insetBounds(outerBounds, 0.08);
  return {
    captureId: capture.id,
    viewId: capture.viewId,
    method: 'manual',
    frameType: 'uncertain',
    outerBounds,
    innerBounds,
    outerCorners: cornersFromBounds(outerBounds),
    innerCorners: cornersFromBounds(innerBounds),
    horizontal: { leftPercent: 50, rightPercent: 50 },
    vertical: { topPercent: 50, bottomPercent: 50 },
    confidence: 0,
    warnings: [
      'Automatic edge detection was skipped. Set every cyan corner to the card edge and every yellow corner to the inner frame before relying on the estimate.',
    ],
  };
}

export async function analyzeCentering(
  capture: Capture,
  options: CenteringAnalysisOptions = {},
): Promise<CenteringMeasurement> {
  const image = await loadImage(capture.uri);
  const scale = Math.min(
    1,
    MAX_ANALYSIS_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('This browser cannot analyze image pixels.');
  }

  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const channels = createChannels(pixels, width, height);
  const expectedBounds =
    options.expectedOuterBounds ?? defaultManualOuterBounds(capture);
  const expectedCorners = cornersFromBounds(expectedBounds);
  const variants = createEdgeVariants(channels, width, height);
  const hasCaptureGuide = Boolean(options.expectedOuterBounds);
  const guidedCandidates = hasCaptureGuide
    ? variants
        .map((edges) =>
          detectOuterCandidate(
            edges,
            width,
            height,
            expectedBounds,
            expectedCorners,
            true,
            true,
          ),
        )
        .filter((candidate): candidate is OuterCandidate => candidate !== null)
        .filter(
          (candidate) =>
            candidate.guideDistance <= 0.1 &&
            candidate.edgeSupport >= 0.38 &&
            candidate.aspectScore >= 0.5 &&
            candidate.geometryScore >= 0.42,
        )
    : [];
  const broadCandidates = variants
    .map((edges) =>
      detectOuterCandidate(
        edges,
        width,
        height,
        expectedBounds,
        expectedCorners,
        false,
        hasCaptureGuide,
      ),
    )
    .filter((candidate): candidate is OuterCandidate => candidate !== null)
    .filter(
      (candidate) =>
        candidate.edgeSupport >= 0.4 &&
        candidate.aspectScore >= 0.45 &&
        candidate.geometryScore >= 0.42,
    );
  const candidates = (
    guidedCandidates.length > 0 ? guidedCandidates : broadCandidates
  ).sort((first, second) => second.score - first.score);
  const outer = candidates[0];

  if (!outer || outer.score < (hasCaptureGuide ? 0.42 : 0.36)) {
    throw new Error(
      'The card edges could not be separated from the background. Continue with manual overlays or retake the picture with more visible background contrast.',
    );
  }

  const rectified = rectifyChannels(channels, width, height, outer.corners);
  const inner = detectInnerFrame(
    createCombinedEdges(rectified, RECTIFIED_WIDTH, RECTIFIED_HEIGHT),
    RECTIFIED_WIDTH,
    RECTIFIED_HEIGHT,
  );
  const innerCorners = mapRectifiedFrameToSource(outer.corners, inner);
  const horizontal = percentages(inner.left, 1 - inner.right);
  const vertical = percentages(inner.top, 1 - inner.bottom);
  const warnings: string[] = [];

  if (outer.score < 0.58) {
    warnings.push(
      'Outer-edge confidence is limited. Confirm that every cyan corner follows the physical card edge.',
    );
  }
  if (hasCaptureGuide && !outer.guidedSearch) {
    warnings.push(
      'A reliable edge was not found close to the camera guide. A wider search was used, so verify the cyan overlay carefully.',
    );
  }
  if (hasCaptureGuide && outer.guideScore < 0.62) {
    warnings.push(
      'The detected card edge differs from the camera framing guide. Automatic confidence has been reduced.',
    );
  }
  if (outer.geometryScore < 0.68) {
    warnings.push(
      'The detected quadrilateral has inconsistent opposite edges. Confirm all four cyan corners.',
    );
  }
  if (inner.frameType === 'borderless-or-full-art') {
    warnings.push(
      'No consistent inner border was found. This may be a borderless or full-art card; the yellow guide is only a starting position and should be set manually.',
    );
  } else if (inner.frameType === 'uncertain') {
    warnings.push(
      'The inner frame is inconsistent across scan lines. Verify all four yellow corners before using the percentages.',
    );
  }

  const independentReliability = clamp(
    outer.edgeSupport * 0.5 +
      outer.aspectScore * 0.22 +
      outer.geometryScore * 0.28,
    0,
    1,
  );
  const guidePenalty = hasCaptureGuide
    ? 0.45 + outer.guideScore * 0.55
    : 1;
  const outerReliability = independentReliability * guidePenalty;
  const confidenceBeforeCalibration = clamp(
    Math.min(
      outerReliability,
      outerReliability * 0.76 + inner.support * 0.24,
    ),
    0,
    1,
  );
  const confidence = clamp(
    confidenceBeforeCalibration ** 1.35 *
      0.92 *
      (outer.guidedSearch || !hasCaptureGuide ? 1 : 0.82),
    0,
    0.92,
  );
  return {
    captureId: capture.id,
    viewId: capture.viewId,
    method: 'automatic',
    frameType: inner.frameType,
    outerBounds: boundsFromCorners(outer.corners),
    innerBounds: boundsFromCorners(innerCorners),
    outerCorners: outer.corners,
    innerCorners,
    horizontal: {
      leftPercent: horizontal.first,
      rightPercent: horizontal.second,
    },
    vertical: {
      topPercent: vertical.first,
      bottomPercent: vertical.second,
    },
    confidence,
    warnings,
    diagnostics: {
      candidateScore: outer.score,
      edgeSupport: outer.edgeSupport,
      aspectScore: outer.aspectScore,
      guideScore: outer.guideScore,
      geometryScore: outer.geometryScore,
      innerFrameSupport: inner.support,
      guideReferenced: hasCaptureGuide,
    },
  };
}

function createChannels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): PixelChannels {
  const length = width * height;
  const luminance = new Float32Array(length);
  const red = new Uint8Array(length);
  const green = new Uint8Array(length);
  const blue = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    const offset = index * 4;
    red[index] = pixels[offset];
    green[index] = pixels[offset + 1];
    blue[index] = pixels[offset + 2];
    luminance[index] =
      pixels[offset] * 0.299 +
      pixels[offset + 1] * 0.587 +
      pixels[offset + 2] * 0.114;
  }
  return { luminance, red, green, blue };
}

function createEdgeVariants(
  channels: PixelChannels,
  width: number,
  height: number,
): EdgeMaps[] {
  const luminance = createGradientEdges(
    channels.luminance,
    width,
    height,
    false,
  );
  const normalized = createGradientEdges(
    normalizeChannel(channels.luminance),
    width,
    height,
    true,
  );
  const color = createColorEdges(channels, width, height);
  return [
    luminance,
    normalized,
    combineEdges(luminance, color, 0.58, 0.42),
  ];
}

function createGradientEdges(
  channel: Float32Array,
  width: number,
  height: number,
  adaptive: boolean,
): EdgeMaps {
  const x = new Float32Array(width * height);
  const y = new Float32Array(width * height);
  for (let row = 1; row < height - 1; row += 1) {
    for (let column = 1; column < width - 1; column += 1) {
      const index = row * width + column;
      const localScale = adaptive ? 80 / Math.max(24, channel[index]) : 1;
      x[index] =
        Math.abs(channel[index + 1] - channel[index - 1]) * localScale;
      y[index] =
        Math.abs(channel[index + width] - channel[index - width]) * localScale;
    }
  }
  return { x, y };
}

function createColorEdges(
  channels: PixelChannels,
  width: number,
  height: number,
): EdgeMaps {
  const x = new Float32Array(width * height);
  const y = new Float32Array(width * height);
  for (let row = 1; row < height - 1; row += 1) {
    for (let column = 1; column < width - 1; column += 1) {
      const index = row * width + column;
      x[index] =
        colorDistance(channels, index - 1, index + 1) / 3;
      y[index] =
        colorDistance(channels, index - width, index + width) / 3;
    }
  }
  return { x, y };
}

function createCombinedEdges(
  channels: PixelChannels,
  width: number,
  height: number,
): EdgeMaps {
  return combineEdges(
    createGradientEdges(channels.luminance, width, height, false),
    createColorEdges(channels, width, height),
    0.62,
    0.38,
  );
}

function combineEdges(
  first: EdgeMaps,
  second: EdgeMaps,
  firstWeight: number,
  secondWeight: number,
): EdgeMaps {
  const x = new Float32Array(first.x.length);
  const y = new Float32Array(first.y.length);
  for (let index = 0; index < x.length; index += 1) {
    x[index] = first.x[index] * firstWeight + second.x[index] * secondWeight;
    y[index] = first.y[index] * firstWeight + second.y[index] * secondWeight;
  }
  return { x, y };
}

function normalizeChannel(channel: Float32Array): Float32Array {
  let sum = 0;
  let squared = 0;
  for (const value of channel) {
    sum += value;
    squared += value * value;
  }
  const mean = sum / Math.max(1, channel.length);
  const deviation = Math.sqrt(
    Math.max(1, squared / Math.max(1, channel.length) - mean * mean),
  );
  const normalized = new Float32Array(channel.length);
  for (let index = 0; index < channel.length; index += 1) {
    normalized[index] = clamp(
      128 + ((channel[index] - mean) / deviation) * 48,
      0,
      255,
    );
  }
  return normalized;
}

function detectOuterCandidate(
  edges: EdgeMaps,
  width: number,
  height: number,
  expected: CenteringBounds,
  expectedCorners: CenteringCorners,
  guidedSearch: boolean,
  hasCaptureGuide: boolean,
): OuterCandidate | null {
  const searchExpansion = guidedSearch ? 0.09 : 0.3;
  const left = fitVerticalSide(
    edges.x,
    width,
    height,
    expected.left,
    searchExpansion,
    expected.top,
    expected.bottom,
    guidedSearch,
  );
  const right = fitVerticalSide(
    edges.x,
    width,
    height,
    expected.right,
    searchExpansion,
    expected.top,
    expected.bottom,
    guidedSearch,
  );
  const top = fitHorizontalSide(
    edges.y,
    width,
    height,
    expected.top,
    searchExpansion,
    expected.left,
    expected.right,
    guidedSearch,
  );
  const bottom = fitHorizontalSide(
    edges.y,
    width,
    height,
    expected.bottom,
    searchExpansion,
    expected.left,
    expected.right,
    guidedSearch,
  );
  if (!left || !right || !top || !bottom) return null;

  const corners = {
    topLeft: intersectLines(left, top, width, height),
    topRight: intersectLines(right, top, width, height),
    bottomRight: intersectLines(right, bottom, width, height),
    bottomLeft: intersectLines(left, bottom, width, height),
  };
  if (!isValidCardQuad(corners)) return null;

  const topWidth = pointDistancePixels(
    corners.topLeft,
    corners.topRight,
    width,
    height,
  );
  const bottomWidth = pointDistancePixels(
    corners.bottomLeft,
    corners.bottomRight,
    width,
    height,
  );
  const leftHeight = pointDistancePixels(
    corners.topLeft,
    corners.bottomLeft,
    width,
    height,
  );
  const rightHeight = pointDistancePixels(
    corners.topRight,
    corners.bottomRight,
    width,
    height,
  );
  const cardWidth = (topWidth + bottomWidth) / 2;
  const cardHeight = (leftHeight + rightHeight) / 2;
  const aspect = cardWidth / Math.max(0.001, cardHeight);
  const aspectScore = Math.exp(-Math.abs(Math.log(aspect / CARD_ASPECT)) * 3.2);
  const guideDistance = cornerDistance(corners, expectedCorners);
  const guideScore = hasCaptureGuide
    ? Math.exp(-guideDistance / 0.065)
    : Math.exp(-guideDistance * 3.5);
  const edgeSupport = average([
    left.support,
    right.support,
    top.support,
    bottom.support,
  ]);
  const parallelScore =
    Math.exp(-Math.abs(left.slope - right.slope) * 5) *
    Math.exp(-Math.abs(top.slope - bottom.slope) * 5);
  const oppositeEdgeScore =
    Math.min(topWidth, bottomWidth) / Math.max(topWidth, bottomWidth) *
    (Math.min(leftHeight, rightHeight) / Math.max(leftHeight, rightHeight));
  const guideAlignmentScore = hasCaptureGuide
    ? Math.exp(
        -average([
          Math.abs(left.slope),
          Math.abs(right.slope),
          Math.abs(top.slope),
          Math.abs(bottom.slope),
        ]) *
          3.5,
      )
    : 1;
  const cornerAngleScore = average([
    rightAngleScore(corners.bottomLeft, corners.topLeft, corners.topRight, width, height),
    rightAngleScore(corners.topLeft, corners.topRight, corners.bottomRight, width, height),
    rightAngleScore(corners.topRight, corners.bottomRight, corners.bottomLeft, width, height),
    rightAngleScore(corners.bottomRight, corners.bottomLeft, corners.topLeft, width, height),
  ]);
  const geometryScore = clamp(
    parallelScore * 0.36 +
      oppositeEdgeScore * 0.28 +
      cornerAngleScore * 0.24 +
      guideAlignmentScore * 0.12,
    0,
    1,
  );
  const area = polygonArea(corners);
  const areaScore = clamp((area - 0.08) / 0.32, 0, 1);
  const score = hasCaptureGuide
    ? edgeSupport * 0.4 +
      aspectScore * 0.18 +
      guideScore * 0.22 +
      geometryScore * 0.16 +
      areaScore * 0.04
    : edgeSupport * 0.4 +
      aspectScore * 0.24 +
      guideScore * 0.12 +
      geometryScore * 0.18 +
      areaScore * 0.06;
  const outputCorners = hasCaptureGuide
    ? refineGuideCorners(
        expectedCorners,
        corners,
        edgeSupport,
        geometryScore,
        guidedSearch,
      )
    : corners;
  return {
    corners: outputCorners,
    score,
    edgeSupport,
    aspectScore,
    guideScore,
    geometryScore,
    guideDistance,
    guidedSearch,
  };
}

function refineGuideCorners(
  guide: CenteringCorners,
  detected: CenteringCorners,
  edgeSupport: number,
  geometryScore: number,
  guidedSearch: boolean,
): CenteringCorners {
  const independentEvidence =
    clamp((edgeSupport - 0.35) / 0.5, 0, 1) *
    clamp((geometryScore - 0.35) / 0.65, 0, 1);
  const refinementStrength =
    0.08 + independentEvidence * (guidedSearch ? 0.82 : 0.68);
  const maximumShift = guidedSearch ? 0.075 : 0.1;
  const refined = {
    topLeft: refineGuideCorner(
      guide.topLeft,
      detected.topLeft,
      refinementStrength,
      maximumShift,
    ),
    topRight: refineGuideCorner(
      guide.topRight,
      detected.topRight,
      refinementStrength,
      maximumShift,
    ),
    bottomRight: refineGuideCorner(
      guide.bottomRight,
      detected.bottomRight,
      refinementStrength,
      maximumShift,
    ),
    bottomLeft: refineGuideCorner(
      guide.bottomLeft,
      detected.bottomLeft,
      refinementStrength,
      maximumShift,
    ),
  };
  return isValidCardQuad(refined) ? refined : guide;
}

function refineGuideCorner(
  guide: CenteringPoint,
  detected: CenteringPoint,
  strength: number,
  maximumShift: number,
): CenteringPoint {
  const deltaX = detected.x - guide.x;
  const deltaY = detected.y - guide.y;
  const distance = Math.hypot(deltaX, deltaY);
  const scale =
    distance > maximumShift ? maximumShift / distance : 1;
  return {
    x: clamp(guide.x + deltaX * scale * strength, 0, 1),
    y: clamp(guide.y + deltaY * scale * strength, 0, 1),
  };
}

function fitVerticalSide(
  edges: Float32Array,
  width: number,
  height: number,
  expectedX: number,
  searchFraction: number,
  startY: number,
  endY: number,
  preferExpected: boolean,
): FittedLine | null {
  const points: EdgePoint[] = [];
  const minimumX = clamp(
    Math.round((expectedX - searchFraction) * width),
    1,
    width - 2,
  );
  const maximumX = clamp(
    Math.round((expectedX + searchFraction) * width),
    1,
    width - 2,
  );
  for (let sample = 0; sample < SCAN_COUNT; sample += 1) {
    const fraction = (sample + 0.5) / SCAN_COUNT;
    const y = Math.round(
      (startY + (endY - startY) * fraction) * (height - 1),
    );
    const peak = strongestEdge(
      edges,
      y * width,
      minimumX,
      maximumX,
      1,
      preferExpected ? expectedX * width : undefined,
      preferExpected ? searchFraction * width * 0.45 : undefined,
    );
    if (peak) points.push({ x: peak.index, y, weight: peak.confidence });
  }
  return robustFit(points, 'vertical', width, height);
}

function fitHorizontalSide(
  edges: Float32Array,
  width: number,
  height: number,
  expectedY: number,
  searchFraction: number,
  startX: number,
  endX: number,
  preferExpected: boolean,
): FittedLine | null {
  const points: EdgePoint[] = [];
  const minimumY = clamp(
    Math.round((expectedY - searchFraction) * height),
    1,
    height - 2,
  );
  const maximumY = clamp(
    Math.round((expectedY + searchFraction) * height),
    1,
    height - 2,
  );
  for (let sample = 0; sample < SCAN_COUNT; sample += 1) {
    const fraction = (sample + 0.5) / SCAN_COUNT;
    const x = Math.round(
      (startX + (endX - startX) * fraction) * (width - 1),
    );
    const peak = strongestEdge(
      edges,
      x,
      minimumY,
      maximumY,
      width,
      preferExpected ? expectedY * height : undefined,
      preferExpected ? searchFraction * height * 0.45 : undefined,
    );
    if (peak) points.push({ x, y: peak.index, weight: peak.confidence });
  }
  return robustFit(points, 'horizontal', width, height);
}

function strongestEdge(
  edges: Float32Array,
  offset: number,
  start: number,
  end: number,
  stride: number,
  expectedIndex?: number,
  positionSigma?: number,
): { index: number; confidence: number } | null {
  let sum = 0;
  let count = 0;
  for (let position = start; position <= end; position += 1) {
    const value = edges[offset + position * stride];
    sum += value;
    count += 1;
  }
  const mean = sum / Math.max(1, count);
  const minimumValue = mean * 1.18 + 2;
  let peakValue = -Infinity;
  let peakScore = -Infinity;
  let peakIndex = start;
  for (let position = start; position <= end; position += 1) {
    const value = edges[offset + position * stride];
    if (value < minimumValue) continue;
    const proximity =
      expectedIndex === undefined || positionSigma === undefined
        ? 1
        : 0.12 +
          Math.exp(
            -Math.abs(position - expectedIndex) /
              Math.max(1, positionSigma),
          ) *
            0.88;
    const score = value * proximity;
    if (score > peakScore) {
      peakScore = score;
      peakValue = value;
      peakIndex = position;
    }
  }
  if (!Number.isFinite(peakValue)) return null;
  return {
    index: peakIndex,
    confidence: clamp((peakValue - mean) / Math.max(1, peakValue), 0, 1),
  };
}

function robustFit(
  points: EdgePoint[],
  orientation: 'vertical' | 'horizontal',
  width: number,
  height: number,
): FittedLine | null {
  if (points.length < SCAN_COUNT * 0.35) return null;
  let selected = points;
  let line = weightedRegression(selected, orientation, width, height);
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const residuals = selected.map((point) =>
      lineResidual(line, point, orientation, width, height),
    );
    const threshold = Math.max(0.004, median(residuals) * 2.5);
    selected = selected.filter(
      (point) =>
        lineResidual(line, point, orientation, width, height) <= threshold,
    );
    if (selected.length < SCAN_COUNT * 0.3) return null;
    line = weightedRegression(selected, orientation, width, height);
  }
  const pointSupport = selected.length / SCAN_COUNT;
  const strength = average(selected.map((point) => point.weight));
  const residualRms = Math.sqrt(
    average(
      selected.map(
        (point) =>
          lineResidual(line, point, orientation, width, height) ** 2,
      ),
    ),
  );
  const fitQuality = Math.exp(-residualRms / 0.012);
  return {
    ...line,
    support: clamp(
      pointSupport * 0.45 + strength * 0.3 + fitQuality * 0.25,
      0,
      1,
    ),
  };
}

function weightedRegression(
  points: EdgePoint[],
  orientation: 'vertical' | 'horizontal',
  width: number,
  height: number,
): FittedLine {
  let sumWeight = 0;
  let sumInput = 0;
  let sumOutput = 0;
  for (const point of points) {
    const input = orientation === 'vertical' ? point.y / height : point.x / width;
    const output = orientation === 'vertical' ? point.x / width : point.y / height;
    const weight = Math.max(0.05, point.weight);
    sumWeight += weight;
    sumInput += input * weight;
    sumOutput += output * weight;
  }
  const meanInput = sumInput / sumWeight;
  const meanOutput = sumOutput / sumWeight;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    const input = orientation === 'vertical' ? point.y / height : point.x / width;
    const output = orientation === 'vertical' ? point.x / width : point.y / height;
    const weight = Math.max(0.05, point.weight);
    covariance += weight * (input - meanInput) * (output - meanOutput);
    variance += weight * (input - meanInput) ** 2;
  }
  const slope = variance <= 1e-8 ? 0 : covariance / variance;
  return { slope, intercept: meanOutput - slope * meanInput, support: 0 };
}

function lineResidual(
  line: FittedLine,
  point: EdgePoint,
  orientation: 'vertical' | 'horizontal',
  width: number,
  height: number,
): number {
  const input = orientation === 'vertical' ? point.y / height : point.x / width;
  const output = orientation === 'vertical' ? point.x / width : point.y / height;
  return Math.abs(output - (line.slope * input + line.intercept));
}

function intersectLines(
  vertical: FittedLine,
  horizontal: FittedLine,
  _width: number,
  _height: number,
): CenteringPoint {
  const denominator = 1 - vertical.slope * horizontal.slope;
  const x =
    Math.abs(denominator) < 1e-6
      ? vertical.intercept
      : (vertical.slope * horizontal.intercept + vertical.intercept) /
        denominator;
  const y = horizontal.slope * x + horizontal.intercept;
  return { x, y };
}

function isValidCardQuad(corners: CenteringCorners): boolean {
  const points = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];
  if (
    points.some(
      (point) =>
        point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1,
    )
  ) {
    return false;
  }
  if (polygonArea(corners) < 0.06) return false;
  let sign = 0;
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index];
    const second = points[(index + 1) % points.length];
    const third = points[(index + 2) % points.length];
    const value =
      (second.x - first.x) * (third.y - second.y) -
      (second.y - first.y) * (third.x - second.x);
    if (Math.abs(value) < 1e-5) return false;
    const nextSign = Math.sign(value);
    if (sign && nextSign !== sign) return false;
    sign = nextSign;
  }
  return true;
}

function rectifyChannels(
  source: PixelChannels,
  sourceWidth: number,
  sourceHeight: number,
  corners: CenteringCorners,
): PixelChannels {
  const length = RECTIFIED_WIDTH * RECTIFIED_HEIGHT;
  const result: PixelChannels = {
    luminance: new Float32Array(length),
    red: new Uint8Array(length),
    green: new Uint8Array(length),
    blue: new Uint8Array(length),
  };
  for (let y = 0; y < RECTIFIED_HEIGHT; y += 1) {
    const v = y / (RECTIFIED_HEIGHT - 1);
    for (let x = 0; x < RECTIFIED_WIDTH; x += 1) {
      const u = x / (RECTIFIED_WIDTH - 1);
      const point = projectivePoint(corners, u, v);
      const sourceX = clamp(Math.round(point.x * (sourceWidth - 1)), 0, sourceWidth - 1);
      const sourceY = clamp(Math.round(point.y * (sourceHeight - 1)), 0, sourceHeight - 1);
      const sourceIndex = sourceY * sourceWidth + sourceX;
      const targetIndex = y * RECTIFIED_WIDTH + x;
      result.luminance[targetIndex] = source.luminance[sourceIndex];
      result.red[targetIndex] = source.red[sourceIndex];
      result.green[targetIndex] = source.green[sourceIndex];
      result.blue[targetIndex] = source.blue[sourceIndex];
    }
  }
  return result;
}

function detectInnerFrame(
  edges: EdgeMaps,
  width: number,
  height: number,
): InnerFrameDetection {
  const leftSamples: number[] = [];
  const rightSamples: number[] = [];
  const topSamples: number[] = [];
  const bottomSamples: number[] = [];
  const confidences: number[] = [];

  for (let sample = 0; sample < 18; sample += 1) {
    const y = Math.round((0.1 + (sample / 17) * 0.8) * (height - 1));
    collectInnerPeak(edges.x, y * width, width, 0.025, 0.32, 1, leftSamples, confidences);
    collectInnerPeak(edges.x, y * width, width, 0.68, 0.975, 1, rightSamples, confidences);
    const x = Math.round((0.1 + (sample / 17) * 0.8) * (width - 1));
    collectInnerPeak(edges.y, x, height, 0.025, 0.32, width, topSamples, confidences);
    collectInnerPeak(edges.y, x, height, 0.68, 0.975, width, bottomSamples, confidences);
  }

  const sampleSupport =
    Math.min(
      leftSamples.length,
      rightSamples.length,
      topSamples.length,
      bottomSamples.length,
    ) / 18;
  const consistency = average([
    sampleConsistency(leftSamples),
    sampleConsistency(rightSamples),
    sampleConsistency(topSamples),
    sampleConsistency(bottomSamples),
  ]);
  const strength = confidences.length ? average(confidences) : 0;
  const support = clamp(sampleSupport * 0.45 + consistency * 0.3 + strength * 0.25, 0, 1);
  const hasEnoughSamples = [
    leftSamples,
    rightSamples,
    topSamples,
    bottomSamples,
  ].every((samples) => samples.length >= 4);
  const frameType =
    !hasEnoughSamples
      ? 'borderless-or-full-art'
      : support >= 0.46
      ? 'bordered'
      : support >= 0.25
        ? 'uncertain'
        : 'borderless-or-full-art';
  if (frameType === 'borderless-or-full-art') {
    return { left: 0.06, top: 0.06, right: 0.94, bottom: 0.94, support, frameType };
  }
  return {
    left: clamp(median(leftSamples) / width, 0.02, 0.4),
    top: clamp(median(topSamples) / height, 0.02, 0.4),
    right: clamp(median(rightSamples) / width, 0.6, 0.98),
    bottom: clamp(median(bottomSamples) / height, 0.6, 0.98),
    support,
    frameType,
  };
}

function collectInnerPeak(
  edges: Float32Array,
  offset: number,
  length: number,
  startFraction: number,
  endFraction: number,
  stride: number,
  samples: number[],
  confidences: number[],
) {
  const peak = strongestEdge(
    edges,
    offset,
    Math.round(startFraction * length),
    Math.round(endFraction * length),
    stride,
  );
  if (peak) {
    samples.push(peak.index);
    confidences.push(peak.confidence);
  }
}

function mapRectifiedFrameToSource(
  outer: CenteringCorners,
  inner: InnerFrameDetection,
): CenteringCorners {
  return {
    topLeft: projectivePoint(outer, inner.left, inner.top),
    topRight: projectivePoint(outer, inner.right, inner.top),
    bottomRight: projectivePoint(outer, inner.right, inner.bottom),
    bottomLeft: projectivePoint(outer, inner.left, inner.bottom),
  };
}

function projectivePoint(
  corners: CenteringCorners,
  u: number,
  v: number,
): CenteringPoint {
  const topLeft = corners.topLeft;
  const topRight = corners.topRight;
  const bottomRight = corners.bottomRight;
  const bottomLeft = corners.bottomLeft;
  const deltaX1 = topRight.x - bottomRight.x;
  const deltaX2 = bottomLeft.x - bottomRight.x;
  const deltaX3 =
    topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const deltaY1 = topRight.y - bottomRight.y;
  const deltaY2 = bottomLeft.y - bottomRight.y;
  const deltaY3 =
    topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;
  const projectiveDenominator =
    deltaX1 * deltaY2 - deltaX2 * deltaY1;
  let projectiveX = 0;
  let projectiveY = 0;
  if (
    Math.abs(deltaX3) > 1e-8 ||
    Math.abs(deltaY3) > 1e-8
  ) {
    if (Math.abs(projectiveDenominator) < 1e-8) {
      return {
        x:
          topLeft.x +
          (topRight.x - topLeft.x) * u +
          (bottomLeft.x - topLeft.x) * v,
        y:
          topLeft.y +
          (topRight.y - topLeft.y) * u +
          (bottomLeft.y - topLeft.y) * v,
      };
    }
    projectiveX =
      (deltaX3 * deltaY2 - deltaX2 * deltaY3) /
      projectiveDenominator;
    projectiveY =
      (deltaX1 * deltaY3 - deltaX3 * deltaY1) /
      projectiveDenominator;
  }
  const a =
    topRight.x - topLeft.x + projectiveX * topRight.x;
  const b =
    bottomLeft.x - topLeft.x + projectiveY * bottomLeft.x;
  const d =
    topRight.y - topLeft.y + projectiveX * topRight.y;
  const e =
    bottomLeft.y - topLeft.y + projectiveY * bottomLeft.y;
  const denominator = projectiveX * u + projectiveY * v + 1;
  return {
    x: (a * u + b * v + topLeft.x) / denominator,
    y: (d * u + e * v + topLeft.y) / denominator,
  };
}

function defaultManualOuterBounds(capture: Capture): CenteringBounds {
  const imageAspect = capture.width / Math.max(1, capture.height);
  const maximumSize = 0.82;
  const width =
    imageAspect > CARD_ASPECT
      ? (maximumSize * CARD_ASPECT) / imageAspect
      : maximumSize;
  const height =
    imageAspect > CARD_ASPECT
      ? maximumSize
      : (maximumSize * imageAspect) / CARD_ASPECT;
  return {
    left: (1 - width) / 2,
    top: (1 - height) / 2,
    right: (1 + width) / 2,
    bottom: (1 + height) / 2,
  };
}

function insetBounds(
  bounds: CenteringBounds,
  fraction: number,
): CenteringBounds {
  const horizontalInset = (bounds.right - bounds.left) * fraction;
  const verticalInset = (bounds.bottom - bounds.top) * fraction;
  return {
    left: bounds.left + horizontalInset,
    top: bounds.top + verticalInset,
    right: bounds.right - horizontalInset,
    bottom: bounds.bottom - verticalInset,
  };
}

function cornersFromBounds(bounds: CenteringBounds): CenteringCorners {
  return {
    topLeft: { x: bounds.left, y: bounds.top },
    topRight: { x: bounds.right, y: bounds.top },
    bottomRight: { x: bounds.right, y: bounds.bottom },
    bottomLeft: { x: bounds.left, y: bounds.bottom },
  };
}

function boundsFromCorners(corners: CenteringCorners): CenteringBounds {
  const points = Object.values(corners);
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

function percentages(
  first: number,
  second: number,
): { first: number; second: number } {
  const total = first + second;
  if (total <= 0) return { first: 50, second: 50 };
  const firstPercent = (first / total) * 100;
  return {
    first: roundOne(firstPercent),
    second: roundOne(100 - firstPercent),
  };
}

function colorDistance(
  channels: PixelChannels,
  first: number,
  second: number,
): number {
  return (
    Math.abs(channels.red[first] - channels.red[second]) +
    Math.abs(channels.green[first] - channels.green[second]) +
    Math.abs(channels.blue[first] - channels.blue[second])
  );
}

function cornerDistance(
  first: CenteringCorners,
  second: CenteringCorners,
): number {
  return average([
    pointDistance(first.topLeft, second.topLeft),
    pointDistance(first.topRight, second.topRight),
    pointDistance(first.bottomRight, second.bottomRight),
    pointDistance(first.bottomLeft, second.bottomLeft),
  ]);
}

function pointDistance(first: CenteringPoint, second: CenteringPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function pointDistancePixels(
  first: CenteringPoint,
  second: CenteringPoint,
  width: number,
  height: number,
): number {
  return Math.hypot(
    (second.x - first.x) * width,
    (second.y - first.y) * height,
  );
}

function rightAngleScore(
  first: CenteringPoint,
  corner: CenteringPoint,
  second: CenteringPoint,
  width: number,
  height: number,
): number {
  const firstX = (first.x - corner.x) * width;
  const firstY = (first.y - corner.y) * height;
  const secondX = (second.x - corner.x) * width;
  const secondY = (second.y - corner.y) * height;
  const denominator =
    Math.hypot(firstX, firstY) * Math.hypot(secondX, secondY);
  if (denominator <= 1e-6) return 0;
  const cosine = Math.abs(
    (firstX * secondX + firstY * secondY) / denominator,
  );
  return Math.exp(-cosine * 4.5);
}

function polygonArea(corners: CenteringCorners): number {
  const points = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index];
    const second = points[(index + 1) % points.length];
    area += first.x * second.y - second.x * first.y;
  }
  return Math.abs(area) / 2;
}

function sampleConsistency(samples: number[]): number {
  if (samples.length < 4) return 0;
  const center = median(samples);
  const deviation = median(samples.map((value) => Math.abs(value - center)));
  return Math.exp(-deviation / Math.max(2, center * 0.08));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error('The selected picture could not be decoded.'));
    image.src = uri;
  });
}

function average(values: number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
