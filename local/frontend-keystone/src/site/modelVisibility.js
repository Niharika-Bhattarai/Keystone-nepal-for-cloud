// Shared by quick and baked models; names survive material splits and GLB export.
export function modelGroup(mesh) {
  for (let node = mesh; node; node = node.parent) {
    const match = /^(Level \d+|Furniture \d+|Ceiling \d+|Roof|Lawn)(?=$|[ ._])/.exec(node.name || '');
    if (match) return match[1];
  }
  return 'other';
}

export function modelGroupVisible(group, upTo, roofOn, levels) {
  const visibleLevels = levels.map(l => Number(l.level)).filter(l => Number.isFinite(l) && l <= upTo);
  const top = Math.max(...visibleLevels);
  if (group === 'Roof') return roofOn && upTo >= 99;
  const match = /^(Level|Furniture|Ceiling) (\d+)$/.exec(group);
  if (!match) return true;
  const level = Number(match[2]);
  if (level > upTo) return false;
  // Expose the selected floor, keeping ceilings over enclosed lower floors.
  if (match[1] === 'Ceiling') return level < top || (roofOn && upTo >= 99);
  return true;
}
