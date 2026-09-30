'use strict';

function roleNode(key, role, type, level, extras = {}) {
  return {
    key,
    role,
    type,
    level,
    ...extras,
  };
}

function baseTwoStoryGaragePreset({
  pattern,
  includeStudy = false,
  bedroomCount = 2,
  hasUpperSharedBath = true,
  hasLowerSharedBath = false,
  hasSecondaryPrivateBath = false,
  specialRooms = [],
  specialRoomType = null,
  specialRoomLevel = 1,
}) {
  const nodes = [
    roleNode('entrance_room', 'entrance_room', 'entry', 1, { preferredSide: 'south' }),
    roleNode('common_area', 'common_area', 'living_room', 1, { preferredSide: 'east' }),
    roleNode('farmhouse_kitchen', 'farmhouse_kitchen', 'kitchen', 1, { preferredSide: 'north' }),
    roleNode('dining_room', 'dining_room', 'dining_room', 1, { preferredSide: 'west' }),
    roleNode('stair_core_lower', 'stair_core', 'stairs', 1, { preferredSide: 'center' }),
    roleNode('lower_landing', 'lower_landing', 'hallway', 1, { preferredSide: 'center' }),
    roleNode('garage', 'garage', 'garage', 1, { preferredSide: 'west' }),
    roleNode('mudroom', 'mudroom', 'mudroom', 1, { preferredSide: 'south' }),
    roleNode('laundry', 'laundry', 'laundry', 1, { preferredSide: 'south' }),
    roleNode('stair_core_upper', 'stair_core', 'stairs', 2, { preferredSide: 'center' }),
    roleNode('landing', 'landing', 'hallway', 2, { preferredSide: 'north' }),
    roleNode('primary_suite', 'primary_suite', 'primary_bedroom', 2, { preferredSide: 'east' }),
    roleNode('primary_bath_buffer', 'primary_bath_buffer', 'primary_bathroom', 2, { preferredSide: 'south' }),
    roleNode('secondary_bedroom_1', 'secondary_bedroom', 'bedroom', 2, { preferredSide: 'west' }),
    roleNode('storage_upper', 'storage_upper', 'storage', 2, { preferredSide: 'north' }),
  ];

  if (hasUpperSharedBath) {
    nodes.push(roleNode('shared_bath', 'shared_bath', 'bathroom', 2, { preferredSide: 'northwest' }));
  }

  if (hasLowerSharedBath) {
    nodes.push(roleNode('lower_shared_bath', 'lower_shared_bath', 'bathroom', 1, { preferredSide: 'east' }));
  }

  if (bedroomCount >= 3) {
    nodes.push(roleNode('secondary_bedroom_2', 'secondary_bedroom', 'bedroom', 2, {
      preferredSide: 'north',
      matchIndex: 1,
    }));
    nodes.push(roleNode('suite_buffer', 'suite_buffer', 'storage', 2, {
      preferredSide: 'south',
    }));
  }

  if (bedroomCount >= 4) {
    nodes.push(roleNode('secondary_bedroom_3', 'secondary_bedroom', 'bedroom', 2, {
      preferredSide: 'east',
      matchIndex: 2,
    }));
  }

  if (hasSecondaryPrivateBath) {
    nodes.push(roleNode('secondary_private_bath', 'secondary_private_bath', 'bathroom', 2, {
      preferredSide: 'north',
      bathroomUse: 'private',
    }));
  }

  const normalizedSpecialRooms = Array.isArray(specialRooms) && specialRooms.length
    ? specialRooms
    : (includeStudy || specialRoomType)
      ? [{ type: specialRoomType || 'study', level: specialRoomLevel }]
      : [];
  normalizedSpecialRooms.forEach((specialRoom, index) => {
    const roomType = String(specialRoom?.type || '').trim().toLowerCase();
    const roomLevel = Number(specialRoom?.level || 1);
    if (!roomType) return;
    const key = index === 0 ? 'special_room' : index === 1 ? 'special_room_secondary' : `special_room_${index + 1}`;
    nodes.push(roleNode(key, 'special_room', roomType, roomLevel, {
      preferredSide: roomLevel === 2 ? 'east' : 'east',
      roomId: specialRoom.roomId,
      featureKind: specialRoom.featureKind || roomType,
      matchIndex: 0,
    }));
  });

  const edges = [
    ['entrance_room', 'common_area'],
    ['common_area', 'farmhouse_kitchen'],
    ['common_area', 'dining_room'],
    ['common_area', 'lower_landing'],
    ['lower_landing', 'stair_core_lower'],
    ['lower_landing', 'mudroom'],
    ['garage', 'mudroom'],
    ['mudroom', 'laundry'],
    ['stair_core_lower', 'stair_core_upper'],
    ['stair_core_upper', 'landing'],
    ['landing', 'primary_suite'],
    ['landing', 'secondary_bedroom_1'],
    ['landing', 'storage_upper'],
    ['primary_suite', 'primary_bath_buffer'],
  ];

  if (hasUpperSharedBath) {
    edges.push(['landing', 'shared_bath']);
  }

  if (hasLowerSharedBath) {
    edges.push(['lower_landing', 'lower_shared_bath']);
  }

  if (bedroomCount >= 3) {
    edges.push(['landing', 'secondary_bedroom_2']);
    edges.push(['primary_bath_buffer', 'suite_buffer']);
  }
  if (bedroomCount >= 4) {
    edges.push(['landing', 'secondary_bedroom_3']);
  }
  if (hasSecondaryPrivateBath) {
    edges.push(['secondary_bedroom_2', 'secondary_private_bath']);
  }
  normalizedSpecialRooms.forEach((specialRoom, index) => {
    const roomLevel = Number(specialRoom?.level || 1);
    const key = index === 0 ? 'special_room' : index === 1 ? 'special_room_secondary' : `special_room_${index + 1}`;
    if (roomLevel === 2) edges.push(['landing', key]);
    else edges.push(['common_area', key]);
  });

  return { pattern, nodes, edges };
}

