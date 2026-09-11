export interface Point {
  x: number;
  y: number;
}

export type CornerName =
  | 'topLeft'
  | 'topRight'
  | 'bottomRight'
  | 'bottomLeft';

export type GuideCorners = Record<CornerName, Point>;

export interface EditableGuides {
  outer: GuideCorners;
  inner: GuideCorners;
}

export type InspectionFilter =
  | 'original'
  | 'negative'
  | 'grayscale'
  | 'contrast'
  | 'edges';

export interface QualityCheck {
  id: string;
  severity: 'good' | 'warning' | 'error';
  label: string;
  detail: string;
}

export interface BlemishAnnotation {
  id: string;
  type:
    | 'scratch'
    | 'whitening'
    | 'dent'
    | 'stain'
    | 'print-line'
    | 'other';
  note: string;
  x: number;
  y: number;
}

export interface PercentagePair {
  first: number;
  second: number;
}

export interface InspectionReportSide {
  title: string;
  sourceUri: string;
  correctedOuterCorners?: GuideCorners;
  horizontal: PercentagePair;
  vertical: PercentagePair;
  qualityChecks: QualityCheck[];
  annotations: BlemishAnnotation[];
}

export interface InspectionReportInput {
  createdAt: Date | string | number;
  gradeComparison?: {
    graderLabel: string;
    minimum: number;
    maximum: number;
    mostLikely: number;
    confidence: number;
    methodologyNote: string;
  };
  sides: [InspectionReportSide, InspectionReportSide];
}

const ANALYSIS_MAX_DIMENSION = 800;
const RENDER_MAX_DIMENSION = 2400;
const REPORT_WIDTH = 1600;
const REPORT_SIDE_IMAGE_WIDTH = 680;
const REPORT_SIDE_IMAGE_HEIGHT = 720;
const CORNERS: CornerName[] = [
  'topLeft',
  'topRight',
  'bottomRight',
  'bottomLeft',
];

