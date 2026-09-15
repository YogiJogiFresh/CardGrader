export function computeVisibleSourceRect(
  sourceWidth,
  sourceHeight,
  viewportAspectRatio,
) {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error('Source dimensions must be positive.');
  }
  const sourceAspectRatio = sourceWidth / sourceHeight;
  const targetAspectRatio =
    Number.isFinite(viewportAspectRatio) && viewportAspectRatio > 0
      ? viewportAspectRatio
      : sourceAspectRatio;
  let x = 0;
  let y = 0;
  let width = sourceWidth;
  let height = sourceHeight;
  if (sourceAspectRatio > targetAspectRatio) {
    width = sourceHeight * targetAspectRatio;
    x = (sourceWidth - width) / 2;
  } else if (sourceAspectRatio < targetAspectRatio) {
    height = sourceWidth / targetAspectRatio;
    y = (sourceHeight - height) / 2;
  }
  return { x, y, width, height };
}

export function mapVisibleGuideToSource(
  sourceWidth,
  sourceHeight,
  viewportAspectRatio,
  guideCorners,
) {
  validateGuideCorners(guideCorners);
  const visible = computeVisibleSourceRect(
    sourceWidth,
    sourceHeight,
    viewportAspectRatio,
  );
  const remap = (point) => ({
    x: clampUnit(
      (visible.x + point.x * visible.width) / sourceWidth,
    ),
    y: clampUnit(
      (visible.y + point.y * visible.height) / sourceHeight,
    ),
  });
  return {
    topLeft: remap(guideCorners.topLeft),
    topRight: remap(guideCorners.topRight),
    bottomRight: remap(guideCorners.bottomRight),
    bottomLeft: remap(guideCorners.bottomLeft),
  };
}

export function constrainPointToGuide(
  guide,
  detected,
  strength,
  maximumShift,
) {
  const deltaX = detected.x - guide.x;
  const deltaY = detected.y - guide.y;
  const distance = Math.hypot(deltaX, deltaY);
  const scale = distance > maximumShift ? maximumShift / distance : 1;
  return {
    x: clampUnit(guide.x + deltaX * scale * strength),
    y: clampUnit(guide.y + deltaY * scale * strength),
  };
}

export function computeCornerAgreement(candidate, peers, tolerance = 0.025) {
  if (peers.length === 0) return 0;
  const names = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
  return (
    peers.reduce((sum, peer) => {
      const distance =
        names.reduce(
          (cornerSum, name) =>
            cornerSum +
            Math.hypot(
              candidate[name].x - peer[name].x,
              candidate[name].y - peer[name].y,
            ),
          0,
        ) / names.length;
      return sum + Math.exp(-distance / tolerance);
    }, 0) / peers.length
  );
}

export function validateGuideCorners(corners) {
  const points = [
    corners?.topLeft,
    corners?.topRight,
    corners?.bottomRight,
    corners?.bottomLeft,
  ];
  if (
    points.some(
      (point) =>
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.x > 1 ||
        point.y < 0 ||
        point.y > 1,
    )
  ) {
    throw new Error('Guide corners must be finite normalized coordinates.');
  }
  let sign = 0;
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index];
    const second = points[(index + 1) % points.length];
    const third = points[(index + 2) % points.length];
    doubledArea += first.x * second.y - second.x * first.y;
    const cross =
      (second.x - first.x) * (third.y - second.y) -
      (second.y - first.y) * (third.x - second.x);
    if (Math.abs(cross) < 1e-6) {
      throw new Error('Guide corners must form a non-degenerate quadrilateral.');
    }
    const nextSign = Math.sign(cross);
    if (sign && nextSign !== sign) {
      throw new Error('Guide corners must form a convex quadrilateral.');
    }
    sign = nextSign;
  }
  if (Math.abs(doubledArea) < 0.02) {
    throw new Error('Guide quadrilateral is too small.');
  }
}

function clampUnit(value) {
  return Math.min(1, Math.max(0, value));
}
