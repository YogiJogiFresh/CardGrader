import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error(
    'Usage: npm run calibrate:centering -- <path-to-calibration-results.json>',
  );
  process.exitCode = 1;
} else {
  const payload = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
  if (!Array.isArray(payload.cases) || payload.cases.length === 0) {
    throw new Error('Calibration input must contain at least one case.');
  }
  const cases = payload.cases.map(validateCase);
  const metrics = cases.map(measureCase);
  const confidenceBins = [0, 0.25, 0.5, 0.75].map((minimum) => {
    const maximum = minimum + 0.25;
    const values = metrics.filter(
      (metric) =>
        metric.confidence >= minimum &&
        (maximum === 1
          ? metric.confidence <= maximum
          : metric.confidence < maximum),
    );
    return {
      confidence: `${minimum.toFixed(2)}-${maximum.toFixed(2)}`,
      count: values.length,
      meanCornerErrorPercent: average(
        values.map((value) => value.cornerErrorPercent),
      ),
      meanCenteringErrorPoints: average(
        values.map((value) => value.centeringErrorPoints),
      ),
    };
  });
  console.log(
    JSON.stringify(
      {
        count: metrics.length,
        meanCornerErrorPercent: average(
          metrics.map((metric) => metric.cornerErrorPercent),
        ),
        p95CornerErrorPercent: percentile(
          metrics.map((metric) => metric.cornerErrorPercent),
          0.95,
        ),
        meanCenteringErrorPoints: average(
          metrics.map((metric) => metric.centeringErrorPoints),
        ),
        p95CenteringErrorPoints: percentile(
          metrics.map((metric) => metric.centeringErrorPoints),
          0.95,
        ),
        automaticDetectionRate:
          metrics.filter((metric) => metric.method === 'automatic').length /
          metrics.length,
        confidenceBins,
        cases: metrics,
      },
      null,
      2,
    ),
  );
}

function validateCase(value, index) {
  if (
    !value ||
    typeof value.id !== 'string' ||
    !Number.isFinite(value.width) ||
    !Number.isFinite(value.height) ||
    !value.expected ||
    !value.actual
  ) {
    throw new Error(`Calibration case ${index + 1} is incomplete.`);
  }
  validateCorners(value.expected.outerCorners, `${value.id} expected outer`);
  validateCorners(value.actual.outerCorners, `${value.id} actual outer`);
  validateCentering(value.expected.centering, `${value.id} expected centering`);
  validateCentering(value.actual.centering, `${value.id} actual centering`);
  return value;
}

function validateCorners(corners, label) {
  for (const name of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']) {
    if (
      !corners?.[name] ||
      !Number.isFinite(corners[name].x) ||
      !Number.isFinite(corners[name].y)
    ) {
      throw new Error(`${label} is missing ${name}.`);
    }
  }
}

function validateCentering(centering, label) {
  for (const name of ['leftPercent', 'rightPercent', 'topPercent', 'bottomPercent']) {
    if (!Number.isFinite(centering?.[name])) {
      throw new Error(`${label} is missing ${name}.`);
    }
  }
}

function measureCase(value) {
  const diagonal = Math.hypot(value.width, value.height);
  const expectedCorners = Object.values(value.expected.outerCorners);
  const actualCorners = Object.values(value.actual.outerCorners);
  const cornerErrorPercent =
    (average(
      expectedCorners.map((expected, index) =>
        Math.hypot(
          expected.x - actualCorners[index].x,
          expected.y - actualCorners[index].y,
        ),
      ),
    ) /
      diagonal) *
    100;
  const centeringErrorPoints = average(
    ['leftPercent', 'rightPercent', 'topPercent', 'bottomPercent'].map((name) =>
      Math.abs(
        value.expected.centering[name] - value.actual.centering[name],
      ),
    ),
  );
  return {
    id: value.id,
    method: value.actual.method,
    confidence: clamp(value.actual.confidence, 0, 1),
    cornerErrorPercent,
    centeringErrorPoints,
  };
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, quantile) {
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1),
  );
  return sorted[index];
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
