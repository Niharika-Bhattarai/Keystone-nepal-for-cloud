'use strict';
// Sanitary layout for review: soil (SP) and waste (WP) stacks for each wet room,
// floor traps, branch routes, inspection chambers at stack bases, a ground drain
// run to an indicative septic tank and soak pit, and measured separations from
// the underground reservoir. Pipe sizes, falls, tank and pit sizes are NOT
// designed here (NBC 208 / engineer). Where a municipal sewer exists it should
// be used instead of a septic tank and soak pit.
const STACK_MERGE_MM=400,CHAMBER_MM=600,TANK={w:2000,d:1000},PIT_D=1200;
const centre=b=>({x:(b.x1+b.x2)/2,y:(b.y1+b.y2)/2});
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const insideAny=(p,boxes)=>boxes.some(s=>p.x>s.x1&&p.x<s.x2&&p.y>s.y1&&p.y<s.y2);

// A stack runs on the outside face of an exterior wall next to the main fixture
// (common Nepali practice), else inside a corner duct that needs a shaft.
function stackFor(room,fixture,level){
  const c=room.clearBox||room.box,slabs=level.footprint.slabs,f=fixture?centre(fixture.box):centre(c);
  const edges=[['south',{x:f.x,y:room.box.y1-120}],['north',{x:f.x,y:room.box.y2+120}],
    ['west',{x:room.box.x1-120,y:f.y}],['east',{x:room.box.x2+120,y:f.y}]];
  const ext=edges.filter(([,p])=>!insideAny(p,slabs)).sort((a,b)=>dist(a[1],f)-dist(b[1],f));
  if(ext.length)return {point:ext[0][1],placement:'external_on_wall',face:ext[0][0]};
  const corners=[{x:c.x1+100,y:c.y1+100},{x:c.x2-100,y:c.y1+100},{x:c.x1+100,y:c.y2-100},{x:c.x2-100,y:c.y2-100}];
  corners.sort((a,b)=>dist(a,f)-dist(b,f));
  return {point:corners[0],placement:'internal_duct_required'};
}

