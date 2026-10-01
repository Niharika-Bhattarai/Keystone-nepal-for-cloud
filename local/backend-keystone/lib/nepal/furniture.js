'use strict';
// Furniture and sanitary-fixture placement inside each room's clear box.
// Every item backs onto a solid wall, never crosses a door/portal opening or a
// door-swing zone, and tall items never stand in front of a window. Where the
// selected Vaastu profile has a rule, it decides the wall (catalog IDs cited);
// otherwise the longest free wall wins. Items that cannot fit are reported as
// misfits, never silently dropped. Sizes are typical Nepali residential sizes
// and remain design intent until the architect confirms them.

const SWING_EXTRA_MM=50;
// [type, width along the wall, depth from the wall, tall, clearance in front]
const ITEMS={
  // Beds need a solid headboard wall (V27), so a window blocks them like a tall item.
  doubleBed:{label:'DOUBLE BED',w:1500,d:1950,front:500,tall:true},
  singleBed:{label:'BED',w:1200,d:1950,front:500,tall:true},
  sideTable:{label:'',w:450,d:400,front:0,tall:false},
  wardrobe:{label:'WARDROBE',w:1200,d:600,front:700,tall:true},
  sofaLong:{label:'SOFA',w:2400,d:850,front:450,tall:false},
  sofa3:{label:'SOFA',w:1800,d:850,front:450,tall:false},
  sofaReturn:{label:'',w:850,d:1600,front:0,tall:false},
  coffeeTable:{label:'',w:1100,d:550,front:0,tall:false},
  tvUnit:{label:'TV',w:1500,d:400,front:1200,tall:false},
  counter:{label:'COUNTER',w:0,d:600,front:900,tall:false},
  stove:{label:'STOVE',w:600,d:600,front:0,tall:false},
  sink:{label:'SINK',w:600,d:600,front:0,tall:false},
  fridge:{label:'FRIDGE',w:700,d:700,front:800,tall:true},
  diningTable:{label:'DINING',w:1200,d:800,front:0,tall:false},
  wc:{label:'WC',w:450,d:700,front:600,tall:false},
  basin:{label:'BASIN',w:500,d:420,front:600,tall:false},
  shower:{label:'SHOWER',w:900,d:900,front:0,tall:false},
  altar:{label:'ALTAR',w:900,d:450,front:900,tall:false},
  desk:{label:'DESK',w:1200,d:600,front:750,tall:false},
  washer:{label:'WASHER',w:600,d:600,front:600,tall:false},
};
const overlap=(a,b)=>Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1)>1&&Math.min(a.y2,b.y2)-Math.max(a.y1,b.y1)>1;
const inside=(a,c)=>a.x1>=c.x1-0.5&&a.y1>=c.y1-0.5&&a.x2<=c.x2+0.5&&a.y2<=c.y2+0.5;
function compass(normal,bearingDegrees){
  const a=bearingDegrees*Math.PI/180,north={x:Math.cos(a),y:Math.sin(a)},east={x:Math.sin(a),y:-Math.cos(a)};
  const n=normal.x*north.x+normal.y*north.y,e=normal.x*east.x+normal.y*east.y;
  return Math.abs(n)>=Math.abs(e)?(n>0?'N':'S'):(e>0?'E':'W');
}
const EDGE_NORMAL={south:{x:0,y:-1},north:{x:0,y:1},west:{x:-1,y:0},east:{x:1,y:0}};

