'use strict';
// Printable A3 review drawing set for one Nepal spatial hypothesis, following
// knowledge/DRAWING-STANDARD.md (derived from the owner's sample drawing sets):
// site plan with area table, floor plans with grids, chain dimensions, room
// sizes and opening tags, elevations, section X-X, opening schedule, and a
// structural LAYOUT sheet with preliminary sizes only. Every sheet is stamped
// "for review". Signatures, "checked by" and NEC numbers are never filled.
// Sheets are drawn true to scale for A3 landscape (420 x 297 mm).
const {exportCandidateGeometry}=require('./geometryExport');
const {AREA_SQFT}=require('./units');

const SHEET_W=420,SHEET_H=297,STRIP=26,MARGIN=10,BIND=20;
const DRAW={x1:BIND,y1:MARGIN+8,x2:SHEET_W-MARGIN,y2:SHEET_H-MARGIN-STRIP-2};
const SILL_MM=900,WINDOW_HEAD_MM=2100,DOOR_HEAD_MM=2100,PARAPET_MM=1000;
const STATUS='FOR REVIEW ONLY — NOT FOR CONSTRUCTION OR PERMIT';
const PROFESSIONAL=['Municipal bylaw adoption (setbacks vary by municipality)',
  'Structural analysis and reinforcement design (NBC 105, IS 456, IS 13920)',
  'Soil investigation, footing sizes, soft-storey and torsion checks',
  'Stair headroom, door swings and egress','Daylight and ventilation legality',
  'Balcony guards and drainage','Reservoir and tank engineering',
  'Sanitary design: pipe sizes, falls, septic tank and soak pit',
  'NEC-registered architect and engineer signatures'];

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const r1=n=>Math.round(n*10)/10;
function ftin(mm){
  const inches=Math.round(mm/25.4),ft=Math.floor(inches/12),i=inches-ft*12;
  return `${ft}'-${i}"`;
}
const sqft=m2=>m2/0.09290304;
// Ropani-aana-paisa-daam (1 ropani = 16 aana = 64 paisa = 256 daam).
function rapd(m2){
  const daam=Math.round(sqft(m2)/AREA_SQFT.daam*100)/100;
  const r=Math.floor(daam/256),a=Math.floor((daam-r*256)/16),p=Math.floor((daam-r*256-a*16)/4);
  const d=r1(daam-r*256-a*16-p*4);
  return `${r}-${a}-${p}-${d}`;
}
const boxArea=b=>(b.x2-b.x1)*(b.y2-b.y1)/1e6;
const ROOM_NAMES={livingRoom:'LIVING',kitchen:'KITCHEN + DINING',primaryBedroom:'MASTER BEDROOM',
  bedroom:'BEDROOM',guestBedroom:'GUEST BEDROOM',bathroom:'TOILET/BATH',puja:'PUJA',
  primaryAlcove:'BEDROOM ALCOVE',livingAnnex:'LIVING ANNEX',diningAnnex:'DINING',
  utilityFlex:'UTILITY',serviceNiche:'STORE/UTILITY',study:'STUDY',store:'STORE',laundry:'LAUNDRY'};
const roomName=r=>r.useIntent?.startsWith('bedroom_entry_vestibule')?'VESTIBULE':ROOM_NAMES[r.type]||r.type.toUpperCase();

// ---------- geometry helpers ----------
function viewport(bounds,area,scale){
  // Model mm -> sheet mm at 1:scale, centred in `area`, y up.
  const k=1/scale,w=(bounds.x2-bounds.x1)*k,h=(bounds.y2-bounds.y1)*k;
  const ox=area.x1+(area.x2-area.x1-w)/2,oy=area.y2-(area.y2-area.y1-h)/2;
  return {k,x:x=>ox+(x-bounds.x1)*k,y:y=>oy-(y-bounds.y1)*k,w,h};
}
function fitScale(bounds,area,scales=[50,75,100,125,150,200,250]){
  for(const s of scales)if((bounds.x2-bounds.x1)/s<=area.x2-area.x1&&(bounds.y2-bounds.y1)/s<=area.y2-area.y1)return s;
  return scales.at(-1);
}
const rectSvg=(v,b,attrs)=>`<rect x="${v.x(b.x1)}" y="${v.y(b.y2)}" width="${(b.x2-b.x1)*v.k}" height="${(b.y2-b.y1)*v.k}" ${attrs}/>`;
const text=(x,y,s,size=2.4,attrs='')=>`<text x="${x}" y="${y}" font-size="${size}" ${attrs}>${esc(s)}</text>`;
function outerBounds(boxes){return {x1:Math.min(...boxes.map(b=>b.x1)),y1:Math.min(...boxes.map(b=>b.y1)),
  x2:Math.max(...boxes.map(b=>b.x2)),y2:Math.max(...boxes.map(b=>b.y2))};}
function compassOf(normal,bearingDegrees){
  const a=bearingDegrees*Math.PI/180,north={x:Math.cos(a),y:Math.sin(a)},east={x:Math.sin(a),y:-Math.cos(a)};
  const n=normal.x*north.x+normal.y*north.y,e=normal.x*east.x+normal.y*east.y;
  return Math.abs(n)>=Math.abs(e)?(n>0?'NORTH':'SOUTH'):(e>0?'EAST':'WEST');
}
const FACE_NORMAL={west:{x:-1,y:0},east:{x:1,y:0},south:{x:0,y:-1},north:{x:0,y:1}};