export async function analyzeImageQuality(
  uri: string,
  width: number,
  height: number,
): Promise<QualityCheck[]> {
  const image = await loadImage(uri);
  const reportedWidth = positiveDimension(width) ?? image.naturalWidth;
  const reportedHeight = positiveDimension(height) ?? image.naturalHeight;
  const shortestSide = Math.min(reportedWidth, reportedHeight);
  const checks: QualityCheck[] = [];

  if (shortestSide < 1000) {
    checks.push({
      id: 'resolution',
      severity: 'error',
      label: 'Low resolution',
      detail: `The shortest side is ${Math.round(shortestSide)} px. Retake at 1000 px or more (1500 px preferred) so small defects remain visible.`,
    });
  } else if (shortestSide < 1500) {
    checks.push({
      id: 'resolution',
      severity: 'warning',
      label: 'Moderate resolution',
      detail: `The shortest side is ${Math.round(shortestSide)} px. A 1500 px or larger image will make edge and surface inspection more reliable.`,
    });
  } else {
    checks.push({
      id: 'resolution',
      severity: 'good',
      label: 'Useful resolution',
      detail: `The shortest side is ${Math.round(shortestSide)} px, which is suitable for close inspection.`,
    });
  }

  const scale = Math.min(
    1,
    ANALYSIS_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = createCanvas(
    Math.max(1, Math.round(image.naturalWidth * scale)),
    Math.max(1, Math.round(image.naturalHeight * scale)),
  );
  const context = getContext(canvas);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = readPixels(context, canvas.width, canvas.height);
  const metrics = calculateQualityMetrics(pixels, canvas.width, canvas.height);

  checks.push(blurCheck(metrics.laplacianVariance));
  checks.push(glareCheck(metrics.glareFraction));
  checks.push(
    exposureCheck(
      metrics.meanLuminance,
      metrics.darkFraction,
      metrics.brightFraction,
    ),
  );
  checks.push(cropCheck(metrics.edgeDetailFraction, metrics.detailFraction));

  return checks;
}

export async function renderInspectionImage(
  uri: string,
  filter: InspectionFilter,
  correctedCorners?: GuideCorners,
): Promise<Blob> {
  const image = await loadImage(uri);
  let canvas: HTMLCanvasElement;

  if (correctedCorners) {
    canvas = renderCorrectedCard(image, correctedCorners);
  } else {
    const scale = Math.min(
      1,
      RENDER_MAX_DIMENSION /
        Math.max(image.naturalWidth, image.naturalHeight),
    );
    canvas = createCanvas(
      Math.max(1, Math.round(image.naturalWidth * scale)),
      Math.max(1, Math.round(image.naturalHeight * scale)),
    );
    getContext(canvas).drawImage(image, 0, 0, canvas.width, canvas.height);
  }

  applyFilter(canvas, filter);
  return canvasToBlob(canvas, 'inspection image');
}

export async function createReportPng(
  input: InspectionReportInput,
): Promise<Blob> {
  if (!input || input.sides.length !== 2) {
    throw new Error('An inspection report requires exactly two sides.');
  }

  const preparedSides = await Promise.all(
    input.sides.map(async (side) => {
      const blob = await renderInspectionImage(
        side.sourceUri,
        'original',
        side.correctedOuterCorners,
      );
      const objectUrl = URL.createObjectURL(blob);
      try {
        return { side, image: await loadImage(objectUrl) };
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }),
  );

  const sideHeights = preparedSides.map(({ side }) =>
    reportSideHeight(side, REPORT_SIDE_IMAGE_HEIGHT),
  );
  const summaryHeight = input.gradeComparison ? 210 : 0;
  const canvas = createCanvas(
    REPORT_WIDTH,
    250 + summaryHeight + sideHeights[0] + sideHeights[1] + 70,
  );
  const context = getContext(canvas);
  context.fillStyle = '#f7f4ed';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#14213d';
  context.font = '700 54px sans-serif';
  context.fillText('CardGrader Inspection Report', 70, 82);
  context.font = '24px sans-serif';
  context.fillStyle = '#425466';
  context.fillText(`Created ${formatDate(input.createdAt)}`, 70, 126);
  context.font = '20px sans-serif';
  drawWrappedText(
    context,
    'Visual inspection aid only — this report is not a professional grade, guarantee of authenticity, or valuation.',
    70,
    168,
    canvas.width - 140,
    28,
  );

  let y = 230;
  if (input.gradeComparison) {
    const comparison = input.gradeComparison;
    context.fillStyle = '#fff8df';
    context.fillRect(45, y, REPORT_WIDTH - 90, 186);
    context.strokeStyle = '#d7ad35';
    context.strokeRect(45, y, REPORT_WIDTH - 90, 186);
    context.fillStyle = '#14213d';
    context.font = '700 30px sans-serif';
    context.fillText(
      `${comparison.graderLabel} unofficial estimate: ${formatGrade(comparison.minimum)}–${formatGrade(comparison.maximum)}`,
      75,
      y + 42,
    );
    context.font = '21px sans-serif';
    context.fillStyle = '#425466';
    context.fillText(
      `Most likely ${formatGrade(comparison.mostLikely)} · ${Math.round(comparison.confidence * 100)}% evidence confidence`,
      75,
      y + 76,
    );
    drawWrappedText(
      context,
      comparison.methodologyNote,
      75,
      y + 106,
      REPORT_WIDTH - 150,
      24,
    );
    y += 210;
  }
  preparedSides.forEach(({ side, image }, index) => {
    drawReportSide(context, side, image, y, sideHeights[index]);
    y += sideHeights[index];
  });

  return canvasToBlob(canvas, 'inspection report');
}

export function printReport(input: InspectionReportInput): Promise<void> {
  const popup = window.open('', '_blank', 'noopener=false');
  if (!popup) {
    return Promise.reject(
      new Error(
        'The print window was blocked. Allow popups for this site and try again.',
      ),
    );
  }

  return createReportPng(input)
    .then(
      (blob) =>
        new Promise<void>((resolve, reject) => {
          const objectUrl = URL.createObjectURL(blob);
          const document = popup.document;
          document.title = 'CardGrader Inspection Report';
          document.head.replaceChildren();
          document.body.replaceChildren();

          const style = document.createElement('style');
          style.textContent =
            'html,body{margin:0;background:#fff}img{display:block;width:100%;height:auto}@page{margin:8mm}@media print{img{max-width:100%}}';
          const image = document.createElement('img');
          image.alt = 'CardGrader inspection report';

          const cleanup = () => {
            URL.revokeObjectURL(objectUrl);
            popup.removeEventListener('afterprint', cleanup);
          };

          image.addEventListener(
            'load',
            () => {
              popup.addEventListener('afterprint', cleanup, { once: true });
              popup.focus();
              popup.print();
              window.setTimeout(cleanup, 60_000);
              resolve();
            },
            { once: true },
          );
          image.addEventListener(
            'error',
            () => {
              cleanup();
              popup.close();
              reject(new Error('The printable report image could not be loaded.'));
            },
            { once: true },
          );
          document.head.append(style);
          document.body.append(image);
          image.src = objectUrl;
        }),
    )
    .catch((error: unknown) => {
      popup.close();
      throw explicitError(error, 'The printable report could not be created.');
    });
}

function loadImage(uri: string): Promise<HTMLImageElement> {
  if (!uri || typeof uri !== 'string') {
    return Promise.reject(new Error('An image URI is required.'));
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (image.naturalWidth < 1 || image.naturalHeight < 1) {
        reject(new Error('The image loaded without usable dimensions.'));
        return;
      }
      resolve(image);
    };
    image.onerror = () => {
      reject(
        new Error(
          'The image could not be loaded. Check the URI and cross-origin permissions.',
        ),
      );
    };
    image.src = uri;
  });
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('Cannot create a canvas with invalid dimensions.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  return canvas;
}

function getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Canvas 2D is unavailable in this browser.');
  }
  return context;
}

