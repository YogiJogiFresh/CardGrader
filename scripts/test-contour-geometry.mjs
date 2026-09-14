import assert from 'node:assert/strict';
import {
  contourAgreement,
  contourCandidateMetrics,
  isConvexQuad,
  orderContourCorners,
  polygonArea,
} from '../apps/web/src/cardContourGeometry.mjs';

const guide = {
  topLeft: { x: 0.22, y: 0.1 },
  topRight: { x: 0.78, y: 0.11 },
  bottomRight: { x: 0.77, y: 0.9 },
  bottomLeft: { x: 0.23, y: 0.89 },
};

const ordered = orderContourCorners(
  [
    { x: 770, y: 900 },
    { x: 220, y: 100 },
    { x: 230, y: 890 },
    { x: 780, y: 110 },
  ],
  1000,
  1000,
);
assert.deepEqual(ordered, guide);
assert.equal(isConvexQuad(ordered), true);
assert.ok(polygonArea(ordered) > 0.42);

const complete = contourCandidateMetrics(
  guide,
  guide,
  [0.88, 0.84, 0.86, 0.82],
  1000,
  1000,
);
assert.ok(complete.aspectScore > 0.9);
assert.ok(complete.geometryScore > 0.9);
assert.equal(complete.minimumSideCoverage, 0.82);
assert.ok(complete.meanSideCoverage > 0.84);
assert.ok(complete.guideScore > 0.999);

const missingSide = contourCandidateMetrics(
  guide,
  guide,
  [0.9, 0.86, 0.88, 0.08],
  1000,
  1000,
);
assert.equal(missingSide.minimumSideCoverage, 0.08);
assert.ok(missingSide.meanSideCoverage > 0.6);

const portraitCard = orderContourCorners(
  [
    { x: 125, y: 150 },
    { x: 625, y: 150 },
    { x: 625, y: 850 },
    { x: 125, y: 850 },
  ],
  750,
  1000,
);
const portraitMetrics = contourCandidateMetrics(
  portraitCard,
  undefined,
  [0.9, 0.9, 0.9, 0.9],
  750,
  1000,
);
assert.ok(portraitMetrics.aspectScore > 0.999);
assert.ok(portraitMetrics.geometryScore > 0.999);

const rotated = orderContourCorners(
  [
    { x: 260, y: 80 },
    { x: 660, y: 380 },
    { x: 240, y: 940 },
    { x: -160, y: 640 },
  ],
  750,
  1000,
);
assert.equal(isConvexQuad(rotated), true);

assert.ok(contourAgreement(guide, [guide]) > 0.999);
assert.equal(contourAgreement(guide, []), 0);
assert.ok(
  contourAgreement(guide, [
    {
      topLeft: { x: 0.05, y: 0.05 },
      topRight: { x: 0.95, y: 0.05 },
      bottomRight: { x: 0.95, y: 0.95 },
      bottomLeft: { x: 0.05, y: 0.95 },
    },
  ]) < 0.02,
);

assert.equal(
  isConvexQuad({
    topLeft: { x: 0.2, y: 0.2 },
    topRight: { x: 0.8, y: 0.8 },
    bottomRight: { x: 0.8, y: 0.2 },
    bottomLeft: { x: 0.2, y: 0.8 },
  }),
  false,
);

console.log('Contour geometry tests passed.');
