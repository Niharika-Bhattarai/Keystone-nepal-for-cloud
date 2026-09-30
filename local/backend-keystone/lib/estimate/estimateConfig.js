'use strict';

const RATE_FAMILIES = {
  ENTRY: {
    conditionedShellPerSqFt: { low: 82, target: 92, high: 104 },
    garageShellPerSqFt: { low: 28, target: 35, high: 42 },
    roofingPerSqFt: { low: 9, target: 11, high: 14 },
    exteriorWindowPerSqFt: { low: 34, target: 42, high: 52 },
    exteriorDoorEach: { low: 1800, target: 2400, high: 3200 },
    garageDoorEach: { low: 3600, target: 4500, high: 5600 },
    interiorPartitionSurfacePerSqFt: { low: 4.3, target: 5.25, high: 6.2 },
    flooringPerSqFt: { low: 5.5, target: 7.5, high: 10 },
    wetAreaPremiumPerSqFt: { low: 1.5, target: 2.5, high: 3.5 },
    kitchenAllowanceEach: { low: 19000, target: 26000, high: 36000 },
    bathroomAllowanceEach: { low: 10000, target: 13000, high: 18000 },
    primaryBathroomAllowanceEach: { low: 12000, target: 16000, high: 22000 },
    powderAllowanceEach: { low: 3500, target: 5500, high: 8000 },
    stairAllowanceEach: { low: 7000, target: 9000, high: 12000 },
    contingencyPct: { low: 0.06, target: 0.08, high: 0.1 },
  },
  MID: {
    conditionedShellPerSqFt: { low: 105, target: 118, high: 134 },
    garageShellPerSqFt: { low: 38, target: 46, high: 55 },
    roofingPerSqFt: { low: 11.5, target: 14, high: 17 },
    exteriorWindowPerSqFt: { low: 46, target: 55, high: 66 },
    exteriorDoorEach: { low: 2500, target: 3200, high: 4200 },
    garageDoorEach: { low: 5000, target: 6000, high: 7200 },
    interiorPartitionSurfacePerSqFt: { low: 5.3, target: 6.5, high: 7.9 },
    flooringPerSqFt: { low: 8.5, target: 11, high: 14.5 },
    wetAreaPremiumPerSqFt: { low: 2.5, target: 4, high: 6 },
    kitchenAllowanceEach: { low: 29000, target: 38000, high: 52000 },
    bathroomAllowanceEach: { low: 14000, target: 18000, high: 24000 },
    primaryBathroomAllowanceEach: { low: 18000, target: 23000, high: 32000 },
    powderAllowanceEach: { low: 5000, target: 7500, high: 10500 },
    stairAllowanceEach: { low: 9500, target: 12500, high: 16500 },
    contingencyPct: { low: 0.07, target: 0.09, high: 0.11 },
  },
  LUXURY: {
    conditionedShellPerSqFt: { low: 138, target: 155, high: 178 },
    garageShellPerSqFt: { low: 48, target: 60, high: 74 },
    roofingPerSqFt: { low: 15, target: 20, high: 27 },
    exteriorWindowPerSqFt: { low: 64, target: 78, high: 96 },
    exteriorDoorEach: { low: 3600, target: 4800, high: 6800 },
    garageDoorEach: { low: 7000, target: 8500, high: 10500 },
    interiorPartitionSurfacePerSqFt: { low: 6.9, target: 8.5, high: 10.8 },
    flooringPerSqFt: { low: 13, target: 18, high: 25 },
    wetAreaPremiumPerSqFt: { low: 4, target: 6.5, high: 10 },
    kitchenAllowanceEach: { low: 48000, target: 62000, high: 90000 },
    bathroomAllowanceEach: { low: 22000, target: 29000, high: 42000 },
    primaryBathroomAllowanceEach: { low: 28000, target: 36000, high: 54000 },
    powderAllowanceEach: { low: 9000, target: 12000, high: 16500 },
    stairAllowanceEach: { low: 14000, target: 18000, high: 25000 },
    contingencyPct: { low: 0.08, target: 0.1, high: 0.12 },
  },
};