function readPixels(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): ImageData {
  try {
    return context.getImageData(0, 0, width, height);
  } catch (error) {
    throw explicitError(
      error,
      'The image pixels could not be read. The source may not permit cross-origin canvas access.',
    );
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  description: string,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error(`The ${description} could not be encoded as PNG.`));
        }
      }, 'image/png');
    } catch (error) {
      reject(explicitError(error, `The ${description} could not be exported.`));
    }
  });
}

function calculateQualityMetrics(
  imageData: ImageData,
  width: number,
  height: number,
) {
  const { data } = imageData;
  const luminance = new Float32Array(width * height);
  let luminanceTotal = 0;
  let dark = 0;
  let bright = 0;
  let glare = 0;

  for (let index = 0; index < luminance.length; index += 1) {
    const offset = index * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const value = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    luminance[index] = value;
    luminanceTotal += value;
    if (value < 35) dark += 1;
    if (value > 235) bright += 1;
    if (
      red > 235 &&
      green > 235 &&
      blue > 235 &&
      Math.max(red, green, blue) - Math.min(red, green, blue) < 18
    ) {
      glare += 1;
    }
  }

  let laplacianTotal = 0;
  let laplacianSquaredTotal = 0;
  let laplacianCount = 0;
  let detail = 0;
  let edgeDetail = 0;
  let edgeSamples = 0;
  const edgeBand = Math.max(2, Math.round(Math.min(width, height) * 0.04));

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const laplacian =
        luminance[index - 1] +
        luminance[index + 1] +
        luminance[index - width] +
        luminance[index + width] -
        4 * luminance[index];
      laplacianTotal += laplacian;
      laplacianSquaredTotal += laplacian * laplacian;
      laplacianCount += 1;

      const gradient =
        Math.abs(luminance[index + 1] - luminance[index - 1]) +
        Math.abs(luminance[index + width] - luminance[index - width]);
      if (gradient > 48) detail += 1;
      if (
        x < edgeBand ||
        x >= width - edgeBand ||
        y < edgeBand ||
        y >= height - edgeBand
      ) {
        edgeSamples += 1;
        if (gradient > 48) edgeDetail += 1;
      }
    }
  }

  const count = luminance.length;
  const laplacianMean = laplacianTotal / Math.max(1, laplacianCount);
  return {
    meanLuminance: luminanceTotal / count,
    darkFraction: dark / count,
    brightFraction: bright / count,
    glareFraction: glare / count,
    laplacianVariance:
      laplacianSquaredTotal / Math.max(1, laplacianCount) -
      laplacianMean * laplacianMean,
    detailFraction: detail / Math.max(1, laplacianCount),
    edgeDetailFraction: edgeDetail / Math.max(1, edgeSamples),
  };
}

