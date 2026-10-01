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
    const variant=review.result.parkingProgramVariant;
    // Owner-approved program variant, shown separately and labelled as a change.
    const variantReview=variant?{label:'Program variant for parking: one ground bedroom moved up (household must confirm)',
      brief:variant.brief,assumptions:review.assumptions,
      result:{candidates:variant.candidates,attempts:variant.attempts,variations:[],
        status:'unverified_concepts_only',generationAvailable:false}}:null;
    if(req.body?.format==='drawings'){
      // A3 review drawing set for one hypothesis: index into the listed candidates,
      // then the parking-variant candidates (same order as the JSON format).
      const {renderDrawingSet}=require('../lib/nepal/drawingSet');
      const all=[...review.result.candidates.map(c=>[c,preflight.normalizedBrief,'']),
        ...(variant?variant.candidates.map(c=>[c,variant.brief,' (parking variant)']):[])];
      const index=Number.isSafeInteger(req.body.candidateIndex)?req.body.candidateIndex:0;
      if(!all[index])return res.status(404).json({success:false,message:'No such hypothesis.'});
      const [c,b,label]=all[index];
      return res.status(200).type('html').send(renderDrawingSet(c,b,{option:`Option ${index+1}${label}`}).html);
    }
    if(req.body?.format==='json'){
      const {exportCandidateGeometry}=require('../lib/nepal/geometryExport');
      return res.status(200).json({success:true,status:'unverified_concepts_only',generationAvailable:false,
        candidates:[...review.result.candidates.map(c=>exportCandidateGeometry(c,preflight.normalizedBrief)),
          ...(variant?variant.candidates.map(c=>({...exportCandidateGeometry(c,variant.brief),
            id:`${c.id} (parking variant)`,programChange:variant.change})):[])],
        attempts:review.result.attempts.filter(a=>a.status==='rejected').length});
    }
    if(req.body?.spatialStudy===true){
      if(!review.result.candidates.length)return res.status(422).json({success:false,
        code:'NO_SPATIAL_STUDY_CANDIDATES',message:'No starting layout was found for this brief. Review the floor program, site dimensions and working setbacks before trying again.'});
      const {runSpatialStudy,renderSpatialStudy}=require('../lib/nepal/spatialStudy');
      const result=await runSpatialStudy(review.result.candidates);
      return res.status(200).type('html').send(renderSpatialStudy(result));
    }
    return res.status(200).type('html').send(renderReviewDocument(variantReview?[review,variantReview]:[review]));
  }catch(error){
    return res.status(422).json({success:false,code:'CONCEPT_GEOMETRY_UNAVAILABLE',
      message:error.message});
  }
};
