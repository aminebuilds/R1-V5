import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setHeatmapMode,
  getHeatmapMode,
  toggleHeatmapVisibility,
  isHeatmapVisible,
} from './competitiveHeatmap.js';

test('setHeatmapMode validates and updates active mode', () => {
  assert.equal(setHeatmapMode('traffic'), 'traffic');
  assert.equal(getHeatmapMode(), 'traffic');

  assert.equal(setHeatmapMode('competitor'), 'competitor');
  assert.equal(getHeatmapMode(), 'competitor');

  assert.equal(setHeatmapMode('opportunity'), 'opportunity');
  assert.equal(getHeatmapMode(), 'opportunity');

  // Invalid mode preserves previous
  setHeatmapMode('invalid_mode');
  assert.equal(getHeatmapMode(), 'opportunity');
});

test('toggleHeatmapVisibility updates state properly', () => {
  const current = isHeatmapVisible();
  const toggled = toggleHeatmapVisibility();
  assert.equal(toggled, !current);

  toggleHeatmapVisibility(true);
  assert.equal(isHeatmapVisible(), true);

  toggleHeatmapVisibility(false);
  assert.equal(isHeatmapVisible(), false);
});