// ---------- opening schedule ----------
function openingKind(o){
  if(o.opening?.leafCount)return 'door';
  if(/exposure|window/.test(o.opening?.status||'')||o.opening?.assumedClearHeightMm)return 'window';
  return 'portal';
}
function buildOpeningSchedule(candidate){
  const groups=new Map(),refs=[];
  const add=(kind,widthMm,heightMm,sillMm,ref,leaves=1)=>{
    const key=`${kind}|${widthMm}|${heightMm}|${sillMm}|${leaves}`;
    if(!groups.has(key))groups.set(key,{kind,widthMm,heightMm,sillMm,leaves,count:0});
    groups.get(key).count++;refs.push({...ref,key});
  };
  const entry=candidate.core.siteEntry;
  if(entry)add('main',entry.clearWidthMm,DOOR_HEAD_MM,0,{levelId:candidate.levels[0].id,siteEntry:true},entry.leafCount||2);
  for(const level of candidate.levels)for(const wall of level.walls?.walls||[])
    wall.openingBoxes.forEach((o,i)=>{
      const kind=openingKind(o);if(kind==='portal')return;
      const width=Math.round((o.end-o.start)/25)*25;
      if(o.opening===entry)return;
      if(kind==='window')add('window',width,o.opening.assumedClearHeightMm||WINDOW_HEAD_MM-SILL_MM,SILL_MM,{levelId:level.id,wallId:wall.id,index:i});
      else add('door',width,DOOR_HEAD_MM,0,{levelId:level.id,wallId:wall.id,index:i});
    });
  const order={main:0,door:1,window:2};
  const rows=[...groups.entries()].sort((a,b)=>order[a[1].kind]-order[b[1].kind]||b[1].widthMm-a[1].widthMm);
  const counters={main:0,door:0,window:0},tags=new Map();
  for(const [key,g] of rows){
    counters[g.kind]++;
    g.tag=g.kind==='main'?(counters.main>1?`MD${counters.main}`:'MD'):g.kind==='door'?`D${counters.door}`:`W${counters.window}`;
    tags.set(key,g.tag);
  }
  const portals=candidate.levels.reduce((n,l)=>n+(l.walls?.walls||[]).reduce((m,w)=>
    m+w.openingBoxes.filter(o=>openingKind(o)==='portal').length,0),0);
  const tagOf=(levelId,wallId,index)=>tags.get(refs.find(r=>r.levelId===levelId&&r.wallId===wallId&&r.index===index)?.key);
  return {rows:rows.map(([,g])=>g),tagOf,portals};
}

// ---------- structural preliminary layout ----------
function structuralLayout(candidate){
  const g=candidate.grid,cols=g.columns,ground=candidate.levels[0].footprint.slabs;
  const inSlab=(x,y)=>ground.some(s=>x>=s.x1&&x<=s.x2&&y>=s.y1&&y<=s.y2);
  const at=new Set(cols.map(c=>`${c.xMm},${c.yMm}`));
  const beams=[];
  const depth=span=>Math.max(300,Math.ceil(span/12/25)*25);
  for(const y of g.yAxesMm)for(let i=0;i+1<g.xAxesMm.length;i++){
    const [a,b]=[g.xAxesMm[i],g.xAxesMm[i+1]];
    if(at.has(`${a},${y}`)&&at.has(`${b},${y}`)&&inSlab((a+b)/2,y))beams.push({axis:'x',line:y,from:a,to:b,spanMm:b-a});
  }
  for(const x of g.xAxesMm)for(let i=0;i+1<g.yAxesMm.length;i++){
    const [a,b]=[g.yAxesMm[i],g.yAxesMm[i+1]];
    if(at.has(`${x},${a}`)&&at.has(`${x},${b}`)&&inSlab(x,(a+b)/2))beams.push({axis:'y',line:x,from:a,to:b,spanMm:b-a});
  }
  const beamTypes=new Map();
  for(const b of beams){const d=depth(b.spanMm);const key=`230x${d}`;
    if(!beamTypes.has(key))beamTypes.set(key,{id:`B${beamTypes.size+1}`,widthMm:230,depthMm:d,maxSpanMm:0,count:0});
    const t=beamTypes.get(key);t.count++;t.maxSpanMm=Math.max(t.maxSpanMm,b.spanMm);b.type=t.id;}
  const panels=[];
  for(let i=0;i+1<g.xAxesMm.length;i++)for(let j=0;j+1<g.yAxesMm.length;j++){
    const lx=g.xAxesMm[i+1]-g.xAxesMm[i],ly=g.yAxesMm[j+1]-g.yAxesMm[j];
    if(!inSlab((g.xAxesMm[i]+g.xAxesMm[i+1])/2,(g.yAxesMm[j]+g.yAxesMm[j+1])/2))continue;
    const short=Math.min(lx,ly),mf=1.4,d=short/(26*mf),D=Math.max(125,Math.ceil((d+15+5)/5)*5);
    panels.push({shortSpanMm:short,longSpanMm:Math.max(lx,ly),preliminaryThicknessMm:D});
  }
  return {columns:cols.map(c=>({...c,type:'C1'})),beams,beamTypes:[...beamTypes.values()],
    slabThicknessMm:Math.max(...panels.map(p=>p.preliminaryThicknessMm),125),panels,
    basis:['Beam depth ≈ span/12 (25 mm per 300 mm span), min 300 mm, width 230 mm to suit 9" walls',
      'Slab effective depth = shorter span / (26 × MF), MF assumed 1.4; 15 mm cover + 5 mm',
      'Column 350 × 350 mm from the owner construction profile (NBC 205:2024 detailing minimum reported as 320 mm)'],
    status:'preliminary_layout_not_structural_design'};
}

// ---------- sheet frame ----------
function frame({no,title,scale,project,date,inner}){
  const y=SHEET_H-MARGIN-STRIP,cells=[
    [BIND,120,[['KEYSTONE NEPAL',3.6,'font-weight="700"'],['automated review drawing',2.2]]],
    [120,215,[[project.title,2.6,'font-weight="700"'],[project.location,2.2],[`Plot ${project.plot}`,2.2]]],
    [215,280,[[title,2.6,'font-weight="700"'],[project.option,2.2],[project.kind(no),2.2]]],
    [280,345,[['DRAWN BY: Keystone (automated)',2.1],['CHECKED BY: —',2.1],['NEC NO.: —   SIGNATURE: —',2.1]]],
    [345,385,[[`DATE: ${date}`,2.1],[`SCALE: ${scale?`1:${scale} at A3`:'NTS'}`,2.1],['UNITS: see notes',2.1]]],
    [385,SHEET_W-MARGIN,[['SHEET NO.',2.1],[no,4.2,'font-weight="700"']]]];
  let s=`<rect x="${BIND-4}" y="${MARGIN-4}" width="${SHEET_W-MARGIN-BIND+8}" height="${SHEET_H-2*MARGIN+8}" fill="none" stroke="#111" stroke-width="0.5"/>`;
  s+=`<rect x="${BIND}" y="${y}" width="${SHEET_W-MARGIN-BIND}" height="${STRIP}" fill="#fff" stroke="#111" stroke-width="0.35"/>`;
  for(const [x1,x2,lines] of cells){
    if(x1>BIND)s+=`<line x1="${x1}" y1="${y}" x2="${x1}" y2="${y+STRIP}" stroke="#111" stroke-width="0.25"/>`;
    lines.forEach(([t,size,attrs],i)=>{s+=text(x1+2,y+6+i*7,t,size,attrs||'');});
  }
  s+=text(SHEET_W-MARGIN-2,MARGIN+3,STATUS,3,'text-anchor="end" fill="#a3221a" font-weight="700"');
  return `<section class="sheet"><svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}mm" height="${SHEET_H}mm" viewBox="0 0 ${SHEET_W} ${SHEET_H}" font-family="Arial, Helvetica, sans-serif">${s}${inner}</svg></section>`;
}
function northArrow(x,y,bearing){
  const a=-bearing*Math.PI/180;// sheet y is down; bearing CCW from +x
  const dx=Math.cos(a)*7,dy=Math.sin(a)*7;
  return `<g><circle cx="${x}" cy="${y}" r="8" fill="none" stroke="#111" stroke-width="0.3"/>`+
    `<line x1="${x-dx}" y1="${y-dy}" x2="${x+dx}" y2="${y+dy}" stroke="#111" stroke-width="0.5" marker-end="url(#arr)"/>`+
    text(x+dx*1.45,y+dy*1.45+1,'N',3,'text-anchor="middle" font-weight="700"')+'</g>';
}
const DEFS='<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#111"/></marker>'+
  '<pattern id="hatch" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2" stroke="#777" stroke-width="0.25"/></pattern></defs>';

