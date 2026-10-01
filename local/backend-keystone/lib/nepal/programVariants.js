'use strict';
// Owner-approved program variants (owner instruction 2026-10-01). A variant
// changes the household's floor program, so it is returned beside the original
// candidates with an explicit change record; it never replaces the brief silently.

// "Reduce one room from the ground level and add it on the floor above" so the
// requested bikes fit at the front of a rental ground floor.
function parkingProgramVariant(brief){
  const program=brief.buildingProgram,levels=program.levels,ground=levels[0];
  if(!(program.parking?.bikes>0)||ground?.occupancy!=='rental'||ground.bedrooms!==2)return null;
  // Prefer the partial top floor (the owner's terrace floor), else the highest owner floor.
  const owner=[...levels].reverse().filter(l=>l.occupancy==='owner');
  const target=owner.find(l=>l.kind==='partial'&&!l.livingRooms&&!l.kitchens)||owner[0];
  if(!target)return null;
  const variant=structuredClone(brief),vp=variant.buildingProgram;
  const vGround=vp.levels[0],vTarget=vp.levels.find(l=>l.id===target.id);
  vGround.bedrooms=1;
  vTarget.bedrooms+=1;
  // The moved room is an extra family bedroom, not a second primary bedroom.
  vTarget.secondaryBedroomsOnly=true;
  vp.ownerProgram={...vp.ownerProgram,bedrooms:(vp.ownerProgram?.bedrooms||0)+1};
  return {brief:variant,change:{reason:'requested_ground_parking_does_not_fit_with_two_ground_bedrooms',
    ownerInstruction:'2026-10-01: reduce one ground room and add it above, or remove the family balcony',
    moved:{roomType:'bedroom',fromLevelId:ground.id,fromOccupancy:'rental',toLevelId:target.id,
      toOccupancy:target.occupancy},
    result:{groundRentalBedrooms:1,ownerBedrooms:vp.ownerProgram.bedrooms},
    status:'program_change_requires_household_confirmation'}};
}

