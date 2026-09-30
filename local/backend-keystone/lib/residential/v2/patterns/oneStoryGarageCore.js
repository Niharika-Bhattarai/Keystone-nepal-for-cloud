'use strict';

const { placeRoom } = require('../fitRoomsToRealms');
const { partListOf, boundingRectOf, shareWall } = require('../../../planGeometry');

function oneStoryGarageCore({ brief, footprint, program }) {
  const width = Number(footprint.widthFt), height = Number(footprint.heightFt);
  const specs = [...program.levels.find(l => l.level === 1).rooms];
  const take = type => { const i = specs.findIndex(r => r.type === type); return i < 0 ? null : specs.splice(i,1)[0]; };
  const garage = take('garage'), entry = take('entry'), laundry = take('laundry'), mudroom = take('mudroom');
  const primary = take('primary_bedroom'), ensuite = take('primary_bathroom'), bedroom = take('bedroom');
  const thirdBedroom = take('bedroom');
  const kitchen = take('kitchen'), dining = take('dining_room'), living = take('living_room');
  const baths = specs.filter(r => r.type === 'bathroom');
  if (specs.some(r => r.type !== 'bathroom' && r.zone !== 'outdoor')) throw new Error('Compact garage family needs a dedicated extra-room position');
  // The north-west notch removes the back of the service wing. Reserve its
  // full width before allocating rooms, so the hall sits beside the notch
  // instead of being left partly outside the house by post-placement carving.
  const serviceNotch = String(footprint.envelopeShape).toUpperCase() === 'L_SHAPE'
    ? (footprint.envelopeVoidRects || []).find(r => r.x === 0 && r.y === 0)
    : null;
  const garageWidth = Math.max(brief.garageType === 'TWO_CAR' ? 20 : 14, serviceNotch?.w || 0);
  const serviceEnd = height - (serviceNotch?.h || 0);
  // With no primary ensuite, use that independently accessible service slot
  // for a requested shared bathroom. It must retain shared access semantics.
  const primaryWingBath = ensuite || (serviceNotch ? baths.shift() : null);
  const hallWidth = brief.accessibility?.wideDoors ? 6 : 4;
  const mainX = garageWidth + hallWidth, mainWidth = width - mainX;
  const bedroomHallWidth = thirdBedroom ? 4 : 0;
  const leftWidth = Math.floor((mainWidth - bedroomHallWidth) / 2), rightWidth = mainWidth - bedroomHallWidth - leftWidth;
  const compact = Number(brief.totalAreaSqFt) <= 1800;
  const privateDepth = thirdBedroom && !compact ? 24 : 20, kitchenDepth = 10;
  const socialDepth = height - privateDepth - kitchenDepth;
  const garageDepth = 20;
  if (leftWidth < (compact ? 10 : 12) || rightWidth < (compact ? 10 : 12) || socialDepth < 10 || serviceEnd - garageDepth < 8 + baths.length * 6) {
    throw new Error('Garage core needs bedroom widths and independent service-room clearances');
  }
  const rooms = [];
  const put = (spec,x,y,w,h) => { if (spec) rooms.push(placeRoom(spec,{x,y,w,h})); };
  put(garage,0,0,garageWidth,garageDepth);
  const service = [mudroom,laundry,...baths].filter(Boolean);
  // Rooms all face the independent hall, including every shared bathroom.
  const serviceMinimum = service.map(room => room.type === 'bathroom' ? 6 : 4);
  // Whole feet: the last room takes the remainder (13.33 ft rooms read as a bug).
  const extraServiceDepth = Math.floor((serviceEnd - garageDepth - serviceMinimum.reduce((sum, h) => sum + h, 0)) / service.length);
  let serviceY = garageDepth;
  const utilityWidth = garageWidth > 16 ? garageWidth - 16 : 0;
  service.forEach((room,i) => {
    const depth = i === service.length - 1 ? serviceEnd - serviceY : serviceMinimum[i] + extraServiceDepth;
    put(room,utilityWidth,serviceY,garageWidth-utilityWidth,depth);
    serviceY += depth;
  });
  if (utilityWidth) put({id:'architect_v2_utility_store',type:'storage',level:1,label:'Utility storage'},0,garageDepth,utilityWidth,serviceEnd-garageDepth);
  if (serviceNotch && garageWidth > serviceNotch.w) put({id:'architect_v2_notch_store',type:'storage',level:1,label:'Storage'},serviceNotch.w,serviceEnd,garageWidth-serviceNotch.w,height-serviceEnd);
  put(entry,garageWidth,0,hallWidth,6);
  put({id:'architect_v2_garage_hall',type:'hallway',level:1,label:'Bedroom and service hall'},garageWidth,6,hallWidth,height-6);
  const frontBath = String(footprint.variationId).includes('deep_garden');
  put(primary,mainX,frontBath ? 8 : 0,leftWidth,privateDepth-8);
  put(primaryWingBath,mainX,frontBath ? 0 : privateDepth-8,leftWidth,8);
  const rightX = mainX + leftWidth + bedroomHallWidth;
  if (thirdBedroom) {
    put({id:'architect_v2_secondary_bedroom_hall',type:'hallway',level:1,label:'Bedroom hall'},mainX+leftWidth,0,bedroomHallWidth,privateDepth);
    put(bedroom,rightX,0,rightWidth,privateDepth/2);
    put(thirdBedroom,rightX,privateDepth/2,rightWidth,privateDepth/2);
  } else put(bedroom,rightX,0,rightWidth,privateDepth);
  if (frontBath) {
    // Put the suite on the opposite exterior wing for the garden variant.
    // Its ensuite moves with it; the central bedroom hall still serves both
    // sleeping wings without passing through another bedroom.
    for (const room of rooms.filter(r => r.x >= mainX && r.y < privateDepth)) {
      room.x = mainX + mainWidth - (room.x - mainX) - room.w;
    }
  }
  const reverseSocial = String(footprint.variationId).includes('central_hub');
  const socialRightWidth = reverseSocial ? Math.max(12, rightWidth) : rightWidth;
  const socialLeftWidth = mainWidth - socialRightWidth;
  put(reverseSocial ? living : dining,mainX,privateDepth,socialLeftWidth,socialDepth);
  put(reverseSocial ? dining : living,mainX+socialLeftWidth,privateDepth,socialRightWidth,socialDepth);
  put(kitchen,mainX,height-kitchenDepth,mainWidth,kitchenDepth);
  if (!brief.kitchenRear) {
    for (const room of rooms.filter(r => r.x >= mainX)) room.y = height - room.y - room.h;
  }
  for (const room of rooms) room.y = height - room.y - room.h;
  // A larger house should enlarge the suite, not stretch its bathroom across
  // the entire sleeping wing. Transfer the surplus to its actual owner.
  for (const bath of rooms.filter(r => r.attachedTo && ['bathroom', 'primary_bathroom'].includes(r.type) && r.w > 16)) {
    const owner = rooms.find(r => r.id === bath.attachedTo);
    const addition = { x: bath.x + 12, y: bath.y, w: bath.w - 12, h: bath.h };
    if (!owner || !shareWall(owner, addition, 4)) continue;
    owner.parts = [...partListOf(owner), addition].map(({ x, y, w, h }) => ({ x, y, w, h }));
    Object.assign(owner, boundingRectOf(owner));
    bath.w = 12;
  }
  return { levels:[{level:1,width,height,rooms}] };
}
module.exports = { oneStoryGarageCore };