// Dimension chain along one side. ticks: model coordinates along the axis.
function chain(v,axis,ticks,offset,side,label=mm=>ftin(mm)){
  let s='';const pts=[...new Set(ticks)].sort((a,b)=>a-b);if(pts.length<2)return s;
  for(let i=0;i<pts.length;i++){
    if(axis==='x'){const X=v.x(pts[i]);s+=`<line x1="${X}" y1="${offset-1.2}" x2="${X}" y2="${offset+1.2}" stroke="#111" stroke-width="0.25"/>`;}
    else{const Y=v.y(pts[i]);s+=`<line x1="${offset-1.2}" y1="${Y}" x2="${offset+1.2}" y2="${Y}" stroke="#111" stroke-width="0.25"/>`;}
  }
  if(axis==='x')s+=`<line x1="${v.x(pts[0])}" y1="${offset}" x2="${v.x(pts.at(-1))}" y2="${offset}" stroke="#111" stroke-width="0.2"/>`;
  else s+=`<line x1="${offset}" y1="${v.y(pts[0])}" x2="${offset}" y2="${v.y(pts.at(-1))}" stroke="#111" stroke-width="0.2"/>`;
  for(let i=0;i+1<pts.length;i++){
    const len=pts[i+1]-pts[i];if(len*v.k<3.2)continue;
    const mid=(pts[i]+pts[i+1])/2;
    if(axis==='x')s+=text(v.x(mid),offset+(side==='top'?-0.8:2.4),label(len),1.8,'text-anchor="middle"');
    else s+=text(offset+(side==='left'?-0.8:0.8),v.y(mid),label(len),1.8,`text-anchor="middle" transform="rotate(-90 ${offset+(side==='left'?-0.8:0.8)} ${v.y(mid)})"`);
  }
  return s;
}
function exteriorTicks(level,face){
  const walls=(level.walls?.walls||[]).filter(w=>w.kind==='exterior'&&w.face===face);
  const t=[];for(const w of walls){t.push(w.start,w.end);for(const o of w.openingBoxes)t.push(o.start,o.end);}
  return t;
}