function blurCheck(metric: number): QualityCheck {
  if (metric < 25) {
    return {
      id: 'blur',
      severity: 'error',
      label: 'Possible heavy blur',
      detail: `Edge-detail score ${metric.toFixed(1)} is low. Stabilize the camera, tap to focus, and retake; glossy or low-detail cards can also lower this estimate.`,
    };
  }
  if (metric < 70) {
    return {
      id: 'blur',
      severity: 'warning',
      label: 'Possible softness',
      detail: `Edge-detail score ${metric.toFixed(1)} is borderline. Zoom into text and corners to confirm focus, and retake if edges are not crisp.`,
    };
  }
  return {
    id: 'blur',
    severity: 'good',
    label: 'Focus appears usable',
    detail: `Edge-detail score ${metric.toFixed(1)} shows useful fine contrast; verify manually on small text and corners.`,
  };
}

function glareCheck(fraction: number): QualityCheck {
  const percent = fraction * 100;
  if (fraction > 0.08) {
    return {
      id: 'glare',
      severity: 'error',
      label: 'Strong glare possible',
      detail: `${percent.toFixed(1)}% of pixels are near-white and low-saturation. Move or diffuse the light and slightly change the camera angle; white card areas may inflate this estimate.`,
    };
  }
  if (fraction > 0.025) {
    return {
      id: 'glare',
      severity: 'warning',
      label: 'Glare may hide detail',
      detail: `${percent.toFixed(1)}% of pixels resemble clipped highlights. Inspect foil and dark areas closely or retake with softer side lighting.`,
    };
  }
  return {
    id: 'glare',
    severity: 'good',
    label: 'No widespread glare detected',
    detail: `${percent.toFixed(1)}% of pixels resemble clipped highlights. Small localized reflections may still need manual review.`,
  };
}

function exposureCheck(
  mean: number,
  darkFraction: number,
  brightFraction: number,
): QualityCheck {
  if (
    mean < 45 ||
    mean > 220 ||
    darkFraction > 0.6 ||
    brightFraction > 0.6
  ) {
    return {
      id: 'exposure',
      severity: 'error',
      label: 'Exposure obscures detail',
      detail: `Average brightness is ${mean.toFixed(0)}/255. Retake with even, diffuse light and avoid clipped shadows or highlights.`,
    };
  }
  if (
    mean < 75 ||
    mean > 195 ||
    darkFraction > 0.35 ||
    brightFraction > 0.35
  ) {
    return {
      id: 'exposure',
      severity: 'warning',
      label: 'Uneven or marginal exposure',
      detail: `Average brightness is ${mean.toFixed(0)}/255. Check that dark borders and pale surface detail are both visible before relying on the image.`,
    };
  }
  return {
    id: 'exposure',
    severity: 'good',
    label: 'Exposure appears balanced',
    detail: `Average brightness is ${mean.toFixed(0)}/255 with no widespread clipping detected.`,
  };
}

function cropCheck(
  edgeDetailFraction: number,
  detailFraction: number,
): QualityCheck {
  const relativeEdgeDetail =
    edgeDetailFraction / Math.max(detailFraction, 0.001);
  if (edgeDetailFraction > 0.14 && relativeEdgeDetail > 1.35) {
    return {
      id: 'crop-margin',
      severity: 'warning',
      label: 'Crop may be tight',
      detail:
        'Strong detail reaches the image boundary, which can indicate a clipped card edge. Leave visible background around all four sides; patterned backgrounds can cause a false warning.',
    };
  }
  return {
    id: 'crop-margin',
    severity: 'good',
    label: 'No obvious tight crop',
    detail:
      'The outer image band does not strongly suggest a clipped edge. Confirm that every card corner and a small background margin are visible.',
  };
}