const ROOF_AREA_MULTIPLIERS = {
  flat: 1.03,
  hip: 1.12,
  gabled: 1.16,
  gable: 1.16,
  side_gable: 1.14,
  craftsman_gable: 1.2,
  cross_gable: 1.25,
};

const WINDOW_WIDTH_BY_ROOM_TYPE = {
  living_room: 5,
  dining_room: 4,
  kitchen: 3.5,
  primary_bedroom: 4,
  bedroom: 3.5,
  guest_bedroom: 3.5,
  study: 3.5,
  library: 3.5,
  gym: 4,
  movie_room: 3,
  gaming_room: 3.5,
  bathroom: 2,
  primary_bathroom: 2.5,
  powder_room: 2,
  laundry: 2.5,
  entry: 3,
  hallway: 2,
  mudroom: 2.5,
  storage: 2,
  garage: 0,
};

const DOOR_WIDTHS_FT = {
  interior: 2.8,
  exterior: 3.2,
  mainEntry: 3.5,
  garageSingle: 8,
  garageDouble: 16,
  openThreshold: 4,
};

// Mechanical systems (per conditioned sqft)
const MECHANICAL_RATES = {
  ENTRY: { hvac: [8, 12, 16], electrical: [10, 14, 18], plumbingPerFixture: [1800, 2400, 3200] },
  MID:   { hvac: [12, 17, 22], electrical: [14, 18, 24], plumbingPerFixture: [2400, 3200, 4200] },
  LUXURY:{ hvac: [18, 25, 34], electrical: [18, 26, 34], plumbingPerFixture: [3400, 4800, 6400] },
};

// Interior finishes (per sqft of conditioned area)
const FINISH_RATES = {
  ENTRY: { drywall: [4.5, 6.0, 7.5], insulation: [3.0, 4.0, 5.5] },
  MID:   { drywall: [6.0, 7.5, 9.0], insulation: [4.0, 5.5, 7.0] },
  LUXURY:{ drywall: [8.0, 10.0, 13.0], insulation: [5.5, 7.5, 10.0] },
};

// Millwork (cabinetry, countertops, appliances)
const MILLWORK_RATES = {
  ENTRY: { kitchenCabinets: [14000, 20000, 28000], bathCabinets: [3500, 5000, 7000], appliances: [6000, 9000, 12000] },
  MID:   { kitchenCabinets: [25000, 38000, 52000], bathCabinets: [6000, 9000, 13000], appliances: [10000, 15000, 22000] },
  LUXURY:{ kitchenCabinets: [45000, 72000, 100000], bathCabinets: [10000, 16000, 24000], appliances: [18000, 30000, 50000] },
};

// Site work (per sqft of building footprint = L1 area)
const SITE_RATES = {
  ENTRY: { foundationPerSqFt: [18, 24, 32] },
  MID:   { foundationPerSqFt: [24, 32, 42] },
  LUXURY:{ foundationPerSqFt: [34, 46, 62] },
};

// Bathroom rates — tiered by type
const BATHROOM_TIERED_RATES = {
  ENTRY: { primary: [14000, 19000, 26000], secondary: [7500, 10500, 14500], powder: [4200, 5800, 8000] },
  MID:   { primary: [22000, 30000, 40000], secondary: [11000, 15500, 21000], powder: [6000, 8500, 12000] },
  LUXURY:{ primary: [38000, 55000, 78000], secondary: [18000, 26000, 36000], powder: [9500, 14000, 20000] },
};

const SOFT_COSTS_PCT = {
  ENTRY: [0.07, 0.08, 0.10],
  MID:   [0.09, 0.10, 0.12],
  LUXURY:[0.10, 0.12, 0.15],
};

const ESTIMATE_VERSION = 'quantity-estimate-geometry-2026-09-27';

module.exports = {
  BATHROOM_TIERED_RATES,
  DOOR_WIDTHS_FT,
  ESTIMATE_VERSION,
  FINISH_RATES,
  MECHANICAL_RATES,
  MILLWORK_RATES,
  RATE_FAMILIES,
  ROOF_AREA_MULTIPLIERS,
  SITE_RATES,
  SOFT_COSTS_PCT,
  WINDOW_WIDTH_BY_ROOM_TYPE,
};
