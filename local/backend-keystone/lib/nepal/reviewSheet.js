'use strict';
const {deriveConceptAssumptions}=require('./workingAssumptions');
const {searchConcepts}=require('./candidateSearch');
const {roomGridCrossings,columnsInsideRoom,MAIN_GRID_ROOM_TYPES}=require('./validateNepalPlan');
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const f=(n,d=2)=>Number(n).toFixed(d);
const m=mm=>f(mm/1000);
function rectSvg(box,site,fill,stroke='#263a40',sw=55,extra=''){
  return `<rect x="${box.x1}" y="${site.y2-box.y2}" width="${box.x2-box.x1}" height="${box.y2-box.y1}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${extra}/>`;
}
function lineSvg(site,x1,y1,x2,y2,color,width,dash=''){
  return `<line x1="${x1}" y1="${site.y2-y1}" x2="${x2}" y2="${site.y2-y2}" stroke="${color}" stroke-width="${width}" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
}
function txt(site,x,y,value,size=220,extra=''){
  return `<text x="${x}" y="${site.y2-y}" font-size="${size}" ${extra}>${esc(value)}</text>`;
}
function openingSvg(site,o,color){
  if(!o)return '';
  const coords=o.axis==='vertical'?[o.x,o.y1,o.x,o.y2]:[o.x1,o.y,o.x2,o.y];
  return lineSvg(site,...coords,color,77);
}
function doorSvg(site,o,target){
  if(!o)return '';
  if(o.status==='open_portal_reserved_no_door')return openingSvg(site,o,'#788c53');
  if(!target)return openingSvg(site,o,'#b86d38');
  const vertical=o.axis==='vertical',low=vertical?o.y1:o.x1,
    high=vertical?o.y2:o.x2,line=vertical?o.x:o.y;
  const sign=vertical?((target.x1+target.x2)/2>line?1:-1):
    ((target.y1+target.y2)/2>line?1:-1);
  const leaves=o.leafCount===2?2:1,radius=(high-low)/leaves;
  let svg='<g data-door-symbol="provisional-swing">';
  for(let i=0;i<leaves;i++){
    const hinge=i===0?low:high,along=i===0?1:-1;
    const point=t=>vertical?
      [line+sign*radius*Math.sin(t),hinge+along*radius*Math.cos(t)]:
      [hinge+along*radius*Math.cos(t),line+sign*radius*Math.sin(t)];
    const end=point(Math.PI/2);
    svg+=lineSvg(site,vertical?line:hinge,vertical?hinge:line,...end,'#8a4c28',32);
    const points=Array.from({length:17},(_,k)=>point(k*Math.PI/32))
      .map(([x,y])=>`${x},${site.y2-y}`).join(' ');
    svg+=`<polyline points="${points}" fill="none" stroke="#8a4c28" stroke-width="20" stroke-dasharray="55 35"/>`;
  }
  return svg+'</g>';
}
function stairSvg(candidate,level,site){
  const index=candidate.levels.findIndex(item=>item.id===level.id);
  const assembly=candidate.core.flights[Math.min(index,candidate.core.flights.length-1)];
  if(!assembly)return '';
  const upper=index>=candidate.core.flights.length;
  const pad=assembly.arrivalLandings[upper?1:0].box;
  let svg=rectSvg(pad,site,'#dce9d9','#567061',45);
  svg+=rectSvg(assembly.landings[0].box,site,'#eee9d8','#606960',40);
  for(const flight of assembly.flights){
    svg+=rectSvg(flight.box,site,'#f2f0e6','#46545a',48);
    for(let i=1;i<flight.riserCount;i++){
      const y=flight.box.y1+i*flight.treadMm;
      svg+=lineSvg(site,flight.box.x1,y,flight.box.x2,y,'#778d93',32);
    }
    const cx=(flight.box.x1+flight.box.x2)/2;
    const north=flight.direction==='north';
    svg+=lineSvg(site,cx,north?flight.box.y1+250:flight.box.y2-250,
      cx,north?flight.box.y2-250:flight.box.y1+250,'#974d36',65);
    svg+=txt(site,cx,north?flight.box.y2-420:flight.box.y1+270,
      north?'UP':'DN',210,'text-anchor="middle" fill="#974d36" font-weight="700"');
  }
  svg+=txt(site,(pad.x1+pad.x2)/2,(pad.y1+pad.y2)/2,
    upper?'FROM BELOW':'FLOOR PAD',190,'text-anchor="middle" fill="#315c46" font-weight="700"');
  svg+=txt(site,(assembly.landings[0].box.x1+assembly.landings[0].box.x2)/2,
    (assembly.landings[0].box.y1+assembly.landings[0].box.y2)/2,
    `+${m(assembly.landings[0].elevationMm)} m`,195,'text-anchor="middle" fill="#5b6257"');
  return svg;
}
const palette={livingRoom:'#e5ebdf',kitchen:'#f6e5d1',primaryBedroom:'#e2e8f0',
  guestBedroom:'#dcebe9',bedroom:'#e8ecf5',bathroom:'#efebe8',puja:'#f6edcd',
  study:'#eee6ea',store:'#efeee7',laundry:'#e9eef0',dining:'#e8e8d8',
  livingAnnex:'#e5ebdf',utilityFlex:'#e7ece9',primaryAlcove:'#e2e8f0',
  diningAnnex:'#f2ead9',serviceNiche:'#e7ece9'};
const name={livingRoom:'LIVING',kitchen:'KITCHEN',primaryBedroom:'PRIMARY BED',guestBedroom:'GUEST BED',
  bedroom:'BEDROOM',bathroom:'BATH',puja:'PUJA',study:'STUDY',store:'STORE',laundry:'LAUNDRY',
  dining:'DINING',livingAnnex:'ANNEX',utilityFlex:'UTILITY FLEX',
  primaryAlcove:'BEDROOM ALCOVE',diningAnnex:'DINING IN KITCHEN SUITE',
  serviceNiche:'SERVICE NICHE'};
function planSvg(candidate,level,brief){
  const site=candidate.envelope.site,b=candidate.envelope.buildable;
  let svg=`<svg viewBox="-850 -1050 ${site.x2+2000} ${site.y2+2200}" role="img" aria-label="${esc(level.id)} spatial review plan" xmlns="http://www.w3.org/2000/svg">`;
  svg+='<rect x="-850" y="-1050" width="16000" height="16000" fill="#fff"/>';
  svg+=rectSvg(site,site,'#f8f8f4','#a5b0ad',55,'stroke-dasharray="160 90"');
  for(const projection of level.rainChajjas?.reservations||[])
    svg+=rectSvg(projection.box,site,'#e5eef0','#5a8d92',35,'stroke-dasharray="100 65"');
  for(const projection of level.rainChajjas?.cornerReservations||[])
    svg+=rectSvg(projection.box,site,'#e5eef0','#5a8d92',25,'stroke-dasharray="100 65"');
  for(const slab of level.footprint.slabs)svg+=rectSvg(slab,site,'#f5f2e9','#263940',115);
  if(level.rooms?.parking){
    svg+=rectSvg(level.rooms.parking.box,site,'#eee8dd','#9b835d',45);
    svg+=txt(site,(level.rooms.parking.box.x1+level.rooms.parking.box.x2)/2,
      (level.rooms.parking.box.y1+level.rooms.parking.box.y2)/2,
      `OPEN BIKE BAY ${m(level.rooms.parking.box.x2-level.rooms.parking.box.x1)} x ${m(level.rooms.parking.box.y2-level.rooms.parking.box.y1)} m`,
      185,'text-anchor="middle" fill="#715b3e" font-weight="700"');
  }
  if(level.rooms?.balcony){
    const balcony=level.rooms.balcony.box;
    svg+=rectSvg(balcony,site,'#e6eee7','#63826e',50,'stroke-dasharray="120 55"');
    svg+=txt(site,(balcony.x1+balcony.x2)/2,(balcony.y1+balcony.y2)/2,
      'FAMILY BALCONY',185,'text-anchor="middle" fill="#476d55" font-weight="700"');
  }
  for(const x of candidate.grid.xAxesMm)svg+=lineSvg(site,x,b.y1,x,b.y2,'#c4c7b7',25,'90 90');
  for(const y of candidate.grid.yAxesMm)svg+=lineSvg(site,b.x1,y,b.x2,y,'#c4c7b7',25,'90 90');
  if(level.rooms){
    if(level.rooms.corridor)svg+=rectSvg(level.rooms.corridor,site,'#f5f1e6','none',0);
    if(level.rooms.crossHall)svg+=rectSvg(level.rooms.crossHall,site,'#f5f1e6','none',0);
    for(const room of level.rooms.rooms){
      svg+=rectSvg(room.box,site,palette[room.type]||'#efeee8','none',0);
      const cx=(room.box.x1+room.box.x2)/2,cy=(room.box.y1+room.box.y2)/2;
      const crossings=roomGridCrossings(room,candidate.grid);
      const crossed=MAIN_GRID_ROOM_TYPES.has(room.type)&&
        (crossings.xAxesMm.length||crossings.yAxesMm.length);
      svg+=txt(site,cx,cy+180,`${room.diningWithinKitchen?'KITCHEN + DINING':room.useIntent?.startsWith('bedroom_entry_vestibule')?'BEDROOM VESTIBULE':name[room.type]||room.type}${room.suggestedByPlanner?' *':''}${crossed?' ^':''}`,215,
        'text-anchor="middle" font-weight="700" fill="#24373b"');
      const clear=room.clearBox||room.box;
      svg+=txt(site,cx,cy-100,`${f(room.clearAreaSqM??room.areaSqM,1)} m² clear`,
        180,'text-anchor="middle" fill="#58676a"');
      svg+=txt(site,cx,cy-310,`${m(clear.x2-clear.x1)} × ${m(clear.y2-clear.y1)} m`,
        165,'text-anchor="middle" fill="#58676a"');
    }
  }
  svg+=rectSvg(candidate.core.box,site,'#e5e8e4','none',0);
  svg+=stairSvg(candidate,level,site);
  if(level.id===candidate.levels[0].id){
    svg+=rectSvg(candidate.core.reservoir.innerPlanBox,site,'none','#4e8692',43,'stroke-dasharray="140 80"');
    svg+=txt(site,(candidate.core.box.x1+candidate.core.box.x2)/2,
      candidate.core.box.y2-310,'TANK BELOW',175,'text-anchor="middle" fill="#356c78"');
  }
  if(level.walls)for(const wall of level.walls.walls)for(const box of wall.solidBoxes)
    svg+=rectSvg(box,site,'#263940','none',0);
  if(level.rooms){
    for(const room of level.rooms.rooms){
      if(room.entryFrom!=='shared-floor-level-arrival')
        svg+=doorSvg(site,room.doorReservation,room.box);
      svg+=doorSvg(site,room.serviceExitDoor,room.box);
      if(room.serviceExitDoor?.axis==='horizontal')svg+=txt(site,
        (room.serviceExitDoor.x1+room.serviceExitDoor.x2)/2,
        room.serviceExitDoor.y+360,'REAR SERVICE EXIT *',165,
        'text-anchor="middle" fill="#a35d30" font-weight="700"');
      for(const window of room.windowReservations||[room.windowReservation])
        svg+=openingSvg(site,window,
          window?.boundaryGuidanceStatus==='below_1500mm_reference_guidance'?
            '#c64b33':'#438ca3');
    }
    svg+=doorSvg(site,level.rooms.unitEntry.doorReservation,
      level.rooms.rooms.find(r=>r.entryFrom==='shared-floor-level-arrival')?.box||level.rooms.corridor);
    svg+=openingSvg(site,level.rooms.circulationPortal,'#788c53');
    svg+=openingSvg(site,level.rooms.crossHallPortal,'#788c53');
    svg+=doorSvg(site,level.rooms.balcony?.doorReservation,level.rooms.balcony?.box);
    if(level.id===candidate.levels[0].id){
      svg+=doorSvg(site,candidate.core.siteEntry,candidate.core.box);
      const entry=candidate.core.siteEntry,cx=(entry.x1+entry.x2)/2;
      svg+=txt(site,cx,entry.y-420,'MAIN ENTRY · 1200',175,
        'text-anchor="middle" fill="#8a4c28" font-weight="700"');
      svg+=lineSvg(site,cx,entry.y-320,cx,entry.y-70,'#8a4c28',32);
    }
  }
  const interiorColumnIds=new Set(level.rooms?.rooms.flatMap(room=>
    columnsInsideRoom(room,candidate.grid))||[]);
  for(const column of candidate.grid.columns){
    const half=column.widthMm/2,box={x1:column.xMm-half,y1:column.yMm-half,
      x2:column.xMm+half,y2:column.yMm+half};
    // Only draw the member where the current level has slab support.
    if(!level.footprint.slabs.some(s=>box.x1>=s.x1&&box.x2<=s.x2&&box.y1>=s.y1&&box.y2<=s.y2))continue;
    svg+=rectSvg(box,site,'#31484c',interiorColumnIds.has(column.id)?'#c64b33':'#fff',
      interiorColumnIds.has(column.id)?95:20);
  }
  svg+=lineSvg(site,site.x1,-270,site.x2,-270,'#586d70',27);
  svg+=txt(site,(site.x1+site.x2)/2,-530,`PLOT ${m(site.x2-site.x1)} m`,230,
    'text-anchor="middle" fill="#36535a" font-weight="700"');
  svg+=txt(site,site.x1,site.y2+320,`BUILDABLE ${m(b.x2-b.x1)} × ${m(b.y2-b.y1)} m`,210,
    'fill="#36535a" font-weight="700"');
  const angle=brief.site.north.bearingDegrees*Math.PI/180,
    nx=site.x2+460,ny=site.y2-1000,dx=Math.cos(angle)*620,dy=Math.sin(angle)*620;
  svg+=lineSvg(site,nx,ny,nx+dx,ny+dy,'#142f38',95);
  svg+=txt(site,nx+dx,ny+dy+250,'N',290,'text-anchor="middle" fill="#142f38" font-weight="700"');
  return svg+'</svg>';
}
function renderReviewDocument(cases){
  const nav=cases.map((item,i)=>`<a href="#case-${i}">${esc(item.label)}</a>`).join('');
  const bodies=cases.map((item,i)=>{
    const {brief,result,assumptions}=item;
    const options=result.candidates.map((candidate,index)=>{
      const cb=candidate.planningBrief||brief;
      const l=candidate.ledger,stair=candidate.core.flights[0];
      const metrics=`<div class="metrics"><span>Plot <b>${f(l.siteAreaSqM)} m²</b></span><span>Ground footprint <b>${f(l.groundCoverSqM)} m² / ${f(l.groundCoverageRatio*100,1)}%</b></span><span>Sum of floor envelopes <b>${f(l.grossBuiltSqM)} m²</b></span><span>Stair <b>${stair?`${stair.risers} × ${f(stair.riserMm,1)} mm rise · ${stair.treadMm} mm tread`:'not applicable'}</b></span><span>Tank <b>${f(candidate.core.reservoir.netVolumeLitres,0)} L net</b></span></div>`;
      const floors=candidate.levels.map(level=>`<article class="floor"><h4>${esc(level.id)} <small>${f(candidate.ledger.floors.find(row=>row.id===level.id).grossSqM)} m² plan envelope${level.kind==='partial'?' · terrace/enclosure boundary unresolved':''}${level.residentialDetails?.requestedBalcony&&!level.rooms?.balcony?' · balcony requested, not drawn':''}</small></h4>${planSvg(candidate,level,cb)}</article>`).join('');
      const blockers=[...new Set(candidate.validation.blockers.map(b=>b.code))];
      const metricsWithGrid=metrics.replace('</div>',
        `<span>Planning grid max <b>${m(candidate.grid.maxAdjacentAxisSpanMm)} m (14 ft cap)</b></span></div>`);
      const gridExceptions=candidate.validation.blockers.filter(b=>b.code==='MAIN_ROOM_GRID_CELL_NOT_MET');
      const gridDetail=gridExceptions.length?`<details><summary>Main-room grid-cell exceptions (${gridExceptions.reduce((n,b)=>n+b.rooms.length,0)})</summary><p>${esc(gridExceptions.flatMap(b=>b.rooms.map(r=>`${b.levelId}: ${r.roomId}`)).join(' · '))}</p></details>`:'';
      return `<section class="option"><h3>${item.planNumber?`Plan ${item.planNumber}`:`Option ${index+1}`} <small>${esc(candidate.id)}${candidate.entrance?.faces?` · entrance from the ${esc(candidate.entrance.faces)}-facing road`:''}</small></h3>${cb.site?.planningFit?.note&&cb!==brief?`<p class="flag">${esc(cb.site.planningFit.note)}</p>`:''}${candidate.alternative?`<p class="flag">Vaastu alternative: ${esc(candidate.alternative.note)}</p>`:''}${metricsWithGrid}<p class="flag">Working plan geometry for architect/engineer review. ${candidate.validation.blockers.length} findings; ${blockers.length} types. ${esc(blockers.join(' · '))}</p>${gridDetail}<div class="floors">${floors}</div></section>`;
    }).join('');
    const rejected=result.attempts.filter(a=>a.status==='rejected');
    return `<section id="case-${i}"><h2>${esc(item.label)}</h2><p>Municipality: ${esc(brief.jurisdiction.municipality)}, ward ${esc(brief.jurisdiction.ward)}. True-north bearing ${f(brief.site.north.bearingDegrees,0)}° counterclockwise from plot +x. Survey evidence: ${esc(brief.site.north.evidence)}.</p><p>Working setbacks [south, east, north, west]: ${assumptions.setbacksMm.map(m).join(' / ')} m. Working coverage limit ${f(assumptions.coverageLimit*100,0)}%. Neither number establishes parcel-specific permit compliance.</p>${brief.jurisdiction?.profile?.status==='generic_working_assumptions_bylaws_unreviewed'?`<p class="flag">${esc(brief.jurisdiction.municipality)} has no reviewed bylaw profile in Keystone yet: these plans use the generic working setbacks and coverage only. Confirm setbacks, coverage, FAR and height with the municipality before relying on them.</p>`:''}${brief.site?.planningFit?.note?`<p class="flag">${esc(brief.site.planningFit.note)}</p>`:''}${result.candidates[0]?.envelope?.coverageFit?`<p class="flag">${esc(result.candidates[0].envelope.coverageFit.note)}</p>`:''}${options||'<p class="flag">No spatial hypothesis fits this brief and working envelope.</p>'}<details><summary>${rejected.length} rejected search attempts</summary><ol>${rejected.map(a=>`<li>${esc(a.id)}: ${esc(a.reason)}</li>`).join('')}</ol></details></section>`;
  }).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Keystone Nepal · spatial review plans</title><style>body{font:15px/1.5 Arial,sans-serif;color:#20363c;background:#e8ece9;margin:0}header{background:#18353c;color:#fff;padding:26px max(24px,4vw)}h1{margin:0;font-size:27px}h2{font-size:23px;margin:28px 0 8px}h3{font-size:20px;margin:0}h4{margin:0 0 8px;font-size:17px}small{font-size:12px;font-weight:400;color:#5f7377}header small{color:#d2e0dc}main{max-width:1640px;margin:auto;padding:22px}nav{display:flex;gap:14px;margin-top:10px}nav a{color:#dce7e3}section.option{background:#fff;padding:24px;margin:24px 0;border:1px solid #c7d3cf;break-after:page}.metrics{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.metrics span{background:#e8efec;padding:8px 10px}.flag{color:#824b25;background:#fff4e7;padding:10px}.floors{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.floor{border:1px solid #cbd5d1;padding:12px;break-inside:avoid}.floor svg{width:100%;height:auto}details{background:#fff;padding:14px;margin:20px 0}li{margin:6px 0}.legend{margin:14px 0;color:#dce7e3}@media(max-width:850px){.floors{grid-template-columns:1fr}}@media print{body{background:#fff}header{background:#fff;color:#20363c;padding:4mm}header small,.legend{color:#20363c}main{padding:0}.option{border:0}nav,details{display:none}.floors{grid-template-columns:1fr 1fr}.floor{padding:4mm}}</style><header><h1>Keystone Nepal · spatial review plans</h1><small>Working geometry, 30 September 2026. Generated from the saved brief; not permit or construction drawings.</small><nav>${nav}</nav><p class="legend">Brown leaves and dashed arcs = proposed door swing (clearance unverified) · olive = open connection · blue = provisional window; red = window below 1.5 m reference boundary clearance · charcoal squares = 350 mm planning columns · pale blue dashed perimeter = 305–610 mm rain chajja projection inside the sample plot · dashed cyan = underground tank. * = planner-suggested, not selected in survey. ^ = main room crosses an interior planning grid axis.</p></header><main><p><strong>Read this first:</strong> Wall bands reserve nominal 102 mm internal and 229 mm external brick thickness; clear room labels deduct them. Plaster, putty and paint are not yet dimensioned. Floor envelope area includes the stair footprint and does not subtract stair slab openings; it is not a legal FAR calculation. Door swing collision checks, daylight legality, wet shafts, bike-bay gate manoeuvring and rental parking, beam/slab headroom, RC analysis, rain projection legality, FAR treatment and municipal adoption remain open. The option count shows spatial hypotheses, not certified alternatives.</p><p><strong>Residential intent recorded:</strong> Kitchen/dining together by default; 1 m high concrete counter with stove, sink, chimney, rice cooker and upper/lower cabinets. Living room: seven-seat corner sofa, facing TV and coffee table. Bathrooms: no tub by default; wall tile at least 1.5 m, shower wall to ceiling. Plaster, putty and paint are assumed for walls; carpet/parquet over screed/concrete are floor choices. The provisional rain chajja is drawn as an unengineered projection inside the plot. Kitchen balcony preference is a 914–1,219 mm cantilever; bedroom balcony and top-level tulsi muth are conditional. Furniture and finishes have no fit or quantity verification. The owner-house first-floor balcony and attached bath are geometric access reservations; guard, drainage, waterproofing, structural support and door swings remain unverified.</p>${bodies}</main></html>`;
}
// Every plan is made in a frame with the road at the front (bottom). A drawn
// plot uses its largest inner rectangle; a corner plot is planned once per
// road and the options are listed together, each carrying its own brief.
function buildReviewCase(label,surveyBrief){
  const briefs=planningBriefs(surveyBrief);
  const runs=briefs.map(brief=>{const assumptions=deriveConceptAssumptions(brief);
    const result=searchConcepts(brief,{provisionalSetbacksMm:assumptions.setbacksMm,workingCoverageLimit:assumptions.coverageLimit,vastuAlternatives:true});
    for(const c of [...result.candidates,...(result.parkingProgramVariant?.candidates||[])]){
      Object.defineProperty(c,'planningBrief',{value:c.programChange?result.parkingProgramVariant.brief:brief,enumerable:false});
      c.entrance=brief.site.entrance||null;}
    return {brief,assumptions,result};});
  const [first,...rest]=runs;
  const result={...first.result,candidates:runs.flatMap(r=>r.result.candidates),attempts:runs.flatMap(r=>r.result.attempts)};
  if(rest.some(r=>r.result.parkingProgramVariant)&&!result.parkingProgramVariant)result.parkingProgramVariant=rest.find(r=>r.result.parkingProgramVariant).result.parkingProgramVariant;
  return {label,brief:first.brief,briefs,assumptions:first.assumptions,result};
}
const {planningBriefs}=require('./plotFit');
module.exports={buildReviewCase,renderReviewDocument,planSvg};