// ---------- floor plan ----------
function planDrawing(candidate,level,schedule,area,scale,{showSection=false,structural=false}={}){
  const slabs=level.footprint.slabs,b=outerBounds(slabs),g=candidate.grid;
  const pad=2600;// room for chains and bubbles (model mm)
  const bounds={x1:b.x1-pad,y1:b.y1-pad,x2:b.x2+pad,y2:b.y2+pad};
  const v=viewport(bounds,area,scale);let s='';
  for(const sl of slabs)s+=rectSvg(v,sl,'fill="#fff" stroke="#111" stroke-width="0.18"');
  // grid lines and bubbles
  const letters='ABCDEFGHJKLMN';
  g.xAxesMm.forEach((x,i)=>{s+=`<line x1="${v.x(x)}" y1="${v.y(b.y2+1900)}" x2="${v.x(x)}" y2="${v.y(b.y1-1900)}" stroke="#888" stroke-width="0.12" stroke-dasharray="3 1 0.5 1"/>`;
    for(const yy of [b.y2+2200,b.y1-2200])s+=`<circle cx="${v.x(x)}" cy="${v.y(yy)}" r="2.6" fill="#fff" stroke="#111" stroke-width="0.25"/>`+text(v.x(x),v.y(yy)+1,letters[i],2.4,'text-anchor="middle"');});
  g.yAxesMm.forEach((y,i)=>{s+=`<line x1="${v.x(b.x1-1900)}" y1="${v.y(y)}" x2="${v.x(b.x2+1900)}" y2="${v.y(y)}" stroke="#888" stroke-width="0.12" stroke-dasharray="3 1 0.5 1"/>`;
    for(const xx of [b.x1-2200,b.x2+2200])s+=`<circle cx="${v.x(xx)}" cy="${v.y(y)}" r="2.6" fill="#fff" stroke="#111" stroke-width="0.25"/>`+text(v.x(xx),v.y(y)+1,String(i+1),2.4,'text-anchor="middle"');});
  if(!structural){
    for(const r of level.rooms?.rooms||[])if(r.type==='bathroom')s+=rectSvg(v,r.clearBox||r.box,'fill="#eef3f6"');
    // parking and balcony
    if(level.rooms?.parking)s+=rectSvg(v,level.rooms.parking.box,'fill="url(#hatch)" stroke="none"');
    // walls
    for(const w of level.walls?.walls||[])for(const sb of w.solidBoxes)s+=rectSvg(v,sb,`fill="${w.kind==='exterior'?'#222':'#555'}" stroke="none"`);
    // openings
    for(const w of level.walls?.walls||[])w.openingBoxes.forEach((o,i)=>{
      const kind=openingKind(o),bx=o.box,vert=w.axis==='vertical';
      if(kind==='window'){
        s+=rectSvg(v,bx,'fill="#fff" stroke="#111" stroke-width="0.15"');
        const mid=vert?(bx.x1+bx.x2)/2:(bx.y1+bx.y2)/2;
        s+=vert?`<line x1="${v.x(mid)}" y1="${v.y(bx.y1)}" x2="${v.x(mid)}" y2="${v.y(bx.y2)}" stroke="#111" stroke-width="0.15"/>`:
          `<line x1="${v.x(bx.x1)}" y1="${v.y(mid)}" x2="${v.x(bx.x2)}" y2="${v.y(mid)}" stroke="#111" stroke-width="0.15"/>`;
      }else if(kind==='door'){
        // Leaf and dashed swing; hinge side and swing direction remain unverified.
        const len=(o.end-o.start)*v.k;
        if(vert){const X=v.x(w.line),Y=v.y(o.start);s+=`<line x1="${X}" y1="${Y}" x2="${X+len}" y2="${Y}" stroke="#7a2e12" stroke-width="0.3"/><path d="M${X+len},${Y} A${len},${len} 0 0 0 ${X},${Y-len}" fill="none" stroke="#7a2e12" stroke-width="0.15" stroke-dasharray="0.8 0.6"/>`;}
        else{const X=v.x(o.start),Y=v.y(w.line);s+=`<line x1="${X}" y1="${Y}" x2="${X}" y2="${Y-len}" stroke="#7a2e12" stroke-width="0.3"/><path d="M${X},${Y-len} A${len},${len} 0 0 1 ${X+len},${Y}" fill="none" stroke="#7a2e12" stroke-width="0.15" stroke-dasharray="0.8 0.6"/>`;}
      }else s+=rectSvg(v,bx,'fill="#fff" stroke="none"');
      const tag=kind==='portal'?null:schedule.tagOf(level.id,w.id,i);
      // Tags sit inside the room so they never collide with the dimension chains.
      if(tag){const cx=vert?v.x(w.line)+(w.face==='east'?-4.2:4.2):v.x((o.start+o.end)/2),cy=vert?v.y((o.start+o.end)/2):v.y(w.line)+(w.face==='north'?4.2:-4.2);
        s+=`<ellipse cx="${cx}" cy="${cy}" rx="3" ry="2" fill="#fff" stroke="#111" stroke-width="0.2"/>`+text(cx,cy+0.8,tag,1.9,'text-anchor="middle"');}
    });
    // stair
    if(candidate.core.levelIds.includes(level.id)){
      const fl=candidate.core.flights[0];
      for(const f of fl?.flights||[]){s+=rectSvg(v,f.box,'fill="#fff" stroke="#111" stroke-width="0.15"');
        for(let k=1;k<f.riserCount;k++){const yy=f.box.y1+(f.box.y2-f.box.y1)*k/f.riserCount;
          s+=`<line x1="${v.x(f.box.x1)}" y1="${v.y(yy)}" x2="${v.x(f.box.x2)}" y2="${v.y(yy)}" stroke="#111" stroke-width="0.1"/>`;}}
      if(fl)s+=text(v.x((fl.flights[0].box.x1+fl.flights[0].box.x2)/2),v.y(fl.flights[0].box.y1)-1,'UP',2,'text-anchor="middle" fill="#7a2e12"');
    }
    // columns
    for(const c of g.columns)if(slabs.some(sl=>c.xMm>=sl.x1&&c.xMm<=sl.x2&&c.yMm>=sl.y1&&c.yMm<=sl.y2)){
      const h=c.widthMm/2;s+=rectSvg(v,{x1:c.xMm-h,y1:c.yMm-h,x2:c.xMm+h,y2:c.yMm+h},'fill="#111"');}
    // room labels
    for(const r of level.rooms?.rooms||[]){const c=r.clearBox||r.box,cx=v.x((c.x1+c.x2)/2),cy=v.y((c.y1+c.y2)/2);
      s+=text(cx,cy-0.6,roomName(r),2.1,'text-anchor="middle" font-weight="700"');
      s+=text(cx,cy+2.2,`${ftin(c.x2-c.x1)} X ${ftin(c.y2-c.y1)}`,1.8,'text-anchor="middle"');}
    if(level.rooms?.parking){const p=level.rooms.parking.box;s+=text(v.x((p.x1+p.x2)/2),v.y((p.y1+p.y2)/2),'OPEN BIKE PARKING',2.1,'text-anchor="middle" font-weight="700"');}
    if(level.rooms?.balcony){const p=level.rooms.balcony.box;s+=text(v.x((p.x1+p.x2)/2),v.y((p.y1+p.y2)/2),'BALCONY',2.1,'text-anchor="middle" font-weight="700"');}
  }else{
    // structural layout: columns with IDs and beams on grid lines
    const st=structuralLayout(candidate);
    for(const bm of st.beams){const w=115;
      const box=bm.axis==='x'?{x1:bm.from,y1:bm.line-w,x2:bm.to,y2:bm.line+w}:{x1:bm.line-w,y1:bm.from,x2:bm.line+w,y2:bm.to};
      s+=rectSvg(v,box,'fill="none" stroke="#111" stroke-width="0.15" stroke-dasharray="1 0.6"');
      const mx=bm.axis==='x'?(bm.from+bm.to)/2:bm.line,my=bm.axis==='x'?bm.line:(bm.from+bm.to)/2;
      s+=text(v.x(mx)+(bm.axis==='y'?1.2:0),v.y(my)-(bm.axis==='x'?1:0),bm.type,1.8,`text-anchor="${bm.axis==='y'?'start':'middle'}" fill="#a3221a"`);}
    for(const c of st.columns){const h=c.widthMm/2;s+=rectSvg(v,{x1:c.xMm-h,y1:c.yMm-h,x2:c.xMm+h,y2:c.yMm+h},'fill="#111"');
      s+=text(v.x(c.xMm)+1.8,v.y(c.yMm)-1.6,c.type,1.7);}
  }
  // dimensions: openings (exterior, architectural), grid, overall
  const unit=structural?(mm=>String(Math.round(mm))):ftin;
  const top=v.y(b.y2),bot=v.y(b.y1),lef=v.x(b.x1),rig=v.x(b.x2);
  if(!structural){s+=chain(v,'x',exteriorTicks(level,'north'),top-4,'top',unit)+chain(v,'x',exteriorTicks(level,'south'),bot+4,'bottom',unit)+
    chain(v,'y',exteriorTicks(level,'west'),lef-4,'left',unit)+chain(v,'y',exteriorTicks(level,'east'),rig+4,'right',unit);}
  s+=chain(v,'x',[b.x1,...g.xAxesMm.filter(x=>x>b.x1&&x<b.x2),b.x2],top-8,'top',unit)+chain(v,'x',[b.x1,b.x2],top-12,'top',unit);
  s+=chain(v,'y',[b.y1,...g.yAxesMm.filter(y=>y>b.y1&&y<b.y2),b.y2],lef-8,'left',unit)+chain(v,'y',[b.y1,b.y2],lef-12,'left',unit);
  if(showSection&&!structural){const cx=(candidate.core.box.x1+candidate.core.box.x2)/2;
    s+=`<line x1="${v.x(cx)}" y1="${v.y(b.y2+1500)}" x2="${v.x(cx)}" y2="${v.y(b.y1-1500)}" stroke="#a3221a" stroke-width="0.3" stroke-dasharray="4 1 1 1"/>`;
    for(const yy of [b.y2+1500,b.y1-1500])s+=text(v.x(cx)+1.2,v.y(yy),'X',2.6,'fill="#a3221a" font-weight="700"');}
  return {svg:s,v,bounds:b};
}