function baseTwoStoryCompactPreset({
  pattern,
  bedroomCount = 2,
  hasUpperSharedBath = true,
  hasLowerSharedBath = false,
  hasSecondaryPrivateBath = false,
  specialRooms = [],
  specialRoomType = null,
  specialRoomLevel = 1,
}) {
  const nodes = [
    roleNode('entrance_room', 'entrance_room', 'entry', 1, { preferredSide: 'south' }),
    roleNode('common_area', 'common_area', 'living_room', 1, { preferredSide: 'east' }),
    roleNode('farmhouse_kitchen', 'farmhouse_kitchen', 'kitchen', 1, { preferredSide: 'north' }),
    roleNode('dining_room', 'dining_room', 'dining_room', 1, { preferredSide: 'west' }),
    roleNode('stair_core_lower', 'stair_core', 'stairs', 1, { preferredSide: 'center' }),
    roleNode('lower_landing', 'lower_landing', 'hallway', 1, { preferredSide: 'center' }),
    roleNode('laundry', 'laundry', 'laundry', 1, { preferredSide: 'south' }),
    roleNode('stair_core_upper', 'stair_core', 'stairs', 2, { preferredSide: 'center' }),
    roleNode('landing', 'landing', 'hallway', 2, { preferredSide: 'north' }),
    roleNode('primary_suite', 'primary_suite', 'primary_bedroom', 2, { preferredSide: 'east' }),
    roleNode('primary_bath_buffer', 'primary_bath_buffer', 'primary_bathroom', 2, { preferredSide: 'south' }),
    roleNode('secondary_bedroom_1', 'secondary_bedroom', 'bedroom', 2, { preferredSide: 'west' }),
    roleNode('storage_upper', 'storage_upper', 'storage', 2, { preferredSide: 'north' }),
  ];

  if (hasUpperSharedBath) {
    nodes.push(roleNode('shared_bath', 'shared_bath', 'bathroom', 2, { preferredSide: 'northwest' }));
  }

  if (hasLowerSharedBath) {
    nodes.push(roleNode('lower_shared_bath', 'lower_shared_bath', 'bathroom', 1, { preferredSide: 'east' }));
  }

  if (bedroomCount >= 3) {
    nodes.push(roleNode('secondary_bedroom_2', 'secondary_bedroom', 'bedroom', 2, {
      preferredSide: 'north',
      matchIndex: 1,
    }));
    nodes.push(roleNode('suite_buffer', 'suite_buffer', 'storage', 2, {
      preferredSide: 'south',
    }));
  }

  if (bedroomCount >= 4) {
    nodes.push(roleNode('secondary_bedroom_3', 'secondary_bedroom', 'bedroom', 2, {
      preferredSide: 'east',
      matchIndex: 2,
    }));
  }

  if (hasSecondaryPrivateBath) {
    nodes.push(roleNode('secondary_private_bath', 'secondary_private_bath', 'bathroom', 2, {
      preferredSide: 'north',
      bathroomUse: 'private',
    }));
  }

  const normalizedSpecialRooms = Array.isArray(specialRooms) && specialRooms.length
    ? specialRooms
    : specialRoomType
      ? [{ type: specialRoomType, level: specialRoomLevel }]
      : [];
  normalizedSpecialRooms.forEach((specialRoom, index) => {
    const roomType = String(specialRoom?.type || '').trim().toLowerCase();
    const roomLevel = Number(specialRoom?.level || 1);
    if (!roomType) return;
    const key = index === 0 ? 'special_room' : index === 1 ? 'special_room_secondary' : `special_room_${index + 1}`;
    nodes.push(roleNode(key, 'special_room', roomType, roomLevel, {
      preferredSide: roomLevel === 2 ? 'east' : 'west',
      roomId: specialRoom.roomId,
      featureKind: specialRoom.featureKind || roomType,
      matchIndex: 0,
    }));
  });

  const edges = [
    ['entrance_room', 'common_area'],
    ['common_area', 'farmhouse_kitchen'],
    ['common_area', 'dining_room'],
    ['common_area', 'lower_landing'],
    ['lower_landing', 'stair_core_lower'],
    ['lower_landing', 'laundry'],
    ['stair_core_lower', 'stair_core_upper'],
    ['stair_core_upper', 'landing'],
    ['landing', 'primary_suite'],
    ['landing', 'secondary_bedroom_1'],
    ['landing', 'storage_upper'],
    ['primary_suite', 'primary_bath_buffer'],
  ];

  if (hasUpperSharedBath) {
    edges.push(['landing', 'shared_bath']);
  }

  if (hasLowerSharedBath) {
    edges.push(['lower_landing', 'lower_shared_bath']);
  }

  if (bedroomCount >= 3) {
    edges.push(['landing', 'secondary_bedroom_2']);
    edges.push(['primary_bath_buffer', 'suite_buffer']);
  }
  if (bedroomCount >= 4) {
    edges.push(['landing', 'secondary_bedroom_3']);
  }
  if (hasSecondaryPrivateBath) {
    edges.push(['secondary_bedroom_2', 'secondary_private_bath']);
  }

  normalizedSpecialRooms.forEach((specialRoom, index) => {
    const roomLevel = Number(specialRoom?.level || 1);
    const key = index === 0 ? 'special_room' : index === 1 ? 'special_room_secondary' : `special_room_${index + 1}`;
    if (roomLevel === 2) edges.push(['landing', key]);
    else edges.push(['common_area', key]);
  });

  return { pattern, nodes, edges };
}

