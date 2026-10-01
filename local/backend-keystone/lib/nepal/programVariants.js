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
module.exports={parkingProgramVariant};
