'use strict';
// AutoCAD (DXF R2010, millimetres) export of a Nepal spatial hypothesis. Node
// prepares a plain JSON payload of everything the review drawings show; the
// pinned ezdxf writer (scripts/export/build_nepal_dxf.py) turns it into layered
// CAD entities. Same honesty status as the PDF set: for review only.
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {exportCandidateGeometry}=require('./geometryExport');
const {buildOpeningSchedule,structuralLayout,roofPlan,openingKind,roomName}=require('./drawingSet');
const {furnishLevel}=require('./furniture');
const {sanitaryPlan}=require('./sanitary');

function prepareNepalDxf(candidate,brief,{option='Option 1'}={}){
  const geometry=exportCandidateGeometry(candidate,brief);
  const bearing=geometry.northBearingDegrees??0;
  const schedule=buildOpeningSchedule(candidate),structure=structuralLayout(candidate);
  const cache=new Map(),furnish=level=>{if(!cache.has(level.id))cache.set(level.id,furnishLevel(level,{bearingDegrees:bearing,
    beams:structure.beams,columns:candidate.grid.columns}));return cache.get(level.id);};
  const sanitary=sanitaryPlan(candidate,furnish),roof=roofPlan(candidate,geometry);
  const levels=candidate.levels.map((level,i)=>({
    id:level.id,elevationMm:geometry.levels[i].elevationMm,slabs:level.footprint.slabs,
    walls:(level.walls?.walls||[]).map(w=>({id:w.id,kind:w.kind,axis:w.axis,line:w.line,face:w.face,solidBoxes:w.solidBoxes,
      openings:w.openingBoxes.map((o,j)=>({box:o.box,start:o.start,end:o.end,kind:openingKind(o),
        tag:schedule.tagOf(level.id,w.id,j)||null}))})),
    rooms:(level.rooms?.rooms||[]).map(r=>({id:r.id,name:roomName(r),box:r.clearBox||r.box})),
    parking:level.rooms?.parking?.box||null,
    furniture:furnish(level).items.map(it=>({kind:it.kind,label:it.label||'',box:it.box,wall:it.wall})),
    columns:candidate.grid.columns.filter(c=>level.footprint.slabs.some(s=>c.xMm>=s.x1&&c.xMm<=s.x2&&c.yMm>=s.y1&&c.yMm<=s.y2)),
    stair:candidate.core.levelIds.includes(level.id)?candidate.core.flights[0]?.flights.map(f=>({box:f.box,riserCount:f.riserCount}))||[]:[],
    sanitary:{stacks:sanitary.stacks.filter(s=>s.levels.includes(level.id)).map(s=>({id:s.id,kind:s.kind,point:s.point})),
      branches:sanitary.floors.find(f=>f.levelId===level.id).branches.map(b=>({from:b.from,to:b.to,kind:b.stackId.slice(0,2)})),
      traps:sanitary.floors.find(f=>f.levelId===level.id).traps.map(t=>t.point)}}));
  const j=brief.jurisdiction||{};
  return {version:'keystone-nepal-dxf-v1',units:'mm',option:`${option} · ${candidate.id}`,
    location:`${j.municipality||''}, Ward ${j.ward||''}`,northBearingDegrees:bearing,
    site:candidate.envelope.site,buildable:candidate.envelope.buildable,
    grid:{xAxesMm:candidate.grid.xAxesMm,yAxesMm:candidate.grid.yAxesMm},
    structure:{beams:structure.beams.map(b=>({axis:b.axis,line:b.line,from:b.from,to:b.to,type:b.type})),
      beamTypes:structure.beamTypes,slabThicknessMm:structure.slabThicknessMm},
    levels,
    drainage:{chambers:sanitary.chambers.map(c=>({id:c.id,box:c.box})),runs:sanitary.runs.map(r=>r.points),
      tank:sanitary.tank.box,pit:{centre:sanitary.pit.centre,diameterMm:sanitary.pit.diameterMm},
      reservoir:candidate.core.reservoir?.innerPlanBox||null},
    roof:{regions:roof.regions.map(r=>({name:r.name,levelMm:r.levelMm,boxes:r.boxes})),stairCover:roof.stairCover,
      tank:roof.tank,solar:roof.solar,outlets:roof.outlets},
    status:'FOR REVIEW ONLY - NOT FOR CONSTRUCTION OR PERMIT',
    notes:['Spatial hypothesis, not an engineered or permit drawing.','Checked by, NEC no. and signatures are intentionally blank.',
      'Structural members are a preliminary layout; reinforcement and footings by structural design.',
      'Sanitary pipe sizes, falls, tank and pit sizes by the engineer.']};
}
const pythonCommand=()=>process.env.PYTHON||(process.platform==='win32'?'python':'python3');
function buildNepalDxf(candidate,brief,options){
  const payload=prepareNepalDxf(candidate,brief,options);
  const result=spawnSync(pythonCommand(),[path.resolve(__dirname,'../../scripts/export/build_nepal_dxf.py')],{
    input:JSON.stringify(payload),encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024,windowsHide:true});
  if(result.error||result.status!==0)throw new Error('Nepal DXF writer failed: '+(result.error?.message||result.stderr).slice(0,800));
  return {dxf:result.stdout,payload};
}
module.exports={prepareNepalDxf,buildNepalDxf};
