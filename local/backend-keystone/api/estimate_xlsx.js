'use strict';

const { buildEstimateWorkbook } = require('../lib/estimate/exportEstimateXlsx');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

module.exports = function estimateXlsxHandler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    const { surveyData, planSpec, estimate, exportMeta } = req.body || {};
    if (!planSpec || typeof planSpec !== 'object') {
      return res.status(400).json({ success: false, message: 'planSpec is required' });
    }

    require('../lib/estimate/unitPrices').estimateLocation(surveyData?.estimateLocation);
    const workbook = buildEstimateWorkbook({ surveyData, planSpec, estimate, exportMeta });
    res.setHeader('Content-Type', workbook.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${workbook.filename}"`);
    res.setHeader('Content-Length', String(workbook.buffer.length));
    return res.status(200).send(workbook.buffer);
  } catch (error) {
    const message = String(error?.message || 'Failed to generate XLSX export');
    const status = error.status === 400 || message.includes('required') || message.includes('No estimate') ? 400 : 500;
    return res.status(status).json({
      success: false,
      message: status === 500 ? 'Failed to generate XLSX export.' : message,
      detail: status === 500 ? undefined : message,
    });
  }
};
