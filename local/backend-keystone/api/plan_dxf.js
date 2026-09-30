'use strict';
const { buildDxf } = require('../lib/cad/buildDxf');
module.exports = (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });
  try {
    const result = buildDxf(req.body?.planSpec);
    res.setHeader('Content-Type', 'application/dxf');
    res.setHeader('Content-Disposition', 'attachment; filename="keystone-ai-concept.dxf"');
    res.setHeader('X-Keystone-Dxf-Version', result.version);
    return res.status(200).send(result.dxf);
  } catch (error) {
    const invalid = error.code === 'DXF_INPUT_INVALID';
    return res.status(invalid ? 400 : 500).json({ success: false,
      message: invalid ? error.message : 'The CAD drawing could not be exported.' });
  }
};
