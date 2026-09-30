'use strict';
const {rect}=require('./areaLedger');
// NBC 206:2024, physical PDF p.15, section 2.4.1 Table 4. General residence
// scope/municipal adoption still require professional confirmation.
const RESIDENTIAL_PROVISIONAL={minTreadMm:250,maxRiserMm:190,maxFlightRisers:15,
  minHeadroomMm:2000,minHandrailMm:900,minGeneralStairWidthMm:900,
  source:'NBC 206:2024 PDF page 15 Table 4; page 14 Table 3'};
function planHalfTurn({riseMm,core,clearWidthMm=1000,treadMm=270,landingDepthMm=1000,
  arrivalDepthMm=1400,
  profile=RESIDENTIAL_PROVISIONAL}) {
  const b=rect(core);
  if(!Number.isSafeInteger(riseMm)||riseMm<=0)throw new Error('Positive integer floor-to-floor rise required');
  if(clearWidthMm<profile.minGeneralStairWidthMm||treadMm<profile.minTreadMm)
    throw new Error('Stair width or tread is below provisional residential threshold');
  const risers=Math.ceil(riseMm/profile.maxRiserMm),first=Math.ceil(risers/2),second=risers-first;
  if(risers<4)throw new Error('A half-turn assembly needs at least two risers per flight');
  if(first>profile.maxFlightRisers||second>profile.maxFlightRisers)
    throw new Error('Floor rise needs more than two flights at the selected riser limit');
  const riserMm=riseMm/risers;
  const clearWidth=b.x2-b.x1-400,clearLength=b.y2-b.y1-400;
  const requiredWidth=clearWidthMm*2+200,runMm=(Math.max(first,second)-1)*treadMm;
  const run1=(first-1)*treadMm,run2=(second-1)*treadMm;
  const requiredLength=arrivalDepthMm+runMm+landingDepthMm;
  if(clearWidth<requiredWidth||clearLength<requiredLength)
    throw new Error(`Half-turn stair requires at least ${requiredWidth+400} x ${requiredLength+400} mm core`);
  const arrivalY=b.y1+200;
  const runY=arrivalY+arrivalDepthMm;
  const flight1={id:'flight-1',riserCount:first,riserMm,treadMm,runMm:run1,
    direction:'north',startElevationMm:0,endElevationMm:first*riserMm,
    box:rect([b.x1+200,runY,b.x1+200+clearWidthMm,runY+run1])};
  const flight2={id:'flight-2',riserCount:second,riserMm,treadMm,runMm:run2,
    direction:'south',startElevationMm:first*riserMm,endElevationMm:riseMm,
    box:rect([b.x1+400+clearWidthMm,runY+runMm-run2,b.x1+400+2*clearWidthMm,runY+runMm])};
  const landing={id:'intermediate-landing',elevationMm:first*riserMm,
    box:rect([b.x1+200,runY+runMm,b.x1+400+2*clearWidthMm,runY+runMm+landingDepthMm])};
  const arrivalBox=rect([b.x1+200,arrivalY,b.x1+400+2*clearWidthMm,runY]);
  return {topology:'halfTurnLanding',core:b,risers,riserMm,treadMm,clearWidthMm,
    flights:[flight1,flight2],landings:[landing],
    arrivalLandings:[{id:'lower-floor-arrival',elevationMm:0,box:arrivalBox},
      {id:'upper-floor-arrival',elevationMm:riseMm,box:arrivalBox}],
    requiredWidthMm:requiredWidth+400,
    requiredLengthMm:requiredLength+400,handrailHeightMm:profile.minHandrailMm,
    headroomStatus:'unverified_until_beam_and_slab_geometry',
    slabOpeningStatus:'reserved_not_engineered',codeProfile:profile};
}
module.exports={RESIDENTIAL_PROVISIONAL,planHalfTurn};