function renderCorrectedCard(
  image: HTMLImageElement,
  corners: GuideCorners,
): HTMLCanvasElement {
  const source = denormalizeCorners(corners, image.naturalWidth, image.naturalHeight);
  validateCorners(source, image.naturalWidth, image.naturalHeight);
  const topWidth = distance(source.topLeft, source.topRight);
  const bottomWidth = distance(source.bottomLeft, source.bottomRight);
  const leftHeight = distance(source.topLeft, source.bottomLeft);
  const rightHeight = distance(source.topRight, source.bottomRight);
  const rawWidth = (topWidth + bottomWidth) / 2;
  const rawHeight = (leftHeight + rightHeight) / 2;
  const scale = Math.min(
    1,
    RENDER_MAX_DIMENSION / Math.max(rawWidth, rawHeight),
  );
  const canvas = createCanvas(
    Math.max(1, Math.round(rawWidth * scale)),
    Math.max(1, Math.round(rawHeight * scale)),
  );
  const context = getContext(canvas);
  const subdivisions = 16;

  for (let row = 0; row < subdivisions; row += 1) {
    for (let column = 0; column < subdivisions; column += 1) {
      const u0 = column / subdivisions;
      const u1 = (column + 1) / subdivisions;
      const v0 = row / subdivisions;
      const v1 = (row + 1) / subdivisions;
      const source00 = bilinearPoint(source, u0, v0);
      const source10 = bilinearPoint(source, u1, v0);
      const source11 = bilinearPoint(source, u1, v1);
      const source01 = bilinearPoint(source, u0, v1);
      const destination00 = { x: u0 * canvas.width, y: v0 * canvas.height };
      const destination10 = { x: u1 * canvas.width, y: v0 * canvas.height };
      const destination11 = { x: u1 * canvas.width, y: v1 * canvas.height };
      const destination01 = { x: u0 * canvas.width, y: v1 * canvas.height };
      drawMappedTriangle(
        context,
        image,
        [source00, source10, source11],
        [destination00, destination10, destination11],
      );
      drawMappedTriangle(
        context,
        image,
        [source00, source11, source01],
        [destination00, destination11, destination01],
      );
    }
  }
  return canvas;
}

function drawMappedTriangle(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  source: [Point, Point, Point],
  destination: [Point, Point, Point],
): void {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  const determinant =
    s0.x * (s1.y - s2.y) +
    s1.x * (s2.y - s0.y) +
    s2.x * (s0.y - s1.y);
  if (Math.abs(determinant) < 0.000001) {
    throw new Error('The corrected card contains a degenerate mapping triangle.');
  }

  const a =
    (d0.x * (s1.y - s2.y) +
      d1.x * (s2.y - s0.y) +
      d2.x * (s0.y - s1.y)) /
    determinant;
  const c =
    (d0.x * (s2.x - s1.x) +
      d1.x * (s0.x - s2.x) +
      d2.x * (s1.x - s0.x)) /
    determinant;
  const e =
    (d0.x * (s1.x * s2.y - s2.x * s1.y) +
      d1.x * (s2.x * s0.y - s0.x * s2.y) +
      d2.x * (s0.x * s1.y - s1.x * s0.y)) /
    determinant;
  const b =
    (d0.y * (s1.y - s2.y) +
      d1.y * (s2.y - s0.y) +
      d2.y * (s0.y - s1.y)) /
    determinant;
  const d =
    (d0.y * (s2.x - s1.x) +
      d1.y * (s0.x - s2.x) +
      d2.y * (s1.x - s0.x)) /
    determinant;
  const f =
    (d0.y * (s1.x * s2.y - s2.x * s1.y) +
      d1.y * (s2.x * s0.y - s0.x * s2.y) +
      d2.y * (s0.x * s1.y - s1.x * s0.y)) /
    determinant;

  context.save();
  context.beginPath();
  context.moveTo(d0.x, d0.y);
  context.lineTo(d1.x, d1.y);
  context.lineTo(d2.x, d2.y);
  context.closePath();
  context.clip();
  context.setTransform(a, b, c, d, e, f);
  context.drawImage(image, 0, 0);
  context.restore();
}

