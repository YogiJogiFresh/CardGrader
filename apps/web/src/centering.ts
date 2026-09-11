import { Capture } from '@cardgrader/domain';

const MAX_ANALYSIS_DIMENSION = 1000;

export interface CenteringBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CenteringMeasurement {
  captureId: string;
  viewId: Capture['viewId'];
  outerBounds: CenteringBounds;
  innerBounds: CenteringBounds;
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
}

export async function analyzeCentering(
  capture: Capture,
): Promise<CenteringMeasurement> {
  return analyzeCenteringImage(capture);
}

export async function analyzeCenteringWithOuterBounds(
  capture: Capture,
  outerBounds: CenteringBounds,
): Promise<CenteringMeasurement> {
  return analyzeCenteringImage(capture, outerBounds);
}

async function analyzeCenteringImage(
  capture: Capture,
  outerBoundsOverride?: CenteringBounds,
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
  const grayscale = toGrayscale(pixels, width, height);
  const verticalProjection = smoothProjection(
    createVerticalEdgeProjection(grayscale, width, height),
    3,
  );
  const horizontalProjection = smoothProjection(
    createHorizontalEdgeProjection(grayscale, width, height),
    3,
  );

  const outerLeft = outerBoundsOverride
    ? peakFromFraction(outerBoundsOverride.left, width)
    : findPeak(verticalProjection, 0.01, 0.44);
  const outerRight = outerBoundsOverride
    ? peakFromFraction(outerBoundsOverride.right, width)
    : findPeak(verticalProjection, 0.56, 0.99);
  const outerTop = outerBoundsOverride
    ? peakFromFraction(outerBoundsOverride.top, height)
    : findPeak(horizontalProjection, 0.01, 0.44);
  const outerBottom = outerBoundsOverride
    ? peakFromFraction(outerBoundsOverride.bottom, height)
    : findPeak(horizontalProjection, 0.56, 0.99);

  const minimumOuterFraction = outerBoundsOverride ? 0.1 : 0.35;
  if (
    outerRight.index - outerLeft.index < width * minimumOuterFraction ||
    outerBottom.index - outerTop.index < height * minimumOuterFraction
  ) {
    throw new Error(
      'The card edges could not be separated from the background. Use a contrasting background and keep the full card visible.',
    );
  }

  const cardWidth = outerRight.index - outerLeft.index;
  const cardHeight = outerBottom.index - outerTop.index;
  const innerLeft = findPeakInRange(
    verticalProjection,
    outerLeft.index + cardWidth * 0.025,
    outerLeft.index + cardWidth * 0.3,
  );
  const innerRight = findPeakInRange(
    verticalProjection,
    outerLeft.index + cardWidth * 0.7,
    outerRight.index - cardWidth * 0.025,
  );
  const innerTop = findPeakInRange(
    horizontalProjection,
    outerTop.index + cardHeight * 0.025,
    outerTop.index + cardHeight * 0.3,
  );
  const innerBottom = findPeakInRange(
    horizontalProjection,
    outerTop.index + cardHeight * 0.7,
    outerBottom.index - cardHeight * 0.025,
  );

  const leftMargin = innerLeft.index - outerLeft.index;
  const rightMargin = outerRight.index - innerRight.index;
  const topMargin = innerTop.index - outerTop.index;
  const bottomMargin = outerBottom.index - innerBottom.index;
  const horizontal = percentages(leftMargin, rightMargin);
  const vertical = percentages(topMargin, bottomMargin);
  const confidence = average(
    outerBoundsOverride
      ? [
          innerLeft.confidence,
          innerRight.confidence,
          innerTop.confidence,
          innerBottom.confidence,
        ]
      : [
          outerLeft.confidence,
          outerRight.confidence,
          outerTop.confidence,
          outerBottom.confidence,
          innerLeft.confidence,
          innerRight.confidence,
          innerTop.confidence,
          innerBottom.confidence,
        ],
  );
  const warnings: string[] = [];

  if (outerBoundsOverride) {
    warnings.push(
      'Automatic card-edge detection was overridden. The cyan guide starts at the camera framing guide; adjust all four cyan corners to the card edges before relying on the estimate.',
    );
  }

  if (confidence < 0.5) {
    warnings.push(
      'Edge confidence is low. Glare, artwork, or a borderless design may be affecting the estimate.',
    );
  }

  if (
    Math.min(leftMargin, rightMargin) < cardWidth * 0.015 ||
    Math.min(topMargin, bottomMargin) < cardHeight * 0.015
  ) {
    warnings.push(
      'The detected inner frame is very close to a card edge. Verify the yellow guide before using the percentages.',
    );
  }

  return {
    captureId: capture.id,
    viewId: capture.viewId,
    outerBounds: normalizeBounds(
      outerLeft.index,
      outerTop.index,
      outerRight.index,
      outerBottom.index,
      width,
      height,
    ),
    innerBounds: normalizeBounds(
      innerLeft.index,
      innerTop.index,
      innerRight.index,
      innerBottom.index,
      width,
      height,
    ),
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
  };
}