// ---------- elevations and section ----------
function levelTops(geometry){return geometry.levels.map(l=>({id:l.id,z0:l.elevationMm,z1:l.elevationMm+l.storeyHeightMm}));}
function elevationDrawing(candidate,geometry,face,area,scale){
  const levels=candidate.levels,tops=levelTops(geometry);
  const along=face==='south'||face==='north'?'x':'y';
  const allSlabs=levels.flatMap(l=>l.footprint.slabs),b=outerBounds(allSlabs);
  const lo=along==='x'?b.x1:b.y1,hi=along==='x'?b.x2:b.y2;
  const flip=face==='north'||face==='west';// viewed from outside: mirror so left-right reads correctly
  const u=t=>flip?hi-(t-lo):t;
  const zTop=Math.max(...tops.map(t=>t.z1))+PARAPET_MM;
  const bounds={x1:lo-3600,y1:-600,x2:hi+600,y2:zTop+600};
  const v=viewport(bounds,area,scale);let s='';
  s+=`<line x1="${v.x(lo-1200)}" y1="${v.y(0)}" x2="${v.x(hi+500)}" y2="${v.y(0)}" stroke="#111" stroke-width="0.4"/>`;
  levels.forEach((level,i)=>{
    const {z0,z1}=tops[i],sl=level.footprint.slabs,lb=outerBounds(sl);
    const a=along==='x'?lb.x1:lb.y1,c=along==='x'?lb.x2:lb.y2;
    const [p,q]=[u(a),u(c)].sort((m,n)=>m-n);
    s+=`<rect x="${v.x(p)}" y="${v.y(z1)}" width="${(q-p)*v.k}" height="${(z1-z0)*v.k}" fill="#fff" stroke="#111" stroke-width="0.3"/>`;
    s+=`<line x1="${v.x(p)}" y1="${v.y(z0)}" x2="${v.x(q)}" y2="${v.y(z0)}" stroke="#111" stroke-width="0.35"/>`;
    for(const w of (level.walls?.walls||[]).filter(w=>w.kind==='exterior'&&w.face===face))
      for(const o of w.openingBoxes){const kind=openingKind(o);
        const [oa,ob]=[u(o.start),u(o.end)].sort((m,n)=>m-n);
        const zz0=z0+(kind==='window'?SILL_MM:0),zz1=z0+(kind==='window'?WINDOW_HEAD_MM:DOOR_HEAD_MM);
        s+=`<rect x="${v.x(oa)}" y="${v.y(zz1)}" width="${(ob-oa)*v.k}" height="${(zz1-zz0)*v.k}" fill="${kind==='window'?'#dfe9ef':'#e9e1d6'}" stroke="#111" stroke-width="0.2"/>`;}
    if(level.rooms?.parking&&face==='south'&&i===0){const pb=level.rooms.parking.box;
      const [pa,pc]=[u(along==='x'?pb.x1:pb.y1),u(along==='x'?pb.x2:pb.y2)].sort((m,n)=>m-n);
      s+=`<rect x="${v.x(pa)}" y="${v.y(z1-300)}" width="${(pc-pa)*v.k}" height="${(z1-300-z0)*v.k}" fill="#fff" stroke="#111" stroke-width="0.2"/>`;}
    // parapet where nothing sits above
    const above=levels[i+1]?.footprint.slabs;const hasAbove=above&&outerBounds(above);
    const ta=hasAbove?[u(along==='x'?hasAbove.x1:hasAbove.y1),u(along==='x'?hasAbove.x2:hasAbove.y2)].sort((m,n)=>m-n):null;
    const segs=ta?[[p,ta[0]],[ta[1],q]].filter(([m,n])=>n-m>1):[[p,q]];
    for(const [m,n] of segs)s+=`<rect x="${v.x(m)}" y="${v.y(z1+PARAPET_MM)}" width="${(n-m)*v.k}" height="${PARAPET_MM*v.k}" fill="#fff" stroke="#111" stroke-width="0.25"/>`;
  });
  // level tags
  const tag=(z,label)=>`<line x1="${v.x(lo)-26}" y1="${v.y(z)}" x2="${v.x(lo)-1}" y2="${v.y(z)}" stroke="#111" stroke-width="0.15"/>`+text(v.x(lo)-1.5,v.y(z)-0.6,label,1.6,'text-anchor="end"');
  s+=tag(0,'±0\'-0" PLINTH LVL');
  tops.forEach((t,i)=>{if(i)s+=tag(t.z0,`+${ftin(t.z0)} ${t.id.toUpperCase()} FLR LVL`);});
  s+=tag(zTop,`+${ftin(zTop)} PARAPET LVL`);
  return {svg:s,v,title:`${compassOf(FACE_NORMAL[face],geometry.northBearingDegrees??0)} ELEVATION`};
}
function sectionDrawing(candidate,geometry,area,scale){
  const levels=candidate.levels,tops=levelTops(geometry),core=candidate.core;
  const cx=(core.box.x1+core.box.x2)/2;
  const cut=level=>level.footprint.slabs.filter(s=>cx>=s.x1&&cx<=s.x2);
  const all=levels.flatMap(cut),b=outerBounds(all.length?all:levels[0].footprint.slabs);
  const zTop=Math.max(...tops.map(t=>t.z1))+PARAPET_MM;
  const bounds={x1:b.y1-2600,y1:-900,x2:b.y2+2600,y2:zTop+500};
  const v=viewport(bounds,area,scale);let s='';
  s+=`<rect x="${v.x(b.y1-1500)}" y="${v.y(0)}" width="${(b.y2-b.y1+3000)*v.k}" height="${600*v.k}" fill="url(#hatch)"/>`;
  levels.forEach((level,i)=>{const {z0,z1}=tops[i];
    for(const sl of cut(level)){
      s+=`<rect x="${v.x(sl.y1)}" y="${v.y(z1)}" width="${(sl.y2-sl.y1)*v.k}" height="${150*v.k}" fill="#555"/>`;
      for(const yy of [sl.y1,sl.y2-229])s+=`<rect x="${v.x(yy)}" y="${v.y(z1-150)}" width="${229*v.k}" height="${(z1-150-z0)*v.k}" fill="#bbb" stroke="#111" stroke-width="0.15"/>`;
      if(!levels[i+1]||!cut(levels[i+1]).length)for(const yy of [sl.y1,sl.y2-229])
        s+=`<rect x="${v.x(yy)}" y="${v.y(z1+PARAPET_MM)}" width="${229*v.k}" height="${PARAPET_MM*v.k}" fill="#bbb" stroke="#111" stroke-width="0.15"/>`;
    }});
  // stair flights in profile between each pair of floors
  const fl=core.flights[0];
  if(fl)tops.slice(0,-1).forEach((t,i)=>{if(!core.levelIds.includes(levels[i+1]?.id))return;
    fl.flights.forEach((f,k)=>{const zA=t.z0+(t.z1-t.z0)*k/2,zB=t.z0+(t.z1-t.z0)*(k+1)/2;
      const [ya,yb]=f.direction==='north'?[f.box.y1,f.box.y2]:[f.box.y2,f.box.y1];
      s+=`<line x1="${v.x(ya)}" y1="${v.y(zA)}" x2="${v.x(yb)}" y2="${v.y(zB)}" stroke="#111" stroke-width="0.35"/>`;});});
  const tag=(z,label,right=false)=>{const x0=right?v.x(b.y2+300):v.x(b.y1-2500),x1=right?v.x(b.y2+2500):v.x(b.y1-300);
    return `<line x1="${x0}" y1="${v.y(z)}" x2="${x1}" y2="${v.y(z)}" stroke="#111" stroke-width="0.15"/>`+text(x0,v.y(z)-0.6,label,1.6);};
  s+=tag(0,'±0\'-0" PLINTH LVL');
  tops.forEach((t,i)=>{if(i)s+=tag(t.z0,`+${ftin(t.z0)} ${t.id.toUpperCase()} FLR`);
    s+=tag(t.z0+SILL_MM,`+${ftin(t.z0+SILL_MM)} SILL`,true)+tag(t.z0+WINDOW_HEAD_MM,`+${ftin(t.z0+WINDOW_HEAD_MM)} LINTEL`,true);});
  s+=tag(zTop,`+${ftin(zTop)} PARAPET`);
  return {svg:s,v};
}

