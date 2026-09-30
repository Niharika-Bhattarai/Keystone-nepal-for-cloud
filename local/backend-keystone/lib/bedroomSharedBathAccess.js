'use strict';

// Every bedroom without its own bathroom needs a shared one it can reach
// without walking through another bedroom. The other bathroom checks only look
// at bathrooms (a private one must open to its own bedroom, a shared one to
// circulation); none of them notices a bedroom that has no bathroom at all,
// such as a two-bedroom, one-bathroom house whose only bathroom is the primary
// ensuite. A shared bathroom on another floor counts when the bedroom reaches
// the stair: a one-bathroom two-storey home keeps its bathroom upstairs, and
// several supported two-storey plans put their only shared bathroom below.

const { buildAccessGraph } = require('./residential/accessGraph');

const BEDROOM_TYPES = new Set(['bedroom', 'primary_bedroom', 'guest_bedroom']);
const BATH_TYPES = new Set(['bathroom', 'primary_bathroom']);

function validateBedroomSharedBathAccess(plan, brief = null) {
  const errors = [];
  const levels = plan?.levels || [];
  const attachedOwners = new Set(levels.flatMap((l) => l.rooms || [])
    .filter((r) => BATH_TYPES.has(r.type) && r.attachedTo).map((r) => String(r.attachedTo)));
  const sharedOn = new Map(levels.map((l) => [l.level, (l.rooms || []).filter((r) => BATH_TYPES.has(r.type) && !r.attachedTo)]));
  for (const level of levels) {
    const rooms = level.rooms || [];
    const byId = new Map(rooms.map((r) => [String(r.id), r]));
    // Doors, plus the open connections between public rooms in an
    // open-concept plan (which have no door records).
    const adjacency = buildAccessGraph(level, brief);
    const otherLevelShared = [...sharedOn].some(([n, list]) => n !== level.level && list.length);
    for (const bedroom of rooms.filter((r) => BEDROOM_TYPES.has(r.type) && !attachedOwners.has(String(r.id)))) {
      const start = String(bedroom.id);
      const seen = new Set([start]);
      const queue = [start];
      let reached = false;
      while (queue.length && !reached) {
        const id = queue.shift();
        for (const next of adjacency.get(id) || []) {
          if (seen.has(next)) continue;
          seen.add(next);
          const room = byId.get(next);
          if (BATH_TYPES.has(room.type) && !room.attachedTo) { reached = true; break; }
          if (room.type === 'stairs' && otherLevelShared) { reached = true; break; }
          // Another bedroom, or a bathroom that belongs to one, is not a route.
          if (BEDROOM_TYPES.has(room.type) || BATH_TYPES.has(room.type)) continue;
          queue.push(next);
        }
      }
      if (!reached) {
        errors.push(`Survey bathroom access: ${bedroom.id} has no bathroom of its own and no shared bathroom it can reach without passing through another bedroom.`);
      }
    }
  }
  return errors;
}

module.exports = { validateBedroomSharedBathAccess };
