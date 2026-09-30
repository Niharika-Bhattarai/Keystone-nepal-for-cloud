'use strict';
const {localStudio}=require('../lib/nepal/localAccess');
const {preflightNepal,isNepalSurvey}=require('../lib/nepal/preflight');
const {buildReviewCase,renderReviewDocument}=require('../lib/nepal/reviewSheet');
module.exports=async(req,res)=>{
  if(!localStudio())return res.status(404).json({success:false,message:'Not found.'});
  const survey=req.body?.surveyData||req.body;
  if(!isNepalSurvey(survey))return res.status(400).json({success:false,message:'A Nepal survey is required.'});
  const preflight=preflightNepal(survey);
  if(!preflight.contractReady)return res.status(422).json({success:false,code:preflight.code,
    message:preflight.message,blockers:preflight.blockers});
  try{
    const review=buildReviewCase('Your Nepal survey',preflight.normalizedBrief);
    if(req.body?.format==='json'){
      const {exportCandidateGeometry}=require('../lib/nepal/geometryExport');
      return res.status(200).json({success:true,status:'unverified_concepts_only',generationAvailable:false,
        candidates:review.result.candidates.map(c=>exportCandidateGeometry(c,preflight.normalizedBrief)),
        attempts:review.result.attempts.filter(a=>a.status==='rejected').length});
    }
    if(req.body?.spatialStudy===true){
      if(!review.result.candidates.length)return res.status(422).json({success:false,
        code:'NO_SPATIAL_STUDY_CANDIDATES',message:'No starting layout was found for this brief. Review the floor program, site dimensions and working setbacks before trying again.'});
      const {runSpatialStudy,renderSpatialStudy}=require('../lib/nepal/spatialStudy');
      const result=await runSpatialStudy(review.result.candidates);
      return res.status(200).type('html').send(renderSpatialStudy(result));
    }
    return res.status(200).type('html').send(renderReviewDocument([review]));
  }catch(error){
    return res.status(422).json({success:false,code:'CONCEPT_GEOMETRY_UNAVAILABLE',
      message:error.message});
  }
};
