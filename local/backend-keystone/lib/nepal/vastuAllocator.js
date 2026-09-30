'use strict';
const {zoneAreas}=require('./vastuDomains');
const FAVOR={kitchen:['SE','E'],puja:['NE','N','E'],primaryBedroom:['SW','S','W'],guestBedroom:['NW','N'],
  bathroom:['NW','W'],stair:['S','W','SW'],livingRoom:['N','E','NE'],undergroundReservoir:['NE']};
function vastuFindings(rooms,{bearingDegrees,domainBoxes,profile='Jain-led'}={}) {
  if(profile!=='Jain-led')throw new Error('Unreviewed Vaastu profile');
  return rooms.map(room=>{
    const zones=zoneAreas([room.box],bearingDegrees,domainBoxes);
    const total=Object.values(zones).reduce((a,b)=>a+b,0);
    const preferred=FAVOR[room.type]||[];
    const preferredShare=total?preferred.reduce((s,k)=>s+zones[k],0)/total:0;
    return {roomId:room.id,type:room.type,preferredZones:preferred,zoneAreasSqM:zones,
      preferredShare,domain:'floor-footprint',profile,
      status:preferred.length?'preference_measured_consultant_review_required':'no_directional_rule'};
  });
}
module.exports={vastuFindings};
