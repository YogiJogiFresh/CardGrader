import assert from 'node:assert/strict';
import {
  computeCornerAgreement,
  computeVisibleSourceRect,
  constrainPointToGuide,
  mapVisibleGuideToSource,
  validateGuideCorners,
} from '../apps/web/src/captureGeometry.mjs';

const landscapeViewport = computeVisibleSourceRect(1920, 1080, 0.75);
assert.deepEqual(landscapeViewport, {
  x: 555,
  y: 0,
  width: 810,
  height: 1080,
});

const portraitViewport = computeVisibleSourceRect(1080, 1920, 0.75);
assert.deepEqual(portraitViewport, {
  x: 0,
  y: 240,
  width: 1080,
  height: 1440,
});

const guide = {
  topLeft: { x: 0.13, y: 0.11 },
  topRight: { x: 0.87, y: 0.11 },
  bottomRight: { x: 0.87, y: 0.89 },
  bottomLeft: { x: 0.13, y: 0.89 },
};
validateGuideCorners(guide);
const landscapeSourceGuide = mapVisibleGuideToSource(
  1920,
  1080,
  0.75,
  guide,
);
assert.ok(
  Math.abs(
    (landscapeSourceGuide.topLeft.x +
      landscapeSourceGuide.topRight.x) /
      2 -
      0.5,
  ) < 0.0001,
);
assert.ok(landscapeSourceGuide.topLeft.x > guide.topLeft.x);
assert.ok(landscapeSourceGuide.topRight.x < guide.topRight.x);
assert.equal(landscapeSourceGuide.topLeft.y, guide.topLeft.y);

const portraitSourceGuide = mapVisibleGuideToSource(
  1080,
  1920,
  0.75,
  guide,
);
assert.equal(portraitSourceGuide.topLeft.x, guide.topLeft.x);
assert.ok(portraitSourceGuide.topLeft.y > guide.topLeft.y);
assert.ok(portraitSourceGuide.bottomLeft.y < guide.bottomLeft.y);

const constrained = constrainPointToGuide(
  { x: 0.4, y: 0.4 },
  { x: 0.7, y: 0.7 },
  1,
  0.05,
);
assert.ok(Math.hypot(constrained.x - 0.4, constrained.y - 0.4) <= 0.050001);

assert.equal(computeCornerAgreement(guide, []), 0);
assert.ok(computeCornerAgreement(guide, [guide]) > 0.999);
assert.ok(
  computeCornerAgreement(guide, [
    {
      topLeft: { x: 0.2, y: 0.18 },
      topRight: { x: 0.8, y: 0.18 },
      bottomRight: { x: 0.8, y: 0.82 },
      bottomLeft: { x: 0.2, y: 0.82 },
    },
  ]) < 0.1,
);

assert.throws(() =>
  validateGuideCorners({
    topLeft: { x: 0.2, y: 0.2 },
    topRight: { x: 0.8, y: 0.8 },
    bottomRight: { x: 0.8, y: 0.2 },
    bottomLeft: { x: 0.2, y: 0.8 },
  }),
);

console.log('Guide geometry tests passed.');
