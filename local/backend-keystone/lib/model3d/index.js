'use strict';

// Plan -> 3D house model. See buildModel.js for the geometry rules and
// writers.js for the GLB / OBJ output.
const { buildModel } = require('./buildModel');
const { toGlb, toObj } = require('./writers');

module.exports = { buildModel, toGlb, toObj };