// ---------- tables ----------
function table(x,y,cols,rows,{size=2.2,rowH=5,title=null}={}){
  let s='',yy=y;
  if(title){s+=text(x,yy,title,3,'font-weight="700"');yy+=3;}
  const widths=cols.map(c=>c[1]),W=widths.reduce((a,b)=>a+b,0);
  const all=[cols.map(c=>c[0]),...rows];
  all.forEach((row,ri)=>{let xx=x;
    s+=`<rect x="${x}" y="${yy}" width="${W}" height="${rowH}" fill="${ri?'#fff':'#eee'}" stroke="#111" stroke-width="0.2"/>`;
    row.forEach((cell,ci)=>{s+=text(xx+1.2,yy+rowH-1.6,cell,size,ri?'':'font-weight="700"');xx+=widths[ci];
      if(ci<row.length-1)s+=`<line x1="${xx}" y1="${yy}" x2="${xx}" y2="${yy+rowH}" stroke="#111" stroke-width="0.2"/>`;});
    yy+=rowH;});
  return {svg:s,bottom:yy};
}
function notes(x,y,title,lines,{size=2.1,width=95}={}){
  let s=text(x,y,title,2.8,'font-weight="700"'),yy=y+4.5;
  const per=Math.floor(width/(size*0.5));
  lines.forEach((l,i)=>{const words=`${i+1}. ${l}`.split(' ');let line='';
    for(const w of words){if((line+' '+w).length>per){s+=text(x,yy,line,size);yy+=size*1.35;line='   '+w;}else line=line?line+' '+w:w;}
    s+=text(x,yy,line,size);yy+=size*1.6;});
  return {svg:s,bottom:yy};
}

