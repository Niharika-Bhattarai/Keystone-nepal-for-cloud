'use strict';
const { preflightSurvey } = require('../lib/surveyPreflight');
const { isNepalSurvey, preflightNepal } = require('../lib/nepal/preflight');
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success:false, message:'Method not allowed.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const survey = body?.surveyData || body;
    if (!survey || typeof survey !== 'object' || Array.isArray(survey)) return res.status(400).json({ success:false, message:'A survey object is required.' });
    return res.status(200).json({ success:true, ...(isNepalSurvey(survey) ? preflightNepal(survey) : preflightSurvey(survey)) });
  } catch (error) {
    return res.status(400).json({ success:false, message:'The survey could not be read. Check its values and try again.' });
  }
};
