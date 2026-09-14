const CARD_ASPECT = 2.5 / 3.5;
const CORNER_NAMES = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];

export function orderContourCorners(points, width, height) {
  if (!Array.isArray(points) || points.length !== 4) {
    throw new Error('A card contour must contain exactly four corners.');
  }
  const normalized = points.map((point) => ({
    x: point.x / width,
    y: point.y / height,
  }));
  const center = {
    x: average(normalized.map((point) => point.x)),
    y: average(normalized.map((point) => point.y)),
  };
  const clockwise = [...normalized].sort(
    (first, second) =>
      Math.atan2(first.y - center.y, first.x - center.x) -
      Math.atan2(second.y - center.y, second.x - center.x),
  );
  const topLeftIndex = clockwise.reduce(
    (bestIndex, point, index) =>
      point.x + point.y <
      clockwise[bestIndex].x + clockwise[bestIndex].y
        ? index
        : bestIndex,
    0,
  );
  const ordered = clockwise
    .slice(topLeftIndex)
    .concat(clockwise.slice(0, topLeftIndex));
  const corners = {
    topLeft: ordered[0],
    topRight: ordered[1],
    bottomRight: ordered[2],
    bottomLeft: ordered[3],
  };
  if (!isConvexQuad(corners)) {
    throw new Error('Contour corners do not form a convex quadrilateral.');
  }
  return corners;
}

export function contourCandidateMetrics(
  corners,
  guide,
  sideCoverage,
  width,
  height,
) {
  const pixelCorners = scaleCorners(corners, width, height);
  const widths = [
    distance(pixelCorners.topLeft, pixelCorners.topRight),
    distance(pixelCorners.bottomLeft, pixelCorners.bottomRight),
  ];
  const heights = [
    distance(pixelCorners.topLeft, pixelCorners.bottomLeft),
    distance(pixelCorners.topRight, pixelCorners.bottomRight),
  ];
  const aspect =
    average(widths) / Math.max(0.0001, average(heights));
  const aspectScore = Math.exp(
    -Math.abs(Math.log(aspect / CARD_ASPECT)) * 3.2,
  );
  const oppositeScore =
    (Math.min(...widths) / Math.max(...widths)) *
    (Math.min(...heights) / Math.max(...heights));
  const angleScore = average([
    rightAngleScore(
      pixelCorners.bottomLeft,
      pixelCorners.topLeft,
      pixelCorners.topRight,
    ),
    rightAngleScore(
      pixelCorners.topLeft,
      pixelCorners.topRight,
      pixelCorners.bottomRight,
    ),
    rightAngleScore(
      pixelCorners.topRight,
      pixelCorners.bottomRight,
      pixelCorners.bottomLeft,
    ),
    rightAngleScore(
      pixelCorners.bottomRight,
      pixelCorners.bottomLeft,
      pixelCorners.topLeft,
    ),
  ]);
  const geometryScore = clamp(oppositeScore * 0.48 + angleScore * 0.52);
  const guideDistance = guide ? cornerDistance(corners, guide) : 0;
  const guideScore = guide ? Math.exp(-guideDistance / 0.065) : 1;
  const minimumSideCoverage = Math.min(...sideCoverage);
  const meanSideCoverage = average(sideCoverage);
  return {
    aspectScore,
    geometryScore,
    guideDistance,
    guideScore,
    minimumSideCoverage,
    meanSideCoverage,
  };
}

function scaleCorners(corners, width, height) {
  return Object.fromEntries(
    CORNER_NAMES.map((name) => [
      name,
      {
        x: corners[name].x * width,
        y: corners[name].y * height,
      },
    ]),
  );
}

export function contourAgreement(candidate, peers, tolerance = 0.025) {
  if (peers.length === 0) return 0;
  return average(
    peers.map((peer) =>
      Math.exp(-cornerDistance(candidate, peer) / tolerance),
    ),
  );
}

export function polygonArea(corners) {
  const points = CORNER_NAMES.map((name) => corners[name]);
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    sum += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(sum) / 2;
}

export function isConvexQuad(corners) {
  const points = CORNER_NAMES.map((name) => corners[name]);
  let sign = 0;
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index];
    const second = points[(index + 1) % points.length];
    const third = points[(index + 2) % points.length];
    const cross =
      (second.x - first.x) * (third.y - second.y) -
      (second.y - first.y) * (third.x - second.x);
    if (Math.abs(cross) < 1e-6) return false;
    const nextSign = Math.sign(cross);
    if (sign && nextSign !== sign) return false;
    sign = nextSign;
  }
  return polygonArea(corners) >= 0.04;
}

function cornerDistance(first, second) {
  return average(
    CORNER_NAMES.map((name) => distance(first[name], second[name])),
  );
}

function rightAngleScore(previous, corner, next) {
  const first = {
    x: previous.x - corner.x,
    y: previous.y - corner.y,
  };
  const second = {
    x: next.x - corner.x,
    y: next.y - corner.y,
  };
  const denominator =
    Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);
  if (denominator <= 1e-6) return 0;
  return Math.exp(-Math.abs((first.x * second.x + first.y * second.y) / denominator) * 4);
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value) {
  return Math.min(1, Math.max(0, value));
}
