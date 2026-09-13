import assert from 'node:assert/strict';
import {
  computeCornerAgreement,
  computeSymmetricGuideCrop,
  computeVisibleSourceRect,
  constrainPointToGuide,
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
const crop = computeSymmetricGuideCrop(1080, 1440, guide);
const remappedPoints = Object.values(crop.guideCorners);
const remappedLeft = Math.min(...remappedPoints.map((point) => point.x));
const remappedRight = Math.max(...remappedPoints.map((point) => point.x));
const remappedTop = Math.min(...remappedPoints.map((point) => point.y));
const remappedBottom = Math.max(...remappedPoints.map((point) => point.y));
assert.ok(Math.abs((remappedLeft + remappedRight) / 2 - 0.5) < 0.002);
assert.ok(Math.abs((remappedTop + remappedBottom) / 2 - 0.5) < 0.002);
assert.ok(remappedLeft > 0.1 && remappedRight < 0.9);
assert.ok(remappedTop > 0.1 && remappedBottom < 0.9);

const offCenterGuide = {
  topLeft: { x: 0.04, y: 0.2 },
  topRight: { x: 0.54, y: 0.2 },
  bottomRight: { x: 0.54, y: 0.8 },
  bottomLeft: { x: 0.04, y: 0.8 },
};
const offCenterCrop = computeSymmetricGuideCrop(
  1200,
  1600,
  offCenterGuide,
);
const offCenterPoints = Object.values(offCenterCrop.guideCorners);
const offCenterLeft = Math.min(...offCenterPoints.map((point) => point.x));
const offCenterRight = Math.max(...offCenterPoints.map((point) => point.x));
assert.ok(Math.abs((offCenterLeft + offCenterRight) / 2 - 0.5) < 0.002);

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