// ---------- the set ----------
function renderDrawingSet(candidate,brief,{option='Option 1',date=new Date().toISOString().slice(0,10)}={}){
  const geometry=exportCandidateGeometry(candidate,brief);
  const schedule=buildOpeningSchedule(candidate),structure=structuralLayout(candidate);
  const j=brief.jurisdiction||{},siteArea=candidate.ledger.siteAreaSqM;
  const project={title:'PROPOSED RESIDENTIAL BUILDING',location:`${j.municipality||'Municipality ?'}, Ward ${j.ward||'?'}`,
    plot:`${r1(siteArea)} m² (${rapd(siteArea)} R-A-P-D)`,option:`${option} · ${candidate.id}`,
    kind:no=>no.startsWith('ST')?'STRUCTURAL LAYOUT (PRELIMINARY)':'ARCHITECTURAL DRAWING'};
  const bearing=geometry.northBearingDegrees??0,sheets=[];
  const add=(no,title,scale,inner)=>sheets.push({no,title,html:frame({no,title,scale,project,date,inner:DEFS+inner})});

  // AR-00 site plan, area statement and drawing list
  {const site=candidate.envelope.site,area={x1:DRAW.x1,y1:DRAW.y1+6,x2:230,y2:DRAW.y2};
    const bounds={x1:site.x1-3500,y1:site.y1-6000,x2:site.x2+3500,y2:site.y2+3500};
    const scale=fitScale(bounds,area),v=viewport(bounds,area,scale);
    let s=rectSvg(v,site,'fill="none" stroke="#111" stroke-width="0.45" stroke-dasharray="4 1"');
    s+=rectSvg(v,candidate.envelope.buildable,'fill="none" stroke="#888" stroke-width="0.2" stroke-dasharray="1 1"');
    for(const sl of candidate.levels[0].footprint.slabs)s+=rectSvg(v,sl,'fill="url(#hatch)" stroke="#111" stroke-width="0.35"');
    s+=text(v.x((site.x1+site.x2)/2),v.y((site.y1+site.y2)/2),'PROPOSED BUILDING',3,'text-anchor="middle" font-weight="700"');
    const fr=brief.site?.frontageEdges?.[0];
    if(fr&&fr.edgeIndex===0){s+=`<rect x="${v.x(site.x1-3000)}" y="${v.y(site.y1)}" width="${(site.x2-site.x1+6000)*v.k}" height="${(fr.roadWidth?.value||4)*1000*v.k}" fill="#e6e6e6"/>`;
      s+=text(v.x((site.x1+site.x2)/2),v.y(site.y1)+(fr.roadWidth?.value||4)*1000*v.k/2+1,`${fr.roadWidth?.value||'?'} ${fr.roadWidth?.unit||'m'} WIDE ROAD`,2.8,'text-anchor="middle"');}
    s+=chain(v,'x',[site.x1,site.x2],v.y(site.y2)-4,'top')+chain(v,'y',[site.y1,site.y2],v.x(site.x1)-4,'left');
    const sb=candidate.envelope.setbacksMm||[];
    s+=text(area.x1,area.y2-2,`Working setbacks ${sb.map(m=>ftin(m)).join(' / ')} — provisional; adopted municipal setbacks to be applied.`,2);
    s+=text(v.x(site.x1),v.y(site.y1)+(fr?.roadWidth?.value||4)*1000*v.k+6,`SITE PLAN  (scale 1:${scale})`,3.2,'font-weight="700" text-decoration="underline"');
    s+=northArrow(area.x2-10,area.y1+12,bearing);
    const l=candidate.ledger,rowsA=[['1','Plot area (measured)',`${r1(siteArea)} m²`,`${Math.round(sqft(siteArea))} sq ft`,rapd(siteArea)],
      ...l.floors.map((f,i)=>[String(i+2),`${f.id} floor area`,`${r1(f.grossSqM)} m²`,`${Math.round(sqft(f.grossSqM))} sq ft`,'']),
      [String(l.floors.length+2),'Total built (sum of floors)',`${r1(l.grossBuiltSqM)} m²`,`${Math.round(sqft(l.grossBuiltSqM))} sq ft`,''],
      [String(l.floors.length+3),'Ground coverage',`${r1(l.groundCoverageRatio*100)} %`,'',''],
      [String(l.floors.length+4),'FAR (built / plot)',String(Math.round(l.grossBuiltSqM/siteArea*100)/100),'','']];
    const t1=table(240,DRAW.y1+6,[['SN',9],['DESCRIPTION',52],['M²',26],['SQ FT',24],['R-A-P-D',24]],rowsA,{title:'AREA STATEMENT'});
    s+=t1.svg;
    const list=[['AR-00','Site plan, area statement, drawing list'],...candidate.levels.map((lv,i)=>[`AR-0${i+1}`,`${lv.id} floor plan`]),
      [`AR-0${candidate.levels.length+1}`,'Elevations'],[`AR-0${candidate.levels.length+2}`,'Section X-X and opening schedule'],
      ['ST-01','Column and beam layout, preliminary sizes, notes']];
    const t2=table(240,t1.bottom+8,[['SHEET',18],['DRAWING',117]],list,{title:'DRAWING LIST'});s+=t2.svg;
    s+=text(240,t2.bottom+7,'LOCATION PLAN (NOT TO SCALE): to be added from the survey / ward map.',2.2);
    s+=notes(240,t2.bottom+14,'PROFESSIONAL REVIEW REQUIRED',PROFESSIONAL,{width:130}).svg;
    add('AR-00','SITE PLAN',scale,s);}

  // floor plans
  candidate.levels.forEach((level,i)=>{
    const area={x1:DRAW.x1,y1:DRAW.y1+4,x2:DRAW.x2-10,y2:DRAW.y2-8};
    const scale=fitScale({x1:0,y1:0,x2:outerBounds(level.footprint.slabs).x2-outerBounds(level.footprint.slabs).x1+5200,
      y2:outerBounds(level.footprint.slabs).y2-outerBounds(level.footprint.slabs).y1+5200},area);
    const d=planDrawing(candidate,level,schedule,area,scale,{showSection:i===0});
    const gross=level.footprint.slabs.reduce((n,b)=>n+boxArea(b),0);
    let s=d.svg+text((DRAW.x1+DRAW.x2)/2,DRAW.y2-1,`${level.id.toUpperCase()} FLOOR PLAN — FLOOR AREA ${Math.round(sqft(gross))} SQ.FT (${r1(gross)} m²) — SCALE 1:${scale}`,3,'text-anchor="middle" font-weight="700"');
    s+=northArrow(DRAW.x2-12,DRAW.y1+12,bearing);
    s+=text(DRAW.x1,DRAW.y1,'Dimensions in feet-inches. Door swings and hinge sides are indicative and unverified.',2);
    add(`AR-0${i+1}`,`${level.id.toUpperCase()} FLOOR PLAN`,scale,s);
  });

  // elevations: four on one sheet
  {const cells=[{x1:DRAW.x1,y1:DRAW.y1+4,x2:(DRAW.x1+DRAW.x2)/2-4,y2:(DRAW.y1+DRAW.y2)/2-4},
      {x1:(DRAW.x1+DRAW.x2)/2+4,y1:DRAW.y1+4,x2:DRAW.x2,y2:(DRAW.y1+DRAW.y2)/2-4},
      {x1:DRAW.x1,y1:(DRAW.y1+DRAW.y2)/2+6,x2:(DRAW.x1+DRAW.x2)/2-4,y2:DRAW.y2-4},
      {x1:(DRAW.x1+DRAW.x2)/2+4,y1:(DRAW.y1+DRAW.y2)/2+6,x2:DRAW.x2,y2:DRAW.y2-4}];
    const faces=['south','east','north','west'];
    const all=candidate.levels.flatMap(l=>l.footprint.slabs),b=outerBounds(all),zTop=Math.max(...levelTops(geometry).map(t=>t.z1))+PARAPET_MM;
    const span=Math.max(b.x2-b.x1,b.y2-b.y1)+2400;
    const scale=fitScale({x1:0,y1:0,x2:span,y2:zTop+1100},{...cells[0],y2:cells[0].y2-6});
    let s='';faces.forEach((f,i)=>{const e=elevationDrawing(candidate,geometry,f,{...cells[i],y2:cells[i].y2-6},scale);
      s+=e.svg+text((cells[i].x1+cells[i].x2)/2,cells[i].y2,`${e.title} (plan ${f} face) — 1:${scale}`,2.8,'text-anchor="middle" font-weight="700" text-decoration="underline"');});
    add(`AR-0${candidate.levels.length+1}`,'ELEVATIONS',scale,s);}

  // section X-X and opening schedule
  {const area={x1:DRAW.x1,y1:DRAW.y1+4,x2:215,y2:DRAW.y2-8};
    const all=candidate.levels.flatMap(l=>l.footprint.slabs),b=outerBounds(all),zTop=Math.max(...levelTops(geometry).map(t=>t.z1))+PARAPET_MM;
    const scale=fitScale({x1:0,y1:0,x2:b.y2-b.y1+5200,y2:zTop+1400},area);
    const sec=sectionDrawing(candidate,geometry,area,scale);
    let s=sec.svg+text((area.x1+area.x2)/2,DRAW.y2-1,`SECTION AT X-X — 1:${scale}`,3,'text-anchor="middle" font-weight="700" text-decoration="underline"');
    const rows=schedule.rows.map((r,i)=>[String(i+1),r.tag,r.kind==='main'?'Main entrance door':r.kind==='door'?'Door':'Window',
      `${ftin(r.widthMm)} X ${ftin(r.heightMm)}`,String(r.count),r.kind==='window'?ftin(r.sillMm):'-']);
    const t=table(225,DRAW.y1+6,[['S.N',10],['TAG',14],['DESCRIPTION',40],['SIZE (W X H)',38],['NOS.',12],['SILL',16]],rows,{title:'OPENING SCHEDULE'});
    s+=t.svg+notes(225,t.bottom+7,'SCHEDULE NOTES',[
      'Sizes are clear openings reserved by the planner; frame and finish allowances to be added by the architect.',
      'Window head at 7\'-0" (2100 mm) and sill at 2\'-11" (900 mm) above floor unless noted.',
      `Open portals without a door leaf (${schedule.portals}) are not scheduled.`,
      'Door swings, hinge sides, glazing type and egress widths are unverified.',
      'Living-room balcony connection: closable glazing (owner decision 2026-09-30).'],{width:130}).svg;
    add(`AR-0${candidate.levels.length+2}`,'SECTION X-X & OPENING SCHEDULE',scale,s);}

  // ST-01 structural layout
  {const ground=candidate.levels[0],area={x1:DRAW.x1,y1:DRAW.y1+4,x2:230,y2:DRAW.y2-8};
    const fb=outerBounds(ground.footprint.slabs);
    const scale=fitScale({x1:0,y1:0,x2:fb.x2-fb.x1+5200,y2:fb.y2-fb.y1+5200},area);
    const d=planDrawing(candidate,ground,schedule,area,scale,{structural:true});
    let s=d.svg+text((area.x1+area.x2)/2,DRAW.y2-1,`COLUMN & BEAM LAYOUT (TYPICAL FLOOR) — 1:${scale} — DIMENSIONS IN MM`,3,'text-anchor="middle" font-weight="700" text-decoration="underline"');
    const t1=table(240,DRAW.y1+6,[['TYPE',14],['SIZE (MM)',26],['FLOORS',30],['REINFORCEMENT',60]],
      [['C1','350 X 350','all',`by structural design`],
        ...structure.beamTypes.map(bt=>[bt.id,`${bt.widthMm} X ${bt.depthMm}`,`max span ${bt.maxSpanMm}`,'by structural design'])],{title:'COLUMN & BEAM SCHEDULE (PRELIMINARY)'});
    const t2=table(240,t1.bottom+5,[['ITEM',40],['PRELIMINARY',50],['STATUS',40]],
      [['Slab',`${structure.slabThicknessMm} mm two-way`,'by structural design'],
        ['Footings','F-types by analysis','after soil test'],['Plinth/tie beams','on all grid lines','by structural design']],{title:'SLAB & FOUNDATION'});
    s+=t1.svg+t2.svg;
    const n=notes(240,t2.bottom+7,'STRUCTURE NOTES (TO BE CONFIRMED BY THE STRUCTURAL ENGINEER)',[
      'Do not scale from the drawings; follow written dimensions.','Read with the architectural drawings.',
      'All dimensions in mm unless noted.','Concrete M20 minimum (M25 for columns where specified) to IS 456:2000.',
      'Reinforcement TMT Fe 500.','Clear cover: slab 15, beam 25, column 40, foundation 50-75 mm.',
      'Column bars spliced only at mid-height; beam splices away from connecting spans.',
      'Seismic design to NBC 105:2025; ductile detailing to IS 13920.',
      ...structure.basis,'This sheet is a preliminary layout, not a structural design.'],{width:135,size:1.9});
    s+=n.svg;
    add('ST-01','COLUMN & BEAM LAYOUT',scale,s);}

  const html=`<!doctype html><html><head><meta charset="utf-8"><title>Keystone Nepal review drawing set — ${esc(candidate.id)}</title>`+
    `<style>@page{size:420mm 297mm;margin:0}body{margin:0;background:#888}.sheet{width:420mm;height:297mm;background:#fff;margin:0 auto 8mm;page-break-after:always;break-after:page}`+
    `@media print{body{background:#fff}.sheet{margin:0}}svg{display:block}</style></head><body>${sheets.map(s=>s.html).join('')}</body></html>`;
  return {html,sheets:sheets.map(({no,title})=>({no,title})),openingSchedule:schedule.rows,structure};
}
module.exports={renderDrawingSet,buildOpeningSchedule,structuralLayout,ftin,rapd};
