'use strict';

function normalizeFacing(frontFacing) {
  const facing = String(frontFacing || 'south').trim().toLowerCase();
  if (facing.includes('north')) return 'north';
  if (facing.includes('east')) return 'east';
  if (facing.includes('west')) return 'west';
  return 'south';
}

function worldToLocalSide(frontFacing, worldSide) {
  const facing = normalizeFacing(frontFacing);
  const side = String(worldSide || '').trim().toLowerCase();
  if (!['north', 'south', 'east', 'west'].includes(side)) return null;

  const mapping = {
    south: { north: 'north', south: 'south', east: 'east', west: 'west' },
    north: { north: 'south', south: 'north', east: 'west', west: 'east' },
    east: { north: 'west', south: 'east', east: 'north', west: 'south' },
    west: { north: 'east', south: 'west', east: 'south', west: 'north' },
  };

  return mapping[facing]?.[side] || null;
}

function resolveHorizontalPreferredSide(frontFacing, sunAffinity = [], fallbackSide = null) {
  const candidates = Array.isArray(sunAffinity) ? sunAffinity : [];
  for (const worldSide of candidates) {
    const localSide = worldToLocalSide(frontFacing, worldSide);
    if (localSide === 'east' || localSide === 'west') return localSide;
  }
  const normalizedFallback = String(fallbackSide || '').trim().toLowerCase();
  if (normalizedFallback === 'east' || normalizedFallback === 'west') return normalizedFallback;
  return null;
}

module.exports = {
  normalizeFacing,
  worldToLocalSide,
  resolveHorizontalPreferredSide,
};
