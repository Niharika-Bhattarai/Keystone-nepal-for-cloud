'use strict';

// Owner-supplied Nepal residential conventions. These are design intent, not
// measured construction quantities or evidence that furniture/balconies fit.
const KITCHEN_BALCONY_DEPTH_MM=[914,1219]; // 3–4 ft, rounded to integer mm
// Owner decision 2026-09-30: the living-room balcony connection is closable glazing
// (e.g. sliding glazed doors), not a permanently open opening.
const LIVING_BALCONY_CONNECTION='closable_glazing_owner_confirmed_2026_09_30';

function attachResidentialDetails(candidate,brief){
  const requestedBalconies=new Set(brief.buildingProgram.balconies||[]);
  const uppermost=candidate.levels.at(-1)?.id||null;
  for(const level of candidate.levels){
    level.residentialDetails={
      requestedBalcony:requestedBalconies.has(level.id),
      balconyStatus:requestedBalconies.has(level.id)?'requested_not_placed':'optional_not_placed',
      kitchenBalconyPreferredDepthMm:KITCHEN_BALCONY_DEPTH_MM,
      livingBalconyConnection:level.rooms?.rooms.some(r=>r.type==='livingRoom')?
        LIVING_BALCONY_CONNECTION:'not_applicable',
      bedroomBalcony:level.rooms?.rooms.some(r=>['bedroom','primaryBedroom','guestBedroom'].includes(r.type))?
        'optional_if_site_structure_and_daylight_permit':'not_applicable',
      tulsiMuth:level.id===uppermost?'preferred_on_topmost_safe_balcony_not_placed':'not_applicable',
      areaAndStructureReview:'balcony_projection_setback_coverage_FAR_cantilever_and_guard_unverified',
      rainChajja:{preferredProjectionMm:[305,610],
        applyOnlyToExposedNonFlushFacades:true,
        status:level.rainChajjas?.reservations.length?
          'geometric_projection_reserved_legal_structure_unverified':'no_projection_reserved',
        reservationCount:level.rainChajjas?.reservations.length||0,
        omittedCount:level.rainChajjas?.omitted.length||0},
    };
    for(const room of level.rooms?.rooms||[]){
      room.finishIntent={
        walls:['plaster','putty','paint'],
        floor:room.type==='bathroom'?'tile':
          ['bedroom','primaryBedroom','guestBedroom','livingRoom','livingAnnex'].includes(room.type)?
            'carpet_or_parquet_over_screed_and_concrete':'finish_selection_pending',
        ...(room.type==='bathroom'?{wallTileHeightMm:1500,
          showerWallTile:'full_height_to_ceiling',bathtubDefault:false}:{}),
        quantityStatus:'unmeasured_finish_intent',
      };
      if(room.type==='livingRoom')room.furnishingIntent={
        sofa:'seven_seat_corner',tv:'wall_or_cabinet_facing_sofa',coffeeTable:true,
        geometryStatus:'not_placed_or_clearance_checked',
      };
      if(room.type==='kitchen')room.furnishingIntent={
        counter:'continuous_concrete_slab',counterTopHeightMm:1000,
        appliances:['stove','sink','chimney','rice_cooker'],
        lowerCabinets:true,upperCabinets:true,applianceClearance:'not_sized',
        dining:room.diningWithinKitchen?'combined_in_this_room':'separate_room_requested',
        geometryStatus:'not_placed_or_clearance_checked',
      };
    }
  }
  candidate.residentialDetailStatus='owner_conventions_recorded_geometry_and_quantities_pending';
  return candidate;
}

module.exports={LIVING_BALCONY_CONNECTION,attachResidentialDetails,KITCHEN_BALCONY_DEPTH_MM};
