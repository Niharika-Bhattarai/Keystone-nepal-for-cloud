import test from 'node:test';
import assert from 'node:assert/strict';
import { modelGroup, modelGroupVisible } from '../src/site/modelVisibility.js';

test('classifies quick and Blender material-split ceiling meshes through parents', () => {
  for (const name of ['Ceiling 2', 'Ceiling 2.001', 'Ceiling 2_primitive0', 'Ceiling 2 wall-paint']) assert.equal(modelGroup({ name }), 'Ceiling 2');
  assert.equal(modelGroup({ name: 'primitive0', parent: { name: 'Ceiling 1' } }), 'Ceiling 1');
  assert.equal(modelGroup({ name: 'Rooflight' }), 'other');
});
test('whole house, open roof, floor cutaway and restoration preserve the right envelopes', () => {
  const levels = [{ level: 1 }, { level: 2 }, { level: 3 }];
  const visible = (upTo, roof) => ['Roof', 'Ceiling 1', 'Ceiling 2', 'Ceiling 3', 'Level 1', 'Level 2', 'Level 3', 'Furniture 3', 'Lawn'].filter(n => modelGroupVisible(n, upTo, roof, levels));
  assert.equal(visible(99, true).length, 9);
  assert.deepEqual(visible(99, false), ['Ceiling 1', 'Ceiling 2', 'Level 1', 'Level 2', 'Level 3', 'Furniture 3', 'Lawn']);
  assert.deepEqual(visible(2, true), ['Ceiling 1', 'Level 1', 'Level 2', 'Lawn']);
  assert.deepEqual(visible(1, false), ['Level 1', 'Lawn']);
  assert.equal(visible(99, true).length, 9, 'switching back restores every ceiling');
  assert.equal(modelGroupVisible('Ceiling 1', 99, false, [{ level: 1 }]), false);
  assert.equal(modelGroupVisible('Ceiling 2', 3, false, [{ level: 2 }, { level: 4 }]), false, 'exposed floor is determined from available levels');
});
