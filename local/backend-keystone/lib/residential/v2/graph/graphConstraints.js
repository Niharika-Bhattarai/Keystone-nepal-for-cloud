'use strict';

const REQUIRED_ADJACENCIES = Object.freeze({
  entrance_room: ['common_area'],
  common_area: ['entrance_room', 'farmhouse_kitchen', 'dining_room'],
  farmhouse_kitchen: ['common_area'],
  dining_room: ['common_area', 'farmhouse_kitchen'],
  stair_core: ['common_area', 'landing'],
  landing: ['stair_core'],
  lower_landing: ['stair_core', 'common_area'],
  primary_suite: ['landing', 'primary_bath_buffer'],
  secondary_bedroom: ['landing'],
  special_room: [],
  study: ['common_area'],
  shared_bath: ['landing'],
  secondary_private_bath: ['secondary_bedroom'],
  lower_shared_bath: ['lower_landing'],
  storage_upper: ['landing'],
  primary_bath_buffer: ['primary_suite'],
  suite_buffer: ['primary_bath_buffer'],
  mudroom: ['garage', 'stair_core'],
  laundry: ['mudroom'],
});

const FORBIDDEN_ADJACENCIES = Object.freeze({
  landing: ['study', 'primary_suite'],
  lower_landing: [],
  staircase_private_edge: ['bedroom', 'primary_bedroom', 'study'],
});

const BUFFER_REQUIREMENTS = Object.freeze({
  primary_suite: ['primary_bath_buffer'],
  common_area: ['shared_bath', 'storage'],
  lower_shared_bath: [],
  suite_buffer: [],
});

function resolveRequiredAdjacencies(role, descriptor = {}) {
  if (role === 'special_room') {
    const type = String(descriptor?.type || '').trim().toLowerCase();
    if (type === 'wine_cellar') return ['farmhouse_kitchen'];
    return [Number(descriptor?.level || 1) === 2 ? 'landing' : 'common_area'];
  }
  return REQUIRED_ADJACENCIES[role] || [];
}

function resolveForbiddenAdjacencies(role, descriptor = {}) {
  if (role === 'special_room') {
    const type = String(descriptor?.type || '').trim().toLowerCase();
    if (['gym', 'movie_room', 'music_room', 'gaming_room'].includes(type)) {
      return ['primary_suite', 'primary_bedroom'];
    }
    return [];
  }
  return FORBIDDEN_ADJACENCIES[role] || [];
}

function resolveBufferRequirements(role, descriptor = {}) {
  if (role === 'special_room') {
    const type = String(descriptor?.type || '').trim().toLowerCase();
    if (type === 'library') return ['storage'];
    return [];
  }
  return BUFFER_REQUIREMENTS[role] || [];
}

module.exports = {
  REQUIRED_ADJACENCIES,
  FORBIDDEN_ADJACENCIES,
  BUFFER_REQUIREMENTS,
  resolveRequiredAdjacencies,
  resolveForbiddenAdjacencies,
  resolveBufferRequirements,
};
