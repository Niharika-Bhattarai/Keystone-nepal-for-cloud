// lib/tile/tilesToPlanSpec.js
const { makeDisplayLabels } = require('./canonicalRoomTypes');
const { resolveLevelExteriorGeometry } = require('../planEnvelope');

/**
 * Convert tile-coordinate plan into foot-coordinate planSpec.
 * If brief.frontFacing === 'South', applies a Y-flip so public rooms
 * end up at the bottom (south wall = street-facing side).
 */
function tilesToPlanSpec(tilePlan, footprint, brief) {
  const tileSizeFt   = footprint.tileSizeFt;
  const protrusionFt = footprint.protrusionFt || 0;

  // Determine if we need to flip the Y axis for street orientation.
  // North (default): public rooms at y=0 (top of drawing = north wall = street).
  // South: public rooms should be at y=max (south wall = street), so flip.
  const facing = String(brief?.frontFacing || 'North').toUpperCase();
  const flipY  = facing === 'SOUTH';

  function applyFlipY(lvlH, y, h) {
    return flipY ? lvlH - y - h : y;
  }

  function applyFlipSide(side) {
    const s = String(side || '').toLowerCase();
    if (!flipY) return s || null;
    if (s === 'top') return 'bottom';
    if (s === 'bottom') return 'top';
    return s || null;
  }

  const planSpec = {
    stories:       tilePlan.stories,
    totalAreaSqFt: footprint.totalAreaSqFt,
    tileSizeFt,
    frontFacing:   facing,  // stored for renderer + downstream consumers
    levels: (tilePlan.levels || []).map((lvl) => {
      const lvlW  = lvl.widthTiles  * tileSizeFt;
      const lvlH  = lvl.heightTiles * tileSizeFt;
      const protFt = lvl.level === 1 ? protrusionFt : 0;

      const levelSpec = {
        level: lvl.level,
        width:  lvlW,
        height: lvlH,
        // When Y-flipped the protrusion (garage) moves to the bottom edge.
        protrusionFt: protFt,
        protrusionSide: flipY && protFt > 0 ? 'bottom' : 'top',
        zones: (lvl.zones || []).map((zone) => ({
          zone: zone.zone,
          x: zone.x * tileSizeFt,
          y: applyFlipY(lvlH, zone.y * tileSizeFt, zone.h * tileSizeFt),
          w: zone.w * tileSizeFt,
          h: zone.h * tileSizeFt,
        })),
        stairCore: lvl.stairCore ? {
          level: lvl.stairCore.level,
          x: lvl.stairCore.x * tileSizeFt,
          y: applyFlipY(lvlH, lvl.stairCore.y * tileSizeFt, lvl.stairCore.h * tileSizeFt),
          w: lvl.stairCore.w * tileSizeFt,
          h: lvl.stairCore.h * tileSizeFt,
          hallRoomId: lvl.stairCore.hallRoomId || null,
          landingRoomId: lvl.stairCore.landingRoomId || lvl.stairCore.hallRoomId || null,
          landingSide: applyFlipSide(lvl.stairCore.landingSide),
          landingOpen: Boolean(lvl.stairCore.landingOpen),
          branchRoomIds: Array.isArray(lvl.stairCore.branchRoomIds) ? lvl.stairCore.branchRoomIds : [],
        } : null,
        rooms: (lvl.rooms || []).map((room) => {
          const rh = room.h * tileSizeFt;
          const r  = {
            id:    String(room.id),
            type:  room.type,
            x:     room.x  * tileSizeFt,
            y:     applyFlipY(lvlH, room.y * tileSizeFt, rh),
            w:     room.w  * tileSizeFt,
            h:     rh,
            level: lvl.level,
          };
          if (room.label)       r.label       = room.label;
          if (room.programId)   r.programId   = room.programId;
          if (room.openConcept) r.openConcept = true;
          if (room.bathroomUse) r.bathroomUse = room.bathroomUse;
          if (room.attachedTo)  r.attachedTo  = room.attachedTo;
          if (room.requestedFeature !== undefined) r.requestedFeature = Boolean(room.requestedFeature);
          if (room.isFeatureRoom !== undefined) r.isFeatureRoom = Boolean(room.isFeatureRoom);
          if (room.featureSource) r.featureSource = room.featureSource;
          if (room.requestedFeatureKind) r.requestedFeatureKind = room.requestedFeatureKind;
          if (room.requestedFeatureLabel) r.requestedFeatureLabel = room.requestedFeatureLabel;
          if (room.featurePlacementFamily) r.featurePlacementFamily = room.featurePlacementFamily;
          if (room.roomContract) r.roomContract = room.roomContract;
          if (Array.isArray(room.parts)) {
            r.parts = room.parts.map((p) => {
              const ph = p.h * tileSizeFt;
              return {
                x: p.x * tileSizeFt,
                y: applyFlipY(lvlH, p.y * tileSizeFt, ph),
                w: p.w * tileSizeFt,
                h: ph,
              };
            });
          }
          return r;
        }),
        doors:   [],
        windows: [],
      };
      const exteriorGeometry = resolveLevelExteriorGeometry(levelSpec);
      levelSpec.outlineSegments = exteriorGeometry.segments;
      levelSpec.envelopeAreaSqFt = exteriorGeometry.areaSqFt;
      return levelSpec;
    }),
  };

  return makeDisplayLabels(planSpec);
}

module.exports = { tilesToPlanSpec };