// When no plan fits because a floor holds more rooms than its plate allows
// (typical on narrow plots), offer the same household program arranged
// differently: a bedroom or study moves from a floor that failed to another
// owner floor (up to two moves), and if that is not enough a floor is added
// (a partial top floor becomes full, or a floor is added on top). Rental floors
// never change. Every variant is labelled and needs household confirmation.
const ALLOWED_STOREYS=[1,2,2.5,3,3.5];
const load=l=>l.bedrooms+l.kitchens+l.livingRooms+(l.specialRooms||[]).filter(t=>t!=='guestBedroom').length*0.7+0.5*l.bathrooms;
function moveRoom(brief,fromId,toId,kind){
  const v=structuredClone(brief),L=v.buildingProgram.levels,from=L.find(l=>l.id===fromId),to=L.find(l=>l.id===toId);
  if(!from||!to||from===to||from.occupancy!=='owner'||to.occupancy!=='owner')return null;
  if(kind==='bedroom'){
    if(!(from.bedrooms-(from.attachedBathrooms||0)>0&&from.bedrooms>(from.kitchens||from.livingRooms?0:1)))return null;
    from.bedrooms--;to.bedrooms++;to.secondaryBedroomsOnly=true;
  }else if(['puja','study','store','laundry'].includes(kind)){
    if(!from.specialRooms?.includes(kind))return null;
    // puja only moves up (Vaastu prefers the highest owner floor)
    if(kind==='puja'&&L.indexOf(to)<L.indexOf(from))return null;
    from.specialRooms=from.specialRooms.filter(t=>t!==kind);to.specialRooms=[...(to.specialRooms||[]),kind];
  }else return null;
  const move={roomType:kind,fromLevelId:fromId,toLevelId:toId};
  if(kind==='bedroom'&&from.bathrooms-(from.attachedBathrooms||0)>(from.kitchens?1:0)&&from.bathrooms>1&&to.bathrooms===0){
    from.bathrooms--;to.bathrooms++;move.withBathroom=true;}
  // a floor that gains its first bedroom also needs a bathroom
  if(kind==='bedroom'&&to.bathrooms===0&&!to.kitchens&&!to.livingRooms&&from.bathrooms>1&&from.bathrooms-(from.attachedBathrooms||0)>0){
    from.bathrooms--;to.bathrooms++;move.withBathroom=true;}
  return {brief:v,move};
}
function addFloor(brief){
  const v=structuredClone(brief),p=v.buildingProgram,L=p.levels,top=L.at(-1);
  if(top.kind==='partial'&&top.occupancy==='owner'){top.kind='full';delete top.targetAreaSqM;p.storeys=Math.ceil(p.storeys);
    return {brief:v,move:{change:'partial_top_floor_made_full',levelId:top.id,storeys:p.storeys}};}
  const next=ALLOWED_STOREYS.find(n=>n>p.storeys&&n-p.storeys>=1)||(p.storeys===3?3.5:null);
  if(!next)return null;
  const rise=L.length>1?L.at(-1).elevationMm-L.at(-2).elevationMm:3000;
  const kind=next%1?'partial':'full';
  L.push({id:`added-level-${L.length+1}`,kind,elevationMm:top.elevationMm+rise,use:'added to fit the program',occupancy:'owner',
    bedrooms:0,bathrooms:0,kitchens:0,livingRooms:0,attachedBathrooms:0,specialRooms:[],separateDiningRoom:false,
    ...(kind==='partial'?{targetAreaSqM:Math.max(30,top.targetAreaSqM||40)}:{})});
  p.storeys=next;
  return {brief:v,move:{change:'floor_added',levelId:L.at(-1).id,storeys:next}};
}
// Balanced spread: no owner floor keeps more than `cap` main rooms (bedrooms,
// study and — where they are — living/kitchen); moves go to the emptiest floor
// and the puja goes to the highest owner floor. Tried before step-by-step moves.
function balanced(brief,cap){
  let b=structuredClone(brief);const moves=[];
  const mains=l=>l.bedrooms+l.kitchens+l.livingRooms+(l.specialRooms?.includes('study')?1:0);
  const owners=()=>b.buildingProgram.levels.filter(l=>l.occupancy==='owner');
  const top=owners().at(-1);
  for(const l of owners())if(l!==top&&l.specialRooms?.includes('puja')){const m=moveRoom(b,l.id,top.id,'puja');if(m){b=m.brief;moves.push(m.move);}}
  for(let guard=0;guard<8;guard++){
    // a partial top floor holds one main room; room left = cap minus rooms
    const capOf=l=>l.kind==='partial'?1:cap,over=l=>mains(l)-capOf(l);
    const L=owners(),from=[...L].sort((x,y)=>over(y)-over(x))[0],to=[...L].sort((x,y)=>over(x)-over(y))[0];
    if(over(from)<=0||over(to)>=0||from===to)break;
    const m=moveRoom(b,from.id,to.id,'bedroom')||moveRoom(b,from.id,to.id,'study');if(!m)break;
    b=m.brief;moves.push(m.move);
  }
  return moves.length?{brief:b,moves}:null;
}
function* redistributionVariants(brief,failingLevelIds=[],{maxDepth=2,narrow=false}={}){
  const label=moves=>moves.map(m=>m.change==='floor_added'?`floor added (${m.storeys} storeys)`:m.change==='partial_top_floor_made_full'?`top floor made full (${m.storeys} storeys)`:
    `${m.roomType}${m.withBathroom?' + bathroom':''} moved ${m.fromLevelId} → ${m.toLevelId}`).join('; ');
  const wrap=(b,moves)=>({brief:b,change:{reason:'rooms_do_not_fit_on_their_requested_floor',label:`Program variant: ${label(moves)}`,
    moved:moves[0],moves,status:'program_change_requires_household_confirmation'}});
  const key=b=>JSON.stringify(b.buildingProgram.levels.map(l=>[l.id,l.bedrooms,l.bathrooms,l.specialRooms]));
  const seen=new Set([key(brief)]);
  // one level of moves: from failing floors first, to the emptiest owner floor first
  const step=(b)=>{const L=b.buildingProgram.levels.filter(l=>l.occupancy==='owner');
    const ids=L.map(l=>l.id),src=[...failingLevelIds.filter(id=>ids.includes(id)),...ids.filter(id=>!failingLevelIds.includes(id))];
    const dst=[...L].sort((x,y)=>load(x)-load(y)).map(l=>l.id),out=[];
    for(const from of src)for(const kind of ['puja','bedroom','study','store','laundry'])for(const to of dst){
      const m=moveRoom(b,from,to,kind);if(!m)continue;const k=key(m.brief);if(seen.has(k))continue;seen.add(k);out.push(m);}
    return out;};
  const grownFirst=addFloor(brief);
  for(const cap of narrow?[3,2]:[3]){
    const bal=balanced(brief,cap);if(bal&&!seen.has(key(bal.brief))){seen.add(key(bal.brief));yield wrap(bal.brief,bal.moves);}
    if(grownFirst){const gb=balanced(grownFirst.brief,cap);
      if(gb&&!seen.has(key(gb.brief))){seen.add(key(gb.brief));yield wrap(gb.brief,[grownFirst.move,...gb.moves]);}}
  }
  let frontier=[{brief,moves:[]}];
  const grown=addFloor(brief);
  for(let d=0;d<maxDepth;d++){const next=[];
    for(const f of frontier)for(const m of step(f.brief)){const moves=[...f.moves,m.move];yield wrap(m.brief,moves);next.push({brief:m.brief,moves});}
    frontier=next;
    // after single moves, try adding a floor before deeper reshuffles
    if(d===0&&grown){seen.add(key(grown.brief));yield wrap(grown.brief,[grown.move]);
      let gf=[{brief:grown.brief,moves:[grown.move]}];
      for(let gd=0;gd<maxDepth;gd++){const gn=[];
        for(const f of gf)for(const m of step(f.brief)){const moves=[...f.moves,m.move];yield wrap(m.brief,moves);gn.push({brief:m.brief,moves});}
        gf=gn;}
    }
  }
}
module.exports={parkingProgramVariant,redistributionVariants,moveRoom,addFloor};
