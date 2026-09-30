'use strict';
const { buildEstimate } = require('../lib/estimate/buildEstimate');
const { estimateLocation } = require('../lib/estimate/unitPrices');
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { planSpec, surveyData = {} } = req.body || {};
    if (!Array.isArray(planSpec?.levels) || !planSpec.levels.length) return res.status(400).json({ message: 'A saved floor plan is required.' });
    const location = estimateLocation(surveyData.estimateLocation);
    return res.json({ estimate: buildEstimate(planSpec, { surveyData: { ...surveyData, estimateLocation: location } }) });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.status === 400 ? error.message : 'Could not calculate the estimate.' });
  }
};