function denormalizeCorners(
  corners: GuideCorners,
  width: number,
  height: number,
): GuideCorners {
  const normalized = CORNERS.every(
    (corner) =>
      Math.abs(corners[corner].x) <= 1.5 &&
      Math.abs(corners[corner].y) <= 1.5,
  );
  return Object.fromEntries(
    CORNERS.map((corner) => [
      corner,
      {
        x: normalized ? corners[corner].x * width : corners[corner].x,
        y: normalized ? corners[corner].y * height : corners[corner].y,
      },
    ]),
  ) as GuideCorners;
}

function validateCorners(
  corners: GuideCorners,
  width: number,
  height: number,
): void {
  const points = CORNERS.map((corner) => corners[corner]);
  if (
    points.some(
      (point) =>
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.y < 0 ||
        point.x > width ||
        point.y > height,
    )
  ) {
    throw new Error('Corrected corners must lie within the source image.');
  }
  const signs = points.map((point, index) =>
    cross(point, points[(index + 1) % 4], points[(index + 2) % 4]),
  );
  if (
    Math.sign(signs[0]) === 0 ||
    !signs.every(
      (value) =>
        Math.sign(value) === Math.sign(signs[0]) && Math.abs(value) > 0.01,
    )
  ) {
    throw new Error(
      'Corrected corners must form a non-intersecting convex quadrilateral.',
    );
  }
}

function bilinearPoint(corners: GuideCorners, u: number, v: number): Point {
  const top = interpolate(corners.topLeft, corners.topRight, u);
  const bottom = interpolate(corners.bottomLeft, corners.bottomRight, u);
  return interpolate(top, bottom, v);
}

function interpolate(start: Point, end: Point, amount: number): Point {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}

function distance(start: Point, end: Point): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function cross(start: Point, end: Point, point: Point): number {
  return (
    (end.x - start.x) * (point.y - start.y) -
    (end.y - start.y) * (point.x - start.x)
  );
}

function applyFilter(
  canvas: HTMLCanvasElement,
  filter: InspectionFilter,
): void {
  if (filter === 'original') return;
  const context = getContext(canvas);
  const imageData = readPixels(context, canvas.width, canvas.height);
  const { data } = imageData;

  if (filter === 'edges') {
    const luminance = new Float32Array(canvas.width * canvas.height);
    for (let index = 0; index < luminance.length; index += 1) {
      const offset = index * 4;
      luminance[index] =
        0.2126 * data[offset] +
        0.7152 * data[offset + 1] +
        0.0722 * data[offset + 2];
    }
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = (y * canvas.width + x) * 4;
        if (
          x === 0 ||
          y === 0 ||
          x === canvas.width - 1 ||
          y === canvas.height - 1
        ) {
          data[offset] = data[offset + 1] = data[offset + 2] = 255;
          continue;
        }
        const topLeft = luminance[(y - 1) * canvas.width + x - 1];
        const top = luminance[(y - 1) * canvas.width + x];
        const topRight = luminance[(y - 1) * canvas.width + x + 1];
        const left = luminance[y * canvas.width + x - 1];
        const right = luminance[y * canvas.width + x + 1];
        const bottomLeft = luminance[(y + 1) * canvas.width + x - 1];
        const bottom = luminance[(y + 1) * canvas.width + x];
        const bottomRight = luminance[(y + 1) * canvas.width + x + 1];
        const gradientX =
          -topLeft - 2 * left - bottomLeft + topRight + 2 * right + bottomRight;
        const gradientY =
          -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
        const edge = 255 - Math.min(255, Math.hypot(gradientX, gradientY) * 1.3);
        data[offset] = data[offset + 1] = data[offset + 2] = edge;
      }
    }
  } else {
    let contrastLow = 0;
    let contrastHigh = 255;
    if (filter === 'contrast') {
      [contrastLow, contrastHigh] = luminancePercentiles(data, 0.02, 0.98);
      if (contrastHigh - contrastLow < 24) {
        contrastLow = 0;
        contrastHigh = 255;
      }
    }

    for (let offset = 0; offset < data.length; offset += 4) {
      if (filter === 'negative') {
        data[offset] = 255 - data[offset];
        data[offset + 1] = 255 - data[offset + 1];
        data[offset + 2] = 255 - data[offset + 2];
      } else if (filter === 'grayscale') {
        const gray = Math.round(
          0.2126 * data[offset] +
            0.7152 * data[offset + 1] +
            0.0722 * data[offset + 2],
        );
        data[offset] = data[offset + 1] = data[offset + 2] = gray;
      } else if (filter === 'contrast') {
        const range = contrastHigh - contrastLow;
        data[offset] = stretchChannel(data[offset], contrastLow, range);
        data[offset + 1] = stretchChannel(data[offset + 1], contrastLow, range);
        data[offset + 2] = stretchChannel(data[offset + 2], contrastLow, range);
      }
    }
  }

  context.putImageData(imageData, 0, 0);
}