function peakFromFraction(fraction: number, length: number): Peak {
  return {
    index: clamp(fraction, 0, 1) * length,
    confidence: 1,
  };
}

interface Peak {
  index: number;
  confidence: number;
}

function toGrayscale(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const grayscale = new Float32Array(width * height);
  for (let pixel = 0; pixel < grayscale.length; pixel += 1) {
    const offset = pixel * 4;
    grayscale[pixel] =
      pixels[offset] * 0.299 +
      pixels[offset + 1] * 0.587 +
      pixels[offset + 2] * 0.114;
  }
  return grayscale;
}

function createVerticalEdgeProjection(
  grayscale: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const projection = new Float32Array(width);
  const startY = Math.floor(height * 0.04);
  const endY = Math.ceil(height * 0.96);

  for (let x = 1; x < width - 1; x += 1) {
    let sum = 0;
    for (let y = startY; y < endY; y += 1) {
      const offset = y * width + x;
      sum += Math.abs(grayscale[offset + 1] - grayscale[offset - 1]);
    }
    projection[x] = sum / Math.max(1, endY - startY);
  }
  return projection;
}

function createHorizontalEdgeProjection(
  grayscale: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const projection = new Float32Array(height);
  const startX = Math.floor(width * 0.04);
  const endX = Math.ceil(width * 0.96);

  for (let y = 1; y < height - 1; y += 1) {
    let sum = 0;
    for (let x = startX; x < endX; x += 1) {
      const offset = y * width + x;
      sum += Math.abs(
        grayscale[offset + width] - grayscale[offset - width],
      );
    }
    projection[y] = sum / Math.max(1, endX - startX);
  }
  return projection;
}

function smoothProjection(
  projection: Float32Array,
  radius: number,
): Float32Array {
  const smoothed = new Float32Array(projection.length);
  for (let index = 0; index < projection.length; index += 1) {
    let sum = 0;
    let count = 0;
    for (
      let sample = Math.max(0, index - radius);
      sample <= Math.min(projection.length - 1, index + radius);
      sample += 1
    ) {
      sum += projection[sample];
      count += 1;
    }
    smoothed[index] = sum / count;
  }
  return smoothed;
}

function findPeak(
  projection: Float32Array,
  startFraction: number,
  endFraction: number,
): Peak {
  return findPeakInRange(
    projection,
    projection.length * startFraction,
    projection.length * endFraction,
  );
}

function findPeakInRange(
  projection: Float32Array,
  startValue: number,
  endValue: number,
): Peak {
  const start = Math.max(0, Math.floor(startValue));
  const end = Math.min(projection.length - 1, Math.ceil(endValue));
  let peakIndex = start;
  let peakValue = -Infinity;
  let sum = 0;

  for (let index = start; index <= end; index += 1) {
    const value = projection[index];
    sum += value;
    if (value > peakValue) {
      peakValue = value;
      peakIndex = index;
    }
  }

  const mean = sum / Math.max(1, end - start + 1);
  const confidence =
    peakValue <= 0 ? 0 : clamp((peakValue - mean) / peakValue, 0, 1);

  return { index: peakIndex, confidence };
}

function percentages(
  first: number,
  second: number,
): { first: number; second: number } {
  const total = first + second;
  if (total <= 0) {
    return { first: 50, second: 50 };
  }

  const firstPercent = (first / total) * 100;
  return {
    first: roundOne(firstPercent),
    second: roundOne(100 - firstPercent),
  };
}

function normalizeBounds(
  left: number,
  top: number,
  right: number,
  bottom: number,
  width: number,
  height: number,
): CenteringBounds {
  return {
    left: left / width,
    top: top / height,
    right: right / width,
    bottom: bottom / height,
  };
}

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error('The selected picture could not be decoded.'));
    image.src = uri;
  });
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
