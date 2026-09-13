import { CenteringBounds } from './centering';

export interface CameraGuidance {
  status: 'ready' | 'warning';
  message: string;
  score: number;
}

export interface CapturedFrame {
  blob: Blob;
  width: number;
  height: number;
  qualityScore: number;
}

const GUIDANCE_WIDTH = 260;

export function analyzeVideoFrame(
  video: HTMLVideoElement,
  guideBounds?: CenteringBounds | null,
): CameraGuidance {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    return {
      status: 'warning',
      message: 'Waiting for a stable camera frame…',
      score: 0,
    };
  }
  const canvas = downscaledFrame(video, GUIDANCE_WIDTH);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return {
      status: 'warning',
      message: 'Live quality guidance is unavailable in this browser.',
      score: 0,
    };
  }
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const metrics = frameMetrics(
    pixels,
    canvas.width,
    canvas.height,
    guideBounds ?? undefined,
  );
  if (metrics.glareFraction > 0.075) {
    return {
      status: 'warning',
      message: 'Reduce glare or move the light before capturing.',
      score: metrics.score,
    };
  }
  if (metrics.darkFraction > 0.38) {
    return {
      status: 'warning',
      message: 'The card is too dark. Add diffuse light without creating glare.',
      score: metrics.score,
    };
  }
  if (metrics.brightFraction > 0.42) {
    return {
      status: 'warning',
      message: 'The image is overexposed. Reduce direct light.',
      score: metrics.score,
    };
  }
  if (metrics.sharpness < 85) {
    return {
      status: 'warning',
      message: 'Hold the phone steady and wait for the card to become sharp.',
      score: metrics.score,
    };
  }
  if (guideBounds && metrics.boundaryContrast < 10) {
    return {
      status: 'warning',
      message: 'Increase contrast between the card edge and the background.',
      score: metrics.score,
    };
  }
  return {
    status: 'ready',
    message: 'Capture conditions look usable. Keep all four corners in the guide.',
    score: metrics.score,
  };
}

export async function captureBestFrame(
  video: HTMLVideoElement,
  guideBounds?: CenteringBounds | null,
  frameCount = 3,
): Promise<CapturedFrame> {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error('The camera has not produced a full-resolution frame yet.');
  }
  let bestCanvas: HTMLCanvasElement | null = null;
  let bestScore = -Infinity;
  for (let index = 0; index < frameCount; index += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('This browser cannot prepare camera images.');
    }
    context.drawImage(video, 0, 0);
    const preview = downscaledCanvas(canvas, GUIDANCE_WIDTH);
    const previewContext = preview.getContext('2d', { willReadFrequently: true });
    if (!previewContext) {
      throw new Error('This browser cannot score camera frames.');
    }
    const pixels = previewContext.getImageData(
      0,
      0,
      preview.width,
      preview.height,
    ).data;
    const metrics = frameMetrics(
      pixels,
      preview.width,
      preview.height,
      guideBounds ?? undefined,
    );
    if (metrics.score > bestScore) {
      bestCanvas = canvas;
      bestScore = metrics.score;
    }
    if (index < frameCount - 1) {
      await delay(65);
    }
  }
  if (!bestCanvas) {
    throw new Error('No camera frame could be captured.');
  }
  return {
    blob: await canvasToJpeg(bestCanvas),
    width: bestCanvas.width,
    height: bestCanvas.height,
    qualityScore: bestScore,
  };
}

function downscaledFrame(
  source: CanvasImageSource,
  maximumWidth: number,
): HTMLCanvasElement {
  const sourceWidth =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLCanvasElement
        ? source.width
        : 1;
  const sourceHeight =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLCanvasElement
        ? source.height
        : 1;
  const scale = Math.min(1, maximumWidth / Math.max(1, sourceWidth));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function downscaledCanvas(
  source: HTMLCanvasElement,
  maximumWidth: number,
): HTMLCanvasElement {
  return downscaledFrame(source, maximumWidth);
}

function frameMetrics(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  guideBounds?: CenteringBounds,
) {
  const luminance = new Float32Array(width * height);
  let dark = 0;
  let bright = 0;
  let glare = 0;
  for (let index = 0; index < luminance.length; index += 1) {
    const offset = index * 4;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const value = red * 0.299 + green * 0.587 + blue * 0.114;
    luminance[index] = value;
    if (value < 45) dark += 1;
    if (value > 225) bright += 1;
    if (value > 245 && Math.max(red, green, blue) - Math.min(red, green, blue) < 14) {
      glare += 1;
    }
  }
  let laplacianSum = 0;
  let laplacianSquared = 0;
  let samples = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value =
        luminance[index - 1] +
        luminance[index + 1] +
        luminance[index - width] +
        luminance[index + width] -
        luminance[index] * 4;
      laplacianSum += value;
      laplacianSquared += value * value;
      samples += 1;
    }
  }
  const mean = laplacianSum / Math.max(1, samples);
  const sharpness =
    laplacianSquared / Math.max(1, samples) - mean * mean;
  const boundaryContrast = guideBounds
    ? measureBoundaryContrast(luminance, width, height, guideBounds)
    : 20;
  const darkFraction = dark / luminance.length;
  const brightFraction = bright / luminance.length;
  const glareFraction = glare / luminance.length;
  const exposurePenalty =
    Math.abs(darkFraction - 0.12) + Math.abs(brightFraction - 0.12);
  const score =
    Math.log1p(Math.max(0, sharpness)) * 14 +
    Math.min(30, boundaryContrast * 1.5) -
    glareFraction * 220 -
    exposurePenalty * 35;
  return {
    sharpness,
    darkFraction,
    brightFraction,
    glareFraction,
    boundaryContrast,
    score,
  };
}

function measureBoundaryContrast(
  luminance: Float32Array,
  width: number,
  height: number,
  bounds: CenteringBounds,
): number {
  const left = Math.round(bounds.left * width);
  const right = Math.round(bounds.right * width);
  const top = Math.round(bounds.top * height);
  const bottom = Math.round(bounds.bottom * height);
  const offset = Math.max(2, Math.round(Math.min(width, height) * 0.012));
  const samples: number[] = [];
  for (let index = 1; index < 12; index += 1) {
    const y = Math.round(top + ((bottom - top) * index) / 12);
    samples.push(
      sampleDifference(luminance, width, height, left - offset, y, left + offset, y),
      sampleDifference(luminance, width, height, right - offset, y, right + offset, y),
    );
    const x = Math.round(left + ((right - left) * index) / 12);
    samples.push(
      sampleDifference(luminance, width, height, x, top - offset, x, top + offset),
      sampleDifference(luminance, width, height, x, bottom - offset, x, bottom + offset),
    );
  }
  return samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
}

function sampleDifference(
  luminance: Float32Array,
  width: number,
  height: number,
  firstX: number,
  firstY: number,
  secondX: number,
  secondY: number,
): number {
  const first =
    clamp(firstY, 0, height - 1) * width + clamp(firstX, 0, width - 1);
  const second =
    clamp(secondY, 0, height - 1) * width + clamp(secondX, 0, width - 1);
  return Math.abs(luminance[first] - luminance[second]);
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('The selected camera frame could not be encoded.')),
      'image/jpeg',
      0.95,
    );
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