function luminancePercentiles(
  data: Uint8ClampedArray,
  lowPercentile: number,
  highPercentile: number,
): [number, number] {
  const histogram = new Uint32Array(256);
  const pixelCount = data.length / 4;
  for (let offset = 0; offset < data.length; offset += 4) {
    const value = Math.round(
      0.2126 * data[offset] +
        0.7152 * data[offset + 1] +
        0.0722 * data[offset + 2],
    );
    histogram[value] += 1;
  }
  return [
    histogramPercentile(histogram, pixelCount * lowPercentile),
    histogramPercentile(histogram, pixelCount * highPercentile),
  ];
}

function histogramPercentile(
  histogram: Uint32Array,
  target: number,
): number {
  let total = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    total += histogram[value];
    if (total >= target) return value;
  }
  return 255;
}

function stretchChannel(value: number, low: number, range: number): number {
  return Math.max(0, Math.min(255, Math.round(((value - low) / range) * 255)));
}

function reportSideHeight(
  side: InspectionReportSide,
  imageHeight: number,
): number {
  return (
    imageHeight +
    170 +
    side.qualityChecks.length * 66 +
    Math.max(1, side.annotations.length) * 54
  );
}

function drawReportSide(
  context: CanvasRenderingContext2D,
  side: InspectionReportSide,
  image: HTMLImageElement,
  top: number,
  sectionHeight: number,
): void {
  context.fillStyle = '#ffffff';
  context.fillRect(45, top, REPORT_WIDTH - 90, sectionHeight - 24);
  context.strokeStyle = '#d8dce3';
  context.lineWidth = 2;
  context.strokeRect(45, top, REPORT_WIDTH - 90, sectionHeight - 24);
  context.fillStyle = '#14213d';
  context.font = '700 38px sans-serif';
  context.fillText(side.title, 75, top + 54);

  const imageX = 75;
  const imageY = top + 82;
  const imageScale = Math.min(
    REPORT_SIDE_IMAGE_WIDTH / image.naturalWidth,
    REPORT_SIDE_IMAGE_HEIGHT / image.naturalHeight,
  );
  const imageWidth = image.naturalWidth * imageScale;
  const imageHeight = image.naturalHeight * imageScale;
  const drawX = imageX + (REPORT_SIDE_IMAGE_WIDTH - imageWidth) / 2;
  const drawY = imageY + (REPORT_SIDE_IMAGE_HEIGHT - imageHeight) / 2;
  context.fillStyle = '#edf0f4';
  context.fillRect(
    imageX,
    imageY,
    REPORT_SIDE_IMAGE_WIDTH,
    REPORT_SIDE_IMAGE_HEIGHT,
  );
  context.drawImage(image, drawX, drawY, imageWidth, imageHeight);

  side.annotations.forEach((annotation, index) => {
    const x = drawX + clampCoordinate(annotation.x, image.naturalWidth) * imageWidth;
    const y = drawY + clampCoordinate(annotation.y, image.naturalHeight) * imageHeight;
    context.beginPath();
    context.arc(x, y, 18, 0, Math.PI * 2);
    context.fillStyle = '#dc2626';
    context.fill();
    context.fillStyle = '#ffffff';
    context.font = '700 18px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(index + 1), x, y + 1);
    context.textAlign = 'start';
    context.textBaseline = 'alphabetic';
  });

  const detailX = 805;
  let detailY = imageY + 8;
  context.fillStyle = '#14213d';
  context.font = '700 25px sans-serif';
  context.fillText('Centering ratios', detailX, detailY + 24);
  context.font = '23px sans-serif';
  context.fillStyle = '#334155';
  context.fillText(
    `Horizontal: ${formatRatio(side.horizontal)}`,
    detailX,
    detailY + 62,
  );
  context.fillText(
    `Vertical: ${formatRatio(side.vertical)}`,
    detailX,
    detailY + 96,
  );
  detailY += 135;

  context.fillStyle = '#14213d';
  context.font = '700 25px sans-serif';
  context.fillText('Image quality', detailX, detailY);
  detailY += 32;
  side.qualityChecks.forEach((check) => {
    context.fillStyle = severityColor(check.severity);
    context.beginPath();
    context.arc(detailX + 8, detailY - 7, 8, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#263548';
    context.font = '700 20px sans-serif';
    context.fillText(check.label, detailX + 26, detailY);
    context.font = '17px sans-serif';
    context.fillStyle = '#526173';
    detailY = drawWrappedText(
      context,
      check.detail,
      detailX + 26,
      detailY + 24,
      650,
      22,
      2,
    );
    detailY += 18;
  });

  const annotationY = imageY + REPORT_SIDE_IMAGE_HEIGHT + 48;
  context.fillStyle = '#14213d';
  context.font = '700 25px sans-serif';
  context.fillText('Annotations', 75, annotationY);
  if (side.annotations.length === 0) {
    context.font = '20px sans-serif';
    context.fillStyle = '#526173';
    context.fillText('No blemishes annotated.', 75, annotationY + 36);
  } else {
    let lineY = annotationY + 38;
    side.annotations.forEach((annotation, index) => {
      context.fillStyle = '#263548';
      context.font = '700 20px sans-serif';
      context.fillText(
        `${index + 1}. ${annotation.type.replace('-', ' ')}`,
        75,
        lineY,
      );
      context.font = '18px sans-serif';
      context.fillStyle = '#526173';
      drawWrappedText(
        context,
        annotation.note.trim() || 'No note provided.',
        295,
        lineY,
        1160,
        22,
        2,
      );
      lineY += 54;
    });
  }
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = Number.POSITIVE_INFINITY,
): number {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  let line = '';
  let lineCount = 0;
  let currentY = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      context.fillText(line, x, currentY);
      currentY += lineHeight;
      lineCount += 1;
      if (lineCount >= maxLines) return currentY;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line && lineCount < maxLines) {
    context.fillText(line, x, currentY);
    currentY += lineHeight;
  }
  return currentY;
}

function formatRatio(pair: PercentagePair): string {
  return `${pair.first.toFixed(1)} / ${pair.second.toFixed(1)}`;
}

function severityColor(severity: QualityCheck['severity']): string {
  if (severity === 'error') return '#dc2626';
  if (severity === 'warning') return '#d97706';
  return '#15803d';
}

function clampCoordinate(value: number, sourceDimension: number): number {
  const normalized = Math.abs(value) <= 1.5 ? value : value / sourceDimension;
  return Math.max(0, Math.min(1, normalized));
}

function formatDate(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 'at an unknown time' : date.toLocaleString();
}

function formatGrade(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function positiveDimension(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function explicitError(error: unknown, fallback: string): Error {
  return error instanceof Error && error.message
    ? new Error(`${fallback} ${error.message}`)
    : new Error(fallback);
}
