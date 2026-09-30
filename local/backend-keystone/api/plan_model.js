'use strict';

// POST /api/plan/model  { planSpec, format?: 'glb' | 'obj', roofKind? }
// Returns the plan as a 3D model: binary glTF (model/gltf-binary) by
// default, or OBJ + MTL as JSON { obj, mtl } when format is 'obj'.
// Pure geometry from the plan the engine already produced; ~20 ms for a
// two-storey house, no rendering on the server.
const { buildModel, toGlb, toObj } = require('../lib/model3d');

const MAX_LEVELS = 6;

module.exports = function planModelHandler(req, res) {
  const { planSpec, format = 'glb', roofKind } = req.body || {};
  if (!planSpec || !Array.isArray(planSpec.levels) || !planSpec.levels.length || planSpec.levels.length > MAX_LEVELS) {
    return res.status(400).json({ success: false, message: 'A generated floor plan is required.' });
  }
  try {
    const model = buildModel(planSpec, { roofKind: typeof roofKind === 'string' ? roofKind : undefined });
    if (format === 'obj') {
      const { obj, mtl } = toObj(model);
      return res.json({ success: true, obj, mtl, stats: model.stats });
    }
    const glb = toGlb(model);
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Content-Disposition', 'inline; filename="house.glb"');
    res.setHeader('X-Model-Triangles', String(model.stats.triangles));
    return res.status(200).send(glb);
  } catch (error) {
    console.error('[plan/model]', error);
    return res.status(422).json({ success: false, message: 'Unable to build a 3D model for this plan.' });
  }
};