function getFamilyPreset(options = {}) {
  const housePattern = typeof options === 'string' ? options : options.housePattern;
  const hasUpperSharedBath = Boolean(options && typeof options === 'object' && options.hasUpperSharedBath !== false);
  const hasLowerSharedBath = Boolean(options && typeof options === 'object' && options.hasLowerSharedBath);
  const hasSecondaryPrivateBath = Boolean(options && typeof options === 'object' && options.hasSecondaryPrivateBath);
  const specialRooms = options && typeof options === 'object' && Array.isArray(options.specialRooms)
    ? options.specialRooms
    : [];
  const specialRoomType = options && typeof options === 'object' ? options.specialRoomType : null;
  const specialRoomLevel = options && typeof options === 'object' ? options.specialRoomLevel : 1;
  switch (String(housePattern || '')) {
    case 'two_story_upper_primary_compact':
      return baseTwoStoryCompactPreset({
        pattern: housePattern,
        bedroomCount: 2,
        hasUpperSharedBath,
        hasLowerSharedBath,
        hasSecondaryPrivateBath,
        specialRooms,
        specialRoomType,
        specialRoomLevel,
      });
    case 'two_story_upper_primary_three_bed_compact':
      return baseTwoStoryCompactPreset({
        pattern: housePattern,
        bedroomCount: 3,
        hasUpperSharedBath,
        hasLowerSharedBath,
        hasSecondaryPrivateBath,
        specialRooms,
        specialRoomType,
        specialRoomLevel,
      });
    case 'two_story_upper_primary_four_bed_compact':
      return baseTwoStoryCompactPreset({
        pattern: housePattern,
        bedroomCount: 4,
        hasUpperSharedBath,
        hasLowerSharedBath,
        hasSecondaryPrivateBath,
        specialRooms,
        specialRoomType,
        specialRoomLevel,
      });
    case 'two_story_upper_primary_with_garage':
      return baseTwoStoryGaragePreset({ pattern: housePattern, bedroomCount: 2, includeStudy: false, hasUpperSharedBath, hasLowerSharedBath, hasSecondaryPrivateBath, specialRooms, specialRoomType, specialRoomLevel });
    case 'two_story_upper_primary_with_garage_three_bed':
      return baseTwoStoryGaragePreset({ pattern: housePattern, bedroomCount: 3, includeStudy: false, hasUpperSharedBath, hasLowerSharedBath, hasSecondaryPrivateBath, specialRooms, specialRoomType, specialRoomLevel });
    case 'two_story_upper_primary_with_garage_four_bed':
      return baseTwoStoryGaragePreset({ pattern: housePattern, bedroomCount: 4, includeStudy: false, hasUpperSharedBath, hasLowerSharedBath, hasSecondaryPrivateBath, specialRooms, specialRoomType, specialRoomLevel });
    case 'two_story_upper_primary_with_garage_study':
      return baseTwoStoryGaragePreset({ pattern: housePattern, bedroomCount: 2, includeStudy: true, hasUpperSharedBath, hasLowerSharedBath, hasSecondaryPrivateBath, specialRooms, specialRoomType: specialRoomType || 'study', specialRoomLevel });
    default:
      return null;
  }
}

module.exports = {
  getFamilyPreset,
};