// Openings on each clear-box edge, and door-swing keep-out squares inside the room.
function roomOpenings(room,level){
  const c=room.clearBox||room.box,out=[];
  for(const wall of level.walls?.walls||[])for(const o of wall.openingBoxes){
    const b=o.box,kind=o.opening?.leafCount?'door':/exposure|window/.test(o.opening?.status||'')?'window':'portal';
    const near=(p,q)=>Math.abs(p-q)<=260;// opening box face is within one wall thickness of the clear edge
    let edge=null;
    if(wall.axis==='vertical'&&Math.min(b.y2,c.y2)-Math.max(b.y1,c.y1)>1){
      if(near(b.x2,c.x1)||near(b.x1,c.x1))edge='west';else if(near(b.x1,c.x2)||near(b.x2,c.x2))edge='east';}
    if(wall.axis==='horizontal'&&Math.min(b.x2,c.x2)-Math.max(b.x1,c.x1)>1){
      if(near(b.y2,c.y1)||near(b.y1,c.y1))edge='south';else if(near(b.y1,c.y2)||near(b.y2,c.y2))edge='north';}
    if(!edge)continue;
    const along=wall.axis==='vertical'?[Math.max(b.y1,c.y1),Math.min(b.y2,c.y2)]:[Math.max(b.x1,c.x1),Math.min(b.x2,c.x2)];
    const w=along[1]-along[0]+SWING_EXTRA_MM;
    const zone=edge==='west'?{x1:c.x1,y1:along[0],x2:c.x1+w,y2:along[1]}:edge==='east'?{x1:c.x2-w,y1:along[0],x2:c.x2,y2:along[1]}:
      edge==='south'?{x1:along[0],y1:c.y1,x2:along[1],y2:c.y1+w}:{x1:along[0],y1:c.y2-w,x2:along[1],y2:c.y2};
    // Doors and portals keep a clear zone at least their own width deep; windows only mark the wall.
    out.push({edge,kind,from:along[0],to:along[1],keepOut:kind==='window'?null:zone});
  }
  return out;
}
// Box for an item of width w (along the wall) and depth d, backed onto `edge` at position t.
function boxOn(c,edge,t,w,d){
  if(edge==='south')return {x1:t,y1:c.y1,x2:t+w,y2:c.y1+d};
  if(edge==='north')return {x1:t,y1:c.y2-d,x2:t+w,y2:c.y2};
  if(edge==='west')return {x1:c.x1,y1:t,x2:c.x1+d,y2:t+w};
  return {x1:c.x2-d,y1:t,x2:c.x2,y2:t+w};
}
function frontZone(box,edge,depth){
  if(!depth)return null;
  if(edge==='south')return {x1:box.x1,y1:box.y2,x2:box.x2,y2:box.y2+depth};
  if(edge==='north')return {x1:box.x1,y1:box.y1-depth,x2:box.x2,y2:box.y1};
  if(edge==='west')return {x1:box.x2,y1:box.y1,x2:box.x2+depth,y2:box.y2};
  return {x1:box.x1-depth,y1:box.y1,x2:box.x1,y2:box.y2};
}
const edgeRange=(c,edge)=>edge==='south'||edge==='north'?[c.x1,c.x2]:[c.y1,c.y2];

function placer(room,level,bearing,obstacles=[]){
  const c=room.clearBox||room.box,openings=roomOpenings(room,level),placed=[],
    keep=[...openings.filter(o=>o.keepOut).map(o=>o.keepOut),...obstacles.filter(o=>overlap(o,c))];
  const edgeCompass=Object.fromEntries(Object.entries(EDGE_NORMAL).map(([e,n])=>[e,compass(n,bearing)]));
  const blockedOn=(edge,a,b,tall)=>openings.some(o=>o.edge===edge&&(o.kind!=='window'||tall)&&Math.min(b,o.to)-Math.max(a,o.from)>1);
  function fits(box,edge,spec,{from,to}){
    if(!inside(box,c))return false;
    if(blockedOn(edge,from,to,spec.tall))return false;
    if(keep.some(k=>overlap(box,k)))return false;
    if(placed.some(p=>overlap(box,p.box)||(p.front&&overlap(box,p.front))))return false;
    const f=frontZone(box,edge,spec.front);
    if(f&&placed.some(p=>overlap(f,p.box)))return false;
    return true;
  }
  // options: preferred wall compass letters, preferred corner ('start'|'end'), width override
  function place(kind,{walls=null,width=null,depth=null,label=null,corner=null,rule=null,avoidEdges=[],at=null,allowWindow=false}={}){
    const spec={...ITEMS[kind]};if(width)spec.w=width;if(depth)spec.d=depth;if(allowWindow)spec.tall=false;
    const candidates=[];
    for(const edge of Object.keys(EDGE_NORMAL)){
      if(avoidEdges.includes(edge))continue;
      const [lo,hi]=edgeRange(c,edge);
      for(let t=lo;t+spec.w<=hi+0.5;t+=50){
        const box=boxOn(c,edge,t,spec.w,spec.d);
        if(at&&!at(box,edge))continue;
        if(!fits(box,edge,spec,{from:t,to:t+spec.w}))continue;
        const pref=walls?walls.indexOf(edgeCompass[edge]):0;
        const cornerDist=corner==='start'?t-lo:corner==='end'?hi-(t+spec.w):Math.abs((t+spec.w/2)-(lo+hi)/2);
        candidates.push({box,edge,score:[pref<0?99:pref,cornerDist]});
      }
      // last candidate flush with the far corner
      const t=hi-spec.w;if(t>=lo){const box=boxOn(c,edge,t,spec.w,spec.d);
        if((!at||at(box,edge))&&fits(box,edge,spec,{from:t,to:hi})){const pref=walls?walls.indexOf(edgeCompass[edge]):0;
          candidates.push({box,edge,score:[pref<0?99:pref,corner==='end'?0:corner==='start'?t-lo:Math.abs((t+spec.w/2)-(lo+hi)/2)]});}}
    }
    candidates.sort((a,b)=>a.score[0]-b.score[0]||a.score[1]-b.score[1]);
    const best=candidates[0];
    if(!best)return null;
    const item={roomId:room.id,kind,label:label??spec.label,box:best.box,wall:best.edge,wallCompass:edgeCompass[best.edge],
      tall:spec.tall,front:frontZone(best.box,best.edge,spec.front)};
    if(rule)item.vastu={ruleId:rule.id,preferred:rule.walls,met:rule.walls.includes(edgeCompass[best.edge])};
    placed.push(item);return item;
  }
  // Free-standing items (tables) may sit anywhere clear of walls' keep-outs and other items.
  const freeAt=box=>inside(box,c)&&!keep.some(k=>overlap(box,k))&&!placed.some(p=>overlap(box,p.box)||(p.front&&overlap(box,p.front)));
  function placeFree(kind,boxes,extra={}){
    for(const box of boxes)if(freeAt(extra.zone?.(box)||box)){const item={roomId:room.id,kind,label:extra.label??'',box,wall:null,...(extra.zone?{chairsZone:extra.zone(box)}:{})};placed.push(item);return item;}
    return null;
  }
  return {place,placeFree,placed,c,openings,edgeCompass};
}