function sanitaryPlan(candidate,furnish){
  const levels=candidate.levels,stacks=[],floors=[];
  const reservoir=candidate.core.reservoir?.innerPlanBox||null;
  levels.forEach((level,li)=>{
    const items=furnish(level).items,wet=(level.rooms?.rooms||[]).filter(r=>['bathroom','kitchen','laundry'].includes(r.type));
    const fixtures=items.filter(i=>['wc','basin','shower','sink','washer'].includes(i.kind));
    const traps=[],branches=[];
    for(const room of wet){
      const mine=fixtures.filter(f=>f.roomId===room.id);
      const main=mine.find(f=>f.kind==='wc')||mine.find(f=>f.kind==='sink')||mine[0];
      const kind=room.type==='bathroom'?'SP':'WP';
      const s=stackFor(room,main,level);
      // Reuse a stack of the same kind from the floor below when it is within reach.
      let stack=stacks.find(st=>st.kind===kind&&st.levels.includes(levels[li-1]?.id)&&dist(st.point,s.point)<=STACK_MERGE_MM);
      if(!stack){stack={id:`${kind}${stacks.filter(x=>x.kind===kind).length+1}`,kind,point:s.point,placement:s.placement,
        face:s.face,levels:[],topLevelId:level.id};stacks.push(stack);}
      stack.levels.push(level.id);stack.topLevelId=level.id;
      if(room.type==='bathroom'){const c=room.clearBox||room.box,sh=mine.find(f=>f.kind==='shower');
        traps.push({roomId:room.id,point:sh?centre(sh.box):{x:(c.x1+c.x2)/2,y:(c.y1+c.y2)/2},kind:'FT'});}
      for(const f of mine)branches.push({roomId:room.id,from:centre(f.box),to:stack.point,stackId:stack.id,fixture:f.kind});
      room.stackId=stack.id;
    }
    floors.push({levelId:level.id,fixtures,traps,branches});
  });
  // A stack must reach the ground: stacks starting on upper floors drop to the
  // ground along the same wall face (external) or need a duct through lower rooms.
  for(const st of stacks){const start=levels.findIndex(l=>l.id===st.levels[0]);
    st.dropsThroughLevelIds=levels.slice(0,start).filter(l=>insideAny(st.point,l.footprint.slabs)).map(l=>l.id);
    st.status=st.placement==='internal_duct_required'||st.dropsThroughLevelIds.length?'duct_through_lower_floor_review':'external_stack_to_ground';}
  // Ground: inspection chamber at each stack base, drain to septic tank, then soak pit.
  const ground=levels[0],slab=ground.footprint.slabs,site=candidate.envelope.site;
  const bb={x1:Math.min(...slab.map(s=>s.x1)),y1:Math.min(...slab.map(s=>s.y1)),x2:Math.max(...slab.map(s=>s.x2)),y2:Math.max(...slab.map(s=>s.y2))};
  const chambers=stacks.map((st,i)=>{const p=st.point;
    const outside=!insideAny(p,slab);
    const at=outside?p:{x:p.x,y:bb.y1-450};// internal stacks are led to the front wall
    return {id:`IC${i+1}`,stackId:st.id,point:at,box:{x1:at.x-CHAMBER_MM/2,y1:at.y-CHAMBER_MM/2,x2:at.x+CHAMBER_MM/2,y2:at.y+CHAMBER_MM/2},
      outsideBuilding:outside};});
  // Septic tank: under the open front bike bay when there is one (accessible
  // manholes), else along the front (road) edge, partly under the ground slab.
  const bay=ground.rooms?.parking?.box;
  const tankAt=bay?{x:(bay.x1+bay.x2)/2,y:bay.y1+TANK.d/2+300}:{x:(bb.x1+bb.x2)/2,y:bb.y1+TANK.d/2-200};
  const tank={box:{x1:tankAt.x-TANK.w/2,y1:tankAt.y-TANK.d/2,x2:tankAt.x+TANK.w/2,y2:tankAt.y+TANK.d/2},
    location:bay?'under_open_bike_bay':'front_edge_partly_under_ground_slab',sizeStatus:'indicative_size_by_engineer'};
  // A chamber never sits on the tank: slide it clear along the front.
  for(const ch of chambers)if(Math.min(ch.box.x2,tank.box.x2)>Math.max(ch.box.x1,tank.box.x1)&&Math.min(ch.box.y2,tank.box.y2)>Math.max(ch.box.y1,tank.box.y1)){
    const x=ch.point.x<tankAt.x?tank.box.x1-CHAMBER_MM/2-150:tank.box.x2+CHAMBER_MM/2+150;
    ch.point={x,y:ch.point.y};ch.box={x1:x-CHAMBER_MM/2,y1:ch.point.y-CHAMBER_MM/2,x2:x+CHAMBER_MM/2,y2:ch.point.y+CHAMBER_MM/2};ch.shiftedClearOfTank=true;}
  // Soak pit: the open-ground corner farthest from the reservoir.
  const ring=[{x:site.x1+PIT_D/2+100,y:site.y1+PIT_D/2+100},{x:site.x2-PIT_D/2-100,y:site.y1+PIT_D/2+100},
    {x:site.x1+PIT_D/2+100,y:site.y2-PIT_D/2-100},{x:site.x2-PIT_D/2-100,y:site.y2-PIT_D/2-100}];
  const resC=reservoir?centre(reservoir):centre(bb);
  ring.sort((a,b)=>dist(b,resC)-dist(a,resC));
  const pit={centre:ring[0],diameterMm:PIT_D,sizeStatus:'indicative_size_by_engineer',
    partlyUnderBuilding:insideAny(ring[0],slab)};
  // Drain runs stay in the open setback ring around the building (never under
  // rooms or across the water reservoir) and enter the tank from the front.
  const path={x1:bb.x1-450,y1:bb.y1-450,x2:bb.x2+450,y2:bb.y2+450};
  const tC=centre(tank.box),tankEntry={x:tC.x,y:path.y1};
  const runs=chambers.map(ch=>({from:ch.id,to:'tank',points:[...ringPath(path,ch.point,tankEntry),{x:tC.x,y:tank.box.y1}]}));
  runs.push({from:'tank',to:'soak pit',points:[{x:tC.x,y:tank.box.y1},...ringPath(path,tankEntry,pit.centre),pit.centre]});
  const separations=reservoir?{tankToReservoirMm:Math.round(gap(tank.box,reservoir)),
    pitToReservoirMm:Math.round(Math.max(0,dist(pit.centre,resC)-PIT_D/2)),
    note:'Separation between sewage and the drinking-water reservoir must be checked by the engineer against the adopted sanitary code.'}:null;
  const findings=[];
  if(stacks.some(s=>s.status!=='external_stack_to_ground'))findings.push({code:'SANITARY_STACK_DUCT_REVIEW',
    stacks:stacks.filter(s=>s.status!=='external_stack_to_ground').map(s=>s.id)});
  if(tank.location!=='under_open_bike_bay')findings.push({code:'SEPTIC_TANK_LOCATION_REVIEW',location:tank.location});
  if(pit.partlyUnderBuilding||site.x2-bb.x2<PIT_D||bb.x1-site.x1<PIT_D)findings.push({code:'SOAK_PIT_SPACE_REVIEW',
    note:'Setback ring is narrower than the indicative soak-pit diameter; consider municipal sewer or a pit under open paving.'});
  if(separations)findings.push({code:'SEWAGE_RESERVOIR_SEPARATION_REVIEW',...separations});
  return {stacks,floors,chambers,tank,pit,runs,separations,findings,
    notes:['Connect to the municipal sewer where available; septic tank and soak pit only where none exists.',
      'Pipe sizes, gradients (falls), traps, vents, tank volume and soak-pit size by the engineer (NBC 208 / IS 2470).',
      'External stacks are fixed to exterior walls with clamps; internal stacks need a ventilated, accessible duct.',
      'Inspection chambers at every stack base and change of direction; cleanouts at branch ends.',
      'Rainwater outlets and downpipes are shown on the roof plan; keep rainwater out of the septic tank.']};
}
// Shortest walk along a rectangular ring between the ring points nearest a and b.
function ringPath(r,a,b){
  const snap=p=>{const c={x:Math.min(Math.max(p.x,r.x1),r.x2),y:Math.min(Math.max(p.y,r.y1),r.y2)};
    const d=[[Math.abs(c.x-r.x1),{x:r.x1,y:c.y}],[Math.abs(c.x-r.x2),{x:r.x2,y:c.y}],[Math.abs(c.y-r.y1),{x:c.x,y:r.y1}],[Math.abs(c.y-r.y2),{x:c.x,y:r.y2}]];
    return d.sort((m,n)=>m[0]-n[0])[0][1];};
  const W=r.x2-r.x1,H=r.y2-r.y1,P=2*(W+H);
  const pos=p=>p.y===r.y1?p.x-r.x1:p.x===r.x2?W+(p.y-r.y1):p.y===r.y2?W+H+(r.x2-p.x):2*W+H+(r.y2-p.y);
  const at=t=>{t=((t%P)+P)%P;if(t<=W)return {x:r.x1+t,y:r.y1};if(t<=W+H)return {x:r.x2,y:r.y1+t-W};
    if(t<=2*W+H)return {x:r.x2-(t-W-H),y:r.y2};return {x:r.x1,y:r.y2-(t-2*W-H)};};
  const sa=snap(a),sb=snap(b),ta=pos(sa),tb=pos(sb);
  const fwd=((tb-ta)%P+P)%P,dir=fwd<=P-fwd?1:-1,len=dir>0?fwd:P-fwd;
  const corners=[W,W+H,2*W+H,P].map(c=>c%P),pts=[a,sa];
  const steps=corners.map(c=>dir>0?((c-ta)%P+P)%P:((ta-c)%P+P)%P).map((d,i)=>[d,corners[i]]).filter(([d])=>d>0&&d<len).sort((m,n)=>m[0]-n[0]);
  for(const [,c] of steps)pts.push(at(c));
  pts.push(sb);return pts;
}
function gap(a,b){const dx=Math.max(0,a.x1-b.x2,b.x1-a.x2),dy=Math.max(0,a.y1-b.y2,b.y1-a.y2);return Math.hypot(dx,dy);}
module.exports={sanitaryPlan};
