import test from 'node:test';
import assert from 'node:assert/strict';

import { LOOP_MIN_COPIES, loopNormalize } from '../scroll.js';

test('loopNormalize maps scroll positions into the anchor band', () => {
  const period = 1000;

  assert.equal(loopNormalize(2400, period, LOOP_MIN_COPIES), 1400);
  assert.equal(loopNormalize(400, period, LOOP_MIN_COPIES), 1400);
  assert.equal(loopNormalize(1400, period, LOOP_MIN_COPIES), 1400);
});

test('loopNormalize returns null when looping is not active', () => {
  assert.equal(loopNormalize(500, 0, LOOP_MIN_COPIES), null);
  assert.equal(loopNormalize(500, 1000, LOOP_MIN_COPIES - 1), null);
});
