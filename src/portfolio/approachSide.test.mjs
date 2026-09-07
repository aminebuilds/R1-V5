import test from 'node:test';
import assert from 'node:assert/strict';

import {
  approachSideForSite,
  closestEdge,
  edgeBearingDeg,
  bearingDelta,
  drivingSideForCoords,
  hasOpposingCarriageway,
  toLocalMeters,
} from './approachSide.js';

/** A north-running road at lon -97.7431, from lat 30.2660 to 30.2690. */
const NORTHBOUND = {
  coords: [[-97.7431, 30.2660], [-97.7431, 30.2690]],
};
/** Its antiparallel twin, ~30 m east — a divided carriageway. */
const SOUTHBOUND = {
  coords: [[-97.74279, 30.2690], [-97.74279, 30.2660]],
};

test('toLocalMeters places east and north correctly', () => {
  const east = toLocalMeters(30.2672, -97.7421, 30.2672, -97.7431);
  assert.ok(east.x > 0, 'a larger longitude is east');
  assert.ok(Math.abs(east.y) < 1);

  const north = toLocalMeters(30.2682, -97.7431, 30.2672, -97.7431);
  assert.ok(north.y > 0, 'a larger latitude is north');
});

test('edgeBearingDeg reads clockwise from north', () => {
  assert.equal(Math.round(edgeBearingDeg({ x: 0, y: 0 }, { x: 0, y: 10 })), 0);
  assert.equal(Math.round(edgeBearingDeg({ x: 0, y: 0 }, { x: 10, y: 0 })), 90);
  assert.equal(Math.round(edgeBearingDeg({ x: 0, y: 0 }, { x: 0, y: -10 })), 180);
});

test('bearingDelta wraps around 360', () => {
  assert.equal(bearingDelta(10, 350), 20);
  assert.equal(bearingDelta(0, 180), 180);
  assert.equal(bearingDelta(90, 90), 0);
});

test('closestEdge returns the perpendicular distance to the polyline', () => {
  // A site ~96 m east of the northbound carriageway, level with its middle.
  const edge = closestEdge(NORTHBOUND.coords, { lat: 30.2675, lon: -97.7421 });
  assert.ok(edge);
  assert.ok(edge.distanceM > 80 && edge.distanceM < 110, `got ${edge.distanceM}`);
});

test('closestEdge rejects degenerate input', () => {
  assert.equal(closestEdge([], { lat: 1, lon: 1 }), null);
  assert.equal(closestEdge([[0, 0]], { lat: 1, lon: 1 }), null);
  assert.equal(closestEdge(NORTHBOUND.coords, null), null);
});

test('a site east of a northbound road is on the right of travel', () => {
  const site = { lat: 30.2675, lon: -97.7421 };
  const result = approachSideForSite(site, NORTHBOUND, [NORTHBOUND, SOUTHBOUND]);
  assert.equal(result.side, 'right');
});

test('a site west of a northbound road is on the left of travel', () => {
  const site = { lat: 30.2675, lon: -97.7441 };
  const result = approachSideForSite(site, NORTHBOUND, [NORTHBOUND, SOUTHBOUND]);
  assert.equal(result.side, 'left');
});

test('reversing the coordinate order flips the side', () => {
  const site = { lat: 30.2675, lon: -97.7421 };
  const reversed = { coords: [...NORTHBOUND.coords].reverse() };
  const forward = approachSideForSite(site, NORTHBOUND, [NORTHBOUND, SOUTHBOUND]);
  const backward = approachSideForSite(site, reversed, [reversed, SOUTHBOUND]);
  assert.notEqual(forward.side, backward.side);
});

test('hasOpposingCarriageway finds an antiparallel twin', () => {
  assert.equal(hasOpposingCarriageway(NORTHBOUND, [NORTHBOUND, SOUTHBOUND]), true);
});

test('hasOpposingCarriageway is false for a lone feature', () => {
  assert.equal(hasOpposingCarriageway(NORTHBOUND, [NORTHBOUND]), false);
});

test('hasOpposingCarriageway ignores a parallel same-direction road', () => {
  const parallelSameWay = { coords: [[-97.74279, 30.2660], [-97.74279, 30.2690]] };
  assert.equal(hasOpposingCarriageway(NORTHBOUND, [NORTHBOUND, parallelSameWay]), false);
});

test('approach stays ambiguous on an undivided road', () => {
  const site = { lat: 30.2675, lon: -97.7421 };
  const result = approachSideForSite(site, NORTHBOUND, [NORTHBOUND]);
  // Geometry is still reported — it is real — but its MEANING is not
  // recoverable, because coordinate order on an undivided road is an
  // arbitrary digitisation artefact.
  assert.equal(result.divided, false);
  assert.equal(result.approach, 'ambiguous');
  assert.ok(['left', 'right'].includes(result.side));
});

test('approach is ambiguous when the full segment set is withheld', () => {
  const site = { lat: 30.2675, lon: -97.7421 };
  const result = approachSideForSite(site, NORTHBOUND);
  assert.equal(result.approach, 'ambiguous');
});

test('near side follows the driving side on a divided road', () => {
  const east = { lat: 30.2675, lon: -97.7421 }; // right of northbound travel
  const rightHand = approachSideForSite(east, NORTHBOUND, [NORTHBOUND, SOUTHBOUND], { drivingSide: 'right' });
  assert.equal(rightHand.approach, 'near');

  const leftHand = approachSideForSite(east, NORTHBOUND, [NORTHBOUND, SOUTHBOUND], { drivingSide: 'left' });
  assert.equal(leftHand.approach, 'far');
});

test('drivingSideForCoords knows the major left-hand regions', () => {
  assert.equal(drivingSideForCoords(51.5, -0.12), 'left');   // London
  assert.equal(drivingSideForCoords(-33.87, 151.2), 'left'); // Sydney
  assert.equal(drivingSideForCoords(35.68, 139.7), 'left');  // Tokyo
  assert.equal(drivingSideForCoords(30.27, -97.74), 'right');// Austin
  assert.equal(drivingSideForCoords(48.85, 2.35), 'right');  // Paris
});

test('drivingSideForCoords defaults to right for unusable coordinates', () => {
  assert.equal(drivingSideForCoords(NaN, NaN), 'right');
});

test('offset distance is reported in metres', () => {
  const site = { lat: 30.2675, lon: -97.7421 };
  const result = approachSideForSite(site, NORTHBOUND, [NORTHBOUND, SOUTHBOUND]);
  assert.ok(Number.isFinite(result.offsetM));
  assert.ok(result.offsetM > 80 && result.offsetM < 110);
});
