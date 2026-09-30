'use strict';

// Current survey controls and their intended evidence. An entry is not a claim
// that its geometry is implemented: fulfillment must be measured on each plan.
const number = (min, max, units, suffix = '') => ({ type: 'number', min, max, units, suffix });
const choice = (...values) => ({ type: 'choice', values });
const fields = {
  location: { type: 'text', evidence: 'site.location' },
  totalArea: { ...number(600, 10000, 'sq_ft'), evidence: 'finishedRoomArea' },
  stories: { ...number(1, 2, 'count', 'Stor(?:y|ies)'), integer: true, evidence: 'aboveGradeLevels' },
  bedrooms: { ...number(1, 5, 'count', 'Bed(?:rooms?)?s?'), integer: true, evidence: 'householdBedroomProgram' },
  bathrooms: { ...number(1, 5, 'count', 'Bath(?:rooms?)?s?'), integer: true, evidence: 'fullBathroomFixtures' },
  privateBaths: { ...number(0, 5, 'count'), integer: true, evidence: 'bedroomBathroomAttachments' },
  privateBathCount: { ...number(0, 5, 'count'), integer: true, evidence: 'bedroomBathroomAttachments' },
  sharedBathroomCount: { ...number(0, 5, 'count'), integer: true, evidence: 'sharedBathroomAccess' },
  bedroomConfigs: { type: 'bedrooms', evidence: 'bedroomAttachmentsAndClosets' },
  bedroomProgram: { type: 'bedrooms', evidence: 'stableBedroomProgramIds' },
  shape: { ...choice('Rectangular', 'Rectangular (Wide)', 'Rectangular (Deep)', 'Square', 'L-Shaped', 'T-Shaped'), evidence: 'footprintPolygon' },
  garage: { ...choice('No Garage', '1 Car Garage', '2 Car Garage'), aliases: { None: 'No Garage' }, evidence: 'vehicleAndDoorEnvelopes' },
  frontFacing: { ...choice('North', 'South', 'East', 'West'), evidence: 'facade.frontEdge' },
  lotContext: { ...choice('Suburban standard lot', 'Suburban corner lot', 'Urban tight lot', 'Rural acreage', 'View focused site', 'Waterfront lot'), evidence: 'siteConstraints' },
  lotWidth: { ...number(0, Infinity, 'ft'), exclusiveMin: true, optionalBlank: true, evidence: 'orientedSiteEnvelope.width' },
  lotDepth: { ...number(0, Infinity, 'ft'), exclusiveMin: true, optionalBlank: true, evidence: 'orientedSiteEnvelope.depth' },
  openConcept: { ...choice('Open Concept (Combined)', 'Traditional (Separate Rooms)'), evidence: 'publicRoomPartitions' },
  masterLocation: { ...choice('Level 1 (Main)', 'Level 2 (Upper)'), evidence: 'primaryBedroom.level' },
  kitchenPlacement: { ...choice('Rear of House', 'Front of House'), evidence: 'kitchenExteriorFacade' },
  laundryLocation: { ...choice('Level 1 (near garage/mud)', 'Level 2 (near bedrooms)', 'No preference'), evidence: 'laundry.level' },
  ceilingHeight: { ...choice('Standard (9 ft)', 'Tall (10 ft)', 'Cathedral / Vaulted'), evidence: 'ceilingSurfacesAndLevelDatums' },
  materials: { ...choice('Craftsman (Wood & Stone)', 'Modern Farmhouse (Board & Batten)', 'Traditional Colonial (Brick)', 'Contemporary Modern (Concrete)', 'Mediterranean (Stucco & Tile)'), evidence: 'finishSchedule' },
  indoorOutdoor: { ...choice('Minimal (enclosed feel)', 'Moderate (some connection)', 'Maximum (open to outdoors)'), evidence: 'exteriorOpeningSpans' },
  naturalLight: { ...choice('Balanced windows', 'Maximum glazing', 'Privacy first (fewer windows)'), evidence: 'exteriorGlazing' },
  features: { type: 'features', values: ['Study', 'Home Theater', 'Gym', 'Gaming Room', 'Library', 'Wine Cellar', 'Music Room', 'Guest Suite', 'Playroom'], evidence: 'featureRoomProgram' },
  accessibilityNeeds: { ...choice('None', 'Wheelchair accessible', 'Wide doorways', 'Single-level preferred'), evidence: 'clearRoutesOpeningsAndFixtures' },
  budgetTier: { ...choice('Entry ($120-180/sqft)', 'Mid ($200-300/sqft)', 'Luxury ($350+/sqft)'), evidence: 'estimateAndComplexityRanking' },
  foundationType: { ...choice('Slab-on-grade', 'Crawl space', 'Full basement'), evidence: 'foundationAndBelowGradeLevels' },
  hvacSystem: { ...choice('Forced air (gas)', 'Heat pump', 'Mini-split'), evidence: 'equipmentAndServiceZones' },
  outdoorLiving: { ...choice('None', 'Covered porch', 'Open deck', 'Screened porch', 'Patio'), evidence: 'outdoorPolygonAndAccess' },
  outdoorArea: { ...number(0, 800, 'sq_ft'), evidence: 'outdoorArea' },
  finishOverrides: { type: 'object', evidence: 'finishSchedule' },
  freeformWishes: { type: 'text', evidence: 'interpretedWishesOrUnresolvedInputs' },
  surveyVersion: { type: 'version', evidence: 'migrationProvenance' },
};
const SURVEY_FIELDS = Object.freeze(Object.fromEntries(Object.entries(fields).map(([field, spec]) => [field, Object.freeze(spec)])));
module.exports = { SURVEY_FIELDS };
