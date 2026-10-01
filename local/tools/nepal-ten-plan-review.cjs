'use strict';
// Ten reproducible, honestly distinct spatial hypotheses for owner markup.
// This is a local architect review artifact, not ten permit-ready designs.
const fs=require('node:fs');
const path=require('node:path');
const backend=path.join(__dirname,'..','backend-keystone');
const {normalizeBrief}=require(path.join(backend,'lib/nepal/normalizeBrief'));
const {deriveConceptAssumptions}=require(path.join(backend,'lib/nepal/workingAssumptions'));
const {searchConcepts}=require(path.join(backend,'lib/nepal/candidateSearch'));
const {renderReviewDocument}=require(path.join(backend,'lib/nepal/reviewSheet'));

function topFloorPuja(raw){
  const brief=structuredClone(raw);
  for(const level of brief.buildingProgram.levels)
    level.specialRooms=level.specialRooms.filter(room=>room!=='puja');
  brief.buildingProgram.levels.at(-1).specialRooms.push('puja');
  return brief;
}
function corpus(label,file){
  const raw=topFloorPuja(require(path.join(backend,'test/fixtures/nepal',file)));
  const normalized=normalizeBrief(raw);
  if(normalized.invalid.length||normalized.missing.length||normalized.unsupported.length)
    throw new Error(`${file}: moved top-floor puja invalid: ${JSON.stringify(normalized)}`);
  const brief=normalized.brief,assumptions=deriveConceptAssumptions(brief);
  const result=searchConcepts(brief,{provisionalSetbacksMm:assumptions.setbacksMm,
    workingCoverageLimit:assumptions.coverageLimit,maxCandidates:6});
  return {label,brief,assumptions,result};
}
const owner=corpus('2.5-storey owner home','rectangle-2_5.json');
const rental=corpus('3.5-storey rental plus owner home','rental-3_5.json');
// Numbered set: the top 4 owner and top 6 rental hypotheses by ranking.
owner.result.candidates=owner.result.candidates.slice(0,4);
if(owner.result.candidates.length!==4||rental.result.candidates.length!==6)
  throw new Error(`Expected 4 + 6 distinct concepts; received ${owner.result.candidates.length} + ${rental.result.candidates.length}`);
const plans=[...owner.result.candidates.map(candidate=>({base:owner,candidate})),
  ...rental.result.candidates.map(candidate=>({base:rental,candidate}))]
  .map(({base,candidate},index)=>({planNumber:index+1,label:`Plan ${index+1} — ${base.label}`,
    brief:base.brief,assumptions:base.assumptions,result:{candidates:[candidate],attempts:[]},candidate}));
if(new Set(plans.map(p=>p.candidate.geometryHash)).size!==10)
  throw new Error('Two review plans have identical measured room and footprint geometry');
const rows=plans.map(p=>{
  const c=p.candidate,issues=c.validation.blockers;
  const count=code=>issues.filter(b=>b.code===code).length;
  const puja=c.levels.find(l=>l.rooms?.rooms.some(r=>r.type==='puja'))?.id||'';
  return {plan:p.planNumber,program:p.base?.label||p.label.replace(/^Plan \d+ — /,''),
    candidate_id:c.id,geometry_hash:c.geometryHash,core_side:c.coreSide,
    room_order:c.order,puja_level:puja,interior_column_rooms:count('COLUMN_IN_ROOM_CLEAR_AREA'),
    puja_toilet_v06_conflicts:count('PUJA_TOILET_SEPARATION_NOT_MET'),
    toilets_in_ne_center_v13:count('TOILET_IN_NE_OR_CENTER'),
    attached_bath_replan:c.levels.map(l=>l.rooms?.bathReplan?.status).find(Boolean)||'',
    wet_rooms_not_over_wet_c17:c.validation.verticalStack.wetStack.filter(w=>w.overWetShare===0).length,
    c17_drain_routes:c.validation.verticalStack.drainRoutes.map(r=>r.status==='route_reserved'?
      `${r.roomId}:${r.kind}:${r.horizontalRunMm}mm`:`${r.roomId}:${r.status}`).join(' '),
    planning_columns:c.grid.columns.length,
    stair_bay_axis_span_mm:c.core.box.y2-c.core.box.y1-c.grid.columnWidthMm,
    main_room_grid_exceptions:issues.filter(b=>b.code==='MAIN_ROOM_GRID_CELL_NOT_MET')
      .reduce((n,b)=>n+b.rooms.length,0),
    entry_not_facing_living_levels:count('ENTRY_NOT_FACING_LIVING'),
    ground_entry_destination:c.levels[0].rooms.unitEntry.to,
    ground_open_bike_bay:!!c.levels[0].rooms.parking,
    ground_bike_bay_width_mm:c.levels[0].rooms.parking?.box.x2-
      c.levels[0].rooms.parking?.box.x1||0,
    first_balcony_access:!!c.levels[1].rooms?.balcony?.doorReservation,
    first_attached_bath_access:!!c.levels[1].rooms?.rooms.some(r=>r.attachedTo&&
      r.doorReservation.from==='primary-bedroom'),
    rental_cross_hall:!!c.levels[0].rooms.crossHall,
    undersized_preferred_bedrooms:c.levels.flatMap(l=>l.rooms?.rooms||[])
      .filter(r=>['bedroom','guestBedroom'].includes(r.type)&&
        Math.min(r.clearBox.x2-r.clearBox.x1,r.clearBox.y2-r.clearBox.y1)<3000).length,
    missing_physical_windows:count('NO_PHYSICAL_EXTERIOR_WINDOW_RESERVATION'),
    windows_below_1500mm_reference_clearance:count('WINDOW_NEIGHBOR_CLEARANCE_BELOW_REFERENCE'),
    floor_entry_clear_mm:c.levels[0].rooms.unitEntry.doorReservation.clearWidthMm,
    room_entry_clear_mm:900,bathroom_entry_clear_mm:750,
    kitchen_open_portal:c.levels.filter(l=>l.rooms).every(l=>l.rooms.rooms
      .filter(r=>r.type==='kitchen').every(r=>r.doorReservation.status==='open_portal_reserved_no_door')),
    site_entry_leaves:c.core.siteEntry.leafCount,
    rain_chajja_edges:c.levels[0].rainChajjas.reservations.length,
    rain_chajja_depth_mm:c.levels[0].rainChajjas.reservations[0]?.depthMm||0,
    status:c.validation.eligibility,other_findings:[...new Set(issues.map(b=>b.code))].join(';')};
});
const output=path.join(__dirname,'..','runtime','nepal-ten-plan-review');
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'index.html'),renderReviewDocument(plans));
fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(rows,null,2));
const headers=Object.keys(rows[0]);
const csv=x=>`"${String(x??'').replaceAll('"','""')}"`;
fs.writeFileSync(path.join(output,'summary.csv'),[headers.join(','),
  ...rows.map(row=>headers.map(key=>csv(row[key])).join(','))].join('\n')+'\n');
console.log(`${output} — ${plans.length} distinct numbered concepts`);
if(process.argv.includes('--pdf')){
  (async()=>{
    const {chromium}=require(path.join(__dirname,'..','frontend-keystone/node_modules/playwright'));
    const browser=await chromium.launch({
      executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
    try{
      const page=await browser.newPage({viewport:{width:1600,height:1100}});
      await page.goto(`file:///${path.join(output,'index.html').replaceAll('\\','/')}`);
      await page.pdf({path:path.join(output,'review-plans.pdf'),format:'A3',
        landscape:true,printBackground:true});
      console.log(path.join(output,'review-plans.pdf'));
    }finally{await browser.close();}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
