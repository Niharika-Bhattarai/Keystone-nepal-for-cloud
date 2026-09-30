'use strict';
// Plain-JSON geometry of a Nepal spatial hypothesis for the studio's 3D viewer.
// It carries the same honesty status as the review sheet: this is not a floor
// plan, permit drawing or engineered model. Units: millimetres, plan x/y as in
// the engine (true north given separately), z from the brief's floor elevations.
const DEFAULT_STOREY_MM=3000;

function levelElevations(candidate,brief){
  const byId=new Map((brief?.buildingProgram?.levels||[]).map(l=>[l.id,l.elevationMm]));
  return candidate.levels.map((level,i)=>{
    const known=byId.get(level.id);
    return Number.isFinite(known)?known:i*DEFAULT_STOREY_MM;
  });
}
function exportCandidateGeometry(candidate,brief){
  const elevations=levelElevations(candidate,brief);
  const levels=candidate.levels.map((level,i)=>{
    const next=elevations[i+1];
    const storeyHeightMm=Number.isFinite(next)&&next>elevations[i]?next-elevations[i]:DEFAULT_STOREY_MM;
    const rooms=level.rooms?.rooms||[];
    return {id:level.id,kind:level.kind,elevationMm:elevations[i],storeyHeightMm,
      slabs:level.footprint.slabs,
      rooms:rooms.map(r=>({id:r.id,type:r.type,box:r.box,clearBox:r.clearBox||null,
        clearAreaSqM:r.clearAreaSqM??null,suggestedByPlanner:!!r.suggestedByPlanner,
        useIntent:r.useIntent||null})),
      walls:(level.walls?.walls||[]).map(w=>({id:w.id,kind:w.kind,thicknessMm:w.thicknessMm,
        solidBoxes:w.solidBoxes,
        openings:w.openingBoxes.map(o=>({box:o.box,
          kind:o.opening?.leafCount||o.opening?.from||/portal/.test(o.opening?.status||'')?'door':'window',
          status:o.opening?.status||null}))})),
      corridor:level.rooms?.corridor||null,
      balcony:level.rooms?.balcony?.box||null,
      parking:level.rooms?.parking?.box||null};
  });
  return {id:candidate.id,designStatus:candidate.designStatus,
    eligibility:candidate.validation.eligibility,
    northBearingDegrees:brief?.site?.north?.bearingDegrees??null,
    site:candidate.envelope.site,buildable:candidate.envelope.buildable,
    core:{id:candidate.core.id,box:candidate.core.box,levelIds:candidate.core.levelIds},
    columns:candidate.grid.columns.map(c=>({id:c.id,xMm:c.xMm,yMm:c.yMm,widthMm:c.widthMm})),
    levels,
    findings:candidate.validation.blockers.map(b=>({code:b.code,levelId:b.levelId||null,
      ruleId:b.ruleId||(b.ruleIds||[]).join(',')||null})),
    unverified:['municipal adoption','RC frame design','stair headroom','door swings and egress',
      'daylight legality','balcony guards and drainage','tank engineering','drain routes']};
}
module.exports={exportCandidateGeometry,DEFAULT_STOREY_MM};
