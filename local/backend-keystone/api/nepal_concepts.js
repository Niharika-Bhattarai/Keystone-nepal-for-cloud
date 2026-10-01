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
    if(req.body?.format==='dxf'){
      // AutoCAD DXF (R2010, mm) for one hypothesis, same indexing as the drawing set.
      const {buildNepalDxf}=require('../lib/nepal/dxfExport');
      const all=[...review.result.candidates.map(c=>[c,review.brief,'']),
        ...(variant?variant.candidates.map(c=>[c,variant.brief,' (parking variant)']):[])];
      const index=Number.isSafeInteger(req.body.candidateIndex)?req.body.candidateIndex:0;
      if(!all[index])return res.status(404).json({success:false,message:'No such hypothesis.'});
      const [c,b,label]=all[index];
      const {dxf}=buildNepalDxf(c,b,{option:`Option ${index+1}${label}`});
      res.setHeader('Content-Disposition',`attachment; filename="keystone-nepal-option-${index+1}.dxf"`);
      return res.status(200).type('application/dxf').send(dxf);
    }
    if(req.body?.format==='structure'||req.body?.format==='structure-json'){
      // Preliminary NBC 105:2025 structural calculation for one hypothesis.
      const {designStructure}=require('../lib/nepal/structural');
      const {renderStructuralReport}=require('../lib/nepal/structural/report');
      const all=[...review.result.candidates.map(c=>[c,review.brief,'']),
        ...(variant?variant.candidates.map(c=>[c,variant.brief,' (parking variant)']):[])];
      const index=Number.isSafeInteger(req.body.candidateIndex)?req.body.candidateIndex:0;
      if(!all[index])return res.status(404).json({success:false,message:'No such hypothesis.'});
      const [c,b,label]=all[index];
      const raw=req.body.structure||{},num=v=>Number.isFinite(Number(v))&&v!==''&&v!=null?Number(v):undefined;
      const overrides={soil:['A','B','C','D'].includes(raw.soil)?raw.soil:undefined,sbc:num(raw.sbc),Z:num(raw.Z),
        columnMm:num(raw.columnMm),beamWidthMm:num(raw.beamWidthMm),beamDepthMm:num(raw.beamDepthMm),fck:num(raw.fck),
        lockSizes:raw.lockSizes===true};
      let result;
      try{result=designStructure(c,b,overrides);}
      catch(error){return res.status(422).json({success:false,code:error.code||'STRUCTURE_UNAVAILABLE',message:error.message,
        candidates:error.candidates});}
      if(req.body.format==='structure-json'){
        const {summary,trials,an,beams,columns,footings,elig,irr}=result;
        return res.status(200).json({success:true,status:result.status,option:index+1,summary,trials,
          seismic:{Z:an.hz.Z,soil:an.dirs.x.gov.soil,T:an.dirs.x.gov.T,Cd:an.dirs.x.gov.Cd,W:an.Wt,Vx:an.dirs.x.gov.V,Vy:an.dirs.y.gov.V},
          sizes:{columnMm:result.model.inputs.columnMm,beam:[result.model.inputs.beamWidthMm,result.model.inputs.beamDepthMm]},
          columns:columns.map(x=>({storey:x.storey,id:x.id,bars:x.label,ok:x.ok})),
          beams:beams.map(x=>({id:x.id,level:x.level,top:x.top,bottom:x.bottom,ok:x.ok})),
          footings:footings.map(x=>({id:x.id,B:x.B,D:x.D,bar:x.bar})),nbc205:elig,irregularities:irr.filter(i=>i.irregular)});
      }
      return res.status(200).type('html').send(renderStructuralReport(result,{option:`Option ${index+1}${label}`}));
    }
    if(req.body?.format==='drawings'){
      // A3 review drawing set for one hypothesis: index into the listed candidates,
      // then the parking-variant candidates (same order as the JSON format).
      const {renderDrawingSet}=require('../lib/nepal/drawingSet');
      const all=[...review.result.candidates.map(c=>[c,review.brief,'']),
        ...(variant?variant.candidates.map(c=>[c,variant.brief,' (parking variant)']):[])];
      const index=Number.isSafeInteger(req.body.candidateIndex)?req.body.candidateIndex:0;
      if(!all[index])return res.status(404).json({success:false,message:'No such hypothesis.'});
      const [c,b,label]=all[index];
      return res.status(200).type('html').send(renderDrawingSet(c,b,{option:`Option ${index+1}${label}`}).html);
    }
    if(req.body?.format==='json'){
      const {exportCandidateGeometry}=require('../lib/nepal/geometryExport');
      return res.status(200).json({success:true,status:'unverified_concepts_only',generationAvailable:false,
        candidates:[...review.result.candidates.map(c=>exportCandidateGeometry(c,review.brief)),
          ...(variant?variant.candidates.map(c=>({...exportCandidateGeometry(c,variant.brief),
            id:`${c.id} (parking variant)`,programChange:variant.change})):[])],
        attempts:review.result.attempts.filter(a=>a.status==='rejected').length,
        // Why nothing fits, most frequent first (numbers vary per attempt).
        rejectedReasons:review.result.candidates.length?[]:Object.entries(review.result.attempts.filter(a=>a.status==='rejected')
          .reduce((m,a)=>{const k=a.reason.replace(/^[\w-]+: /,'');m[k]=(m[k]||0)+1;return m;},{})).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>k),
        planningFit:review.brief.site?.planningFit||null});
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