// Candidate positions for a free-standing w x d item, centre first, then on a 100 mm grid.
function gridBoxes(c,w,d){
  const cx=(c.x1+c.x2)/2,cy=(c.y1+c.y2)/2,out=[];
  for(let x=c.x1;x+w<=c.x2;x+=100)for(let y=c.y1;y+d<=c.y2;y+=100)out.push({x1:x,y1:y,x2:x+w,y2:y+d});
  return [{x1:cx-w/2,y1:cy-d/2,x2:cx+w/2,y2:cy+d/2},...out.sort((a,b)=>
    Math.hypot((a.x1+a.x2)/2-cx,(a.y1+a.y2)/2-cy)-Math.hypot((b.x1+b.x2)/2-cx,(b.y1+b.y2)/2-cy))];
}
function furnishRoom(room,level,{bearingDegrees=0,beams=[],columns=[],wardrobes='primary'}={}){
  // Frame columns that project into the room are obstacles like door-swing zones.
  const P=placer(room,level,bearingDegrees,columns.map(cl=>({x1:cl.xMm-cl.widthMm/2,y1:cl.yMm-cl.widthMm/2,
    x2:cl.xMm+cl.widthMm/2,y2:cl.yMm+cl.widthMm/2}))),misfit=[],need=(item,kind)=>{if(!item)misfit.push({roomId:room.id,kind});return item;};
  const c=P.c,w=c.x2-c.x1,d=c.y2-c.y1;
  const bathEdges=[];// walls shared with a bathroom are not headboard walls (V27)
  for(const other of level.rooms?.rooms||[])if(other.type==='bathroom'&&other.id!==room.id){
    const b=other.box;if(Math.abs(b.x2-room.box.x1)<2)bathEdges.push('west');if(Math.abs(b.x1-room.box.x2)<2)bathEdges.push('east');
    if(Math.abs(b.y2-room.box.y1)<2)bathEdges.push('south');if(Math.abs(b.y1-room.box.y2)<2)bathEdges.push('north');}
  switch(room.type){
    case 'primaryBedroom':case 'bedroom':case 'guestBedroom':{
      const kind=room.type==='primaryBedroom'||Math.min(w,d)>=3000?'doubleBed':'singleBed';
      // Head toward S or E (V25) means the headboard is on the S or E wall.
      let bed=P.place(kind,{walls:['S','E','W','N'],avoidEdges:bathEdges,rule:{id:'V25',walls:['S','E']}});
      // A 4'-6" (1350 mm) double bed is a common smaller size before giving up the solid headboard.
      if(!bed&&kind==='doubleBed')bed=P.place(kind,{walls:['S','E','W','N'],avoidEdges:bathEdges,width:1350,
        label:'DOUBLE BED 4\'6"',rule:{id:'V25',walls:['S','E']}});
      // No solid headboard wall long enough: headboard under a window, reported as a V27 departure.
      if(!bed){bed=P.place(kind,{walls:['S','E','W','N'],avoidEdges:bathEdges,rule:{id:'V25',walls:['S','E']},allowWindow:true});
        if(bed)bed.headboard={ruleId:'V27',solidWall:false,note:'headboard under a window; no solid wall long enough'};}
      need(bed,kind);
      if(bed){
        const along=bed.wall==='south'||bed.wall==='north';
        for(const side of [-1,1]){const t=along?(side<0?bed.box.x1-460:bed.box.x2+10):(side<0?bed.box.y1-460:bed.box.y2+10);
          P.place('sideTable',{at:(b,e)=>e===bed.wall&&(along?Math.abs(b.x1-t)<60:Math.abs(b.y1-t)<60)});}
        const crossed=beams.filter(bm=>bm.axis==='x'?bm.line>bed.box.y1&&bm.line<bed.box.y2&&bm.from<bed.box.x2&&bm.to>bed.box.x1:
          bm.line>bed.box.x1&&bm.line<bed.box.x2&&bm.from<bed.box.y2&&bm.to>bed.box.y1);
        if(crossed.length)bed.beamOverhead={ruleId:'V26',beams:crossed.length};
      }
      if(room.type==='primaryBedroom'||wardrobes==='all')need(P.place('wardrobe',{walls:['S','W','E','N'],rule:{id:'V36',walls:['S','W']}}),'wardrobe');
      break;}
    case 'livingRoom':{
      // Owner convention: seven-seat corner sofa; a 3-seat sofa where the room is too small.
      const sofa=P.place('sofaLong',{walls:['S','W','E','N'],corner:'start',label:'CORNER SOFA'})||
        need(P.place('sofa3',{walls:['S','W','E','N'],corner:'start',label:'SOFA (3)'}),'sofa');
      if(sofa?.kind==='sofa3')sofa.note='corner sofa does not fit';
      if(sofa?.kind==='sofaLong'){P.place('sofaReturn',{at:(b,e)=>e!==sofa.wall&&overlap({x1:b.x1-5,y1:b.y1-5,x2:b.x2+5,y2:b.y2+5},sofa.box)});
      }
      if(sofa){const opp={south:'north',north:'south',east:'west',west:'east'}[sofa.wall];
        P.place('tvUnit',{at:(b,e)=>e===opp});
        P.placeFree('coffeeTable',gridBoxes(c,1100,550));}
      break;}
    case 'kitchen':{
      // Stove so the cook faces east (V22): stove backs onto the W wall... a cook facing
      // east stands west of the stove, i.e. the stove is on the EAST wall.
      const stove=need(P.place('stove',{walls:['E','S','N','W'],corner:'start',rule:{id:'V22',walls:['E']}}),'stove');
      const sink=need(P.place('sink',{walls:['N','E','W','S'],corner:'end',rule:{id:'V24',walls:['N','E']},
        at:b=>!stove||Math.hypot((b.x1+b.x2)/2-(stove.box.x1+stove.box.x2)/2,(b.y1+b.y2)/2-(stove.box.y1+stove.box.y2)/2)>=900}),'sink');
      // Continuous counter along the stove wall (owner: 1000 mm high concrete slab).
      if(stove){const [lo,hi]=edgeRange(c,stove.wall);const len=Math.min(hi-lo,3000);
        const counter=P.place('counter',{width:Math.max(600,len-1200),at:(b,e)=>e===stove.wall,label:'COUNTER (1000 H)'});
        if(!counter)misfit.push({roomId:room.id,kind:'counter'});}
      P.place('fridge',{walls:['W','S','N','E']});
      if(room.diningWithinKitchen!==false&&w>=2400&&d>=2400){
        const zone=t=>({x1:t.x1-450,y1:t.y1-450,x2:t.x2+450,y2:t.y2+450});
        P.placeFree('diningTable',gridBoxes(c,1200,800),{label:'DINING (4-6)',zone})||
          P.placeFree('diningTable',gridBoxes(c,900,900),{label:'DINING (4)',zone});
      }
      break;}
    case 'bathroom':{
      // WC user faces N or S (V35): the WC backs onto the N or S wall.
      need(P.place('wc',{walls:['S','N','W','E'],corner:'end',rule:{id:'V35',walls:['S','N']}}),'wc');
      need(P.place('basin',{walls:['E','N','W','S'],corner:'start'}),'basin');
      if(w>=1300&&d>=1700)P.place('shower',{walls:['W','S','N','E'],corner:'end',depth:Math.min(900,Math.min(w,d)-400)});
      break;}
    case 'puja':{
      // Worshipper faces east, idol faces west (V34): the altar is on the east wall.
      need(P.place('altar',{walls:['E','N','W','S'],rule:{id:'V34',walls:['E']}}),'altar');break;}
    case 'study':need(P.place('desk',{walls:['E','N','W','S']}),'desk');break;
    case 'laundry':case 'utilityFlex':P.place('washer',{walls:['W','N','S','E']});break;
    default:break;
  }
  return {items:P.placed.map(({front,...i})=>i),misfits:misfit};
}

function furnishLevel(level,options={}){
  const items=[],misfits=[];
  for(const room of level.rooms?.rooms||[]){const r=furnishRoom(room,level,options);items.push(...r.items);misfits.push(...r.misfits);}
  return {levelId:level.id,items,misfits};
}
module.exports={furnishLevel,furnishRoom,ITEMS,roomOpenings};
