'use strict';

const { flooringObservation } = require('./productPrices');
const { findPrice } = require('./unitPrices');
const { getRegionalMultiplier } = require('./regionalMultipliers');

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function qty(value) {
  return Math.max(0, Number(value) || 0);
}

function sumTotal(lineItems = []) {
  return lineItems.reduce((sum, item) => sum + (Number(item?.total) || 0), 0);
}

function kitchenAreaSqFt(rooms = []) {
  return rooms
    .filter((room) => String(room?.canonicalType || '').toLowerCase() === 'kitchen')
    .reduce((sum, room) => sum + qty(room?.areaSqFt), 0);
}

function roomAreaByFinishClass(rooms = [], finishClass) {
  return rooms
    .filter((room) => String(room?.finishClass || '').toLowerCase() === finishClass)
    .reduce((sum, room) => sum + qty(room?.areaSqFt), 0);
}

function getContext(region) {
  if (region && typeof region === 'object') return region;
  return { location: String(region || '') };
}

function calculateLineItem({
  key,
  lineItemName,
  category,
  quantityValue,
  unit,
  materialRate = 0,
  laborRate = 0,
  regionMultiplier = 1.0,
}) {
  const quantity = qty(quantityValue);
  const materialCost = roundMoney(quantity * qty(materialRate) * regionMultiplier);
  const laborCost = roundMoney(quantity * qty(laborRate) * regionMultiplier);
  return {
    key,
    lineItem: lineItemName,
    category,
    quantity: roundMoney(quantity),
    unit,
    materialCost,
    laborCost,
    total: roundMoney(materialCost + laborCost),
    materialUnitPrice: roundMoney(qty(materialRate) * regionMultiplier),
    laborUnitPrice: roundMoney(qty(laborRate) * regionMultiplier),
  };
}







function budgetMultiplier(budgetTier) {
  const tier = String(budgetTier || 'MID').toUpperCase();
  if (tier === 'ENTRY') return 0.9;
  if (tier === 'LUXURY') return 1.18;
  return 1.0;
}

function fixtureMultiplier(finishSpec) {
  const multiplier = Number(finishSpec?.interiorFinishes?.fixtures?.costMultiplier);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1.0;
}

function computeMaterialEstimate(takeoff, finishSpec, region) {
  const raw = takeoff?.raw || {};
  const rooms = Array.isArray(takeoff?.rooms) ? takeoff.rooms : [];
  const context = getContext(region);
  const multiplier = getRegionalMultiplier(context.location || '');
  const variants = { foundation_system: context.foundationType || 'SLAB', hvac_system: context.hvacType || 'FORCED_AIR', outdoor_living: context.outdoorType || 'NONE', water_heater: context.hvacType === 'HEAT_PUMP' ? 'HEAT_PUMP' : null };
  const price = key => {
    const base = findPrice(key, context.estimateLocation);
    const variant = variants[key] && findPrice(`${key}_${String(variants[key]).toUpperCase()}`, context.estimateLocation);
    if (base && base.scope !== 'national' && (!variant || variant.scope === 'national')) return base;
    return variant || base || findPrice(key.replace(/_[A-Z_]+$/, ''), context.estimateLocation);
  };
  const bMul = budgetMultiplier(context.budgetTier || 'MID');
  const fMul = fixtureMultiplier(finishSpec);

  const conditionedArea = qty(raw.conditionedAreaSqFt);
  const footprintArea = qty(raw.footprintAreaSqFt ?? conditionedArea);
  const exteriorWallArea = qty(raw.exteriorWallAreaSqFt);
  const roofArea = qty(raw.estimatedRoofSurfaceAreaSqFt ?? raw.roofPlanAreaSqFt);
  const interiorWallArea = qty(raw.interiorWallAreaSqFt);
  const glazingCount = qty(raw.windowCount);
  const exteriorDoorCount = qty(raw.exteriorDoorCount);
  const garageDoorCount = qty(raw.garageDoorCount);
  const fixtureCount = qty(raw.fixtureTotal);
  const bathroomCount = qty(raw.primaryBathroomCount) + qty(raw.bathroomCount) + qty(raw.powderRoomCount);
  const kitchenCount = qty(raw.kitchenCount);
  const trimLengthFt = qty(raw.baseboardLengthFt ?? conditionedArea * 1.2);

  const claddingPrimaryRate = finishSpec?.exterior?.primaryCladding || { costPerSqft: price('exterior_cladding_primary').material, laborPerSqft: price('exterior_cladding_primary').labor };
  const claddingAccentRate = finishSpec?.exterior?.accentCladding || { costPerSqft: price('exterior_cladding_accent').material, laborPerSqft: price('exterior_cladding_accent').labor };
  const roofRate = finishSpec?.roofing || { costPerSqft: price('roofing').material, laborPerSqft: price('roofing').labor };
  const windowsRate = qty(finishSpec?.windows?.costPerUnit ?? price('exterior_windows').material);
  const flooring = finishSpec?.interiorFinishes?.flooring || {};
  const publicFloorRate = qty(flooring?.public?.costPerSqft ?? price('flooring_public').material);
  const wetFloorRate = qty(flooring?.wet?.costPerSqft ?? price('flooring_wet').material);
  const bedroomFloorRate = qty(flooring?.bedroom?.costPerSqft ?? price('flooring_bedrooms').material);
  const countertopRate = qty(finishSpec?.interiorFinishes?.countertops?.costPerSqft ?? price('kitchen_countertops').material);
  const cabinetRate = qty(finishSpec?.interiorFinishes?.cabinets?.costPerLinFt ?? price('kitchen_cabinets').material);

  // Service/flex/general rooms also need a finish; previously these vanished
  // from the priced flooring while remaining in the reported takeoff area.
  const publicArea = rooms.filter(room => room.conditioned !== false &&
    !['wet', 'sleep', 'garage', 'outdoor'].includes(String(room.finishClass || '').toLowerCase()))
    .reduce((sum, room) => sum + qty(room.areaSqFt), 0);
  const wetArea = roomAreaByFinishClass(rooms, 'wet');
  const sleepArea = roomAreaByFinishClass(rooms, 'sleep');
  const kitchenArea = Math.max(120, kitchenAreaSqFt(rooms));
  const estimatedKitchenPerimeter = Math.max(34, 4 * Math.sqrt(kitchenArea) * 1.08);
  const cabinetLinearFt = kitchenCount > 0 ? roundMoney(estimatedKitchenPerimeter * 0.6) : 0;
  const countertopArea = roundMoney(cabinetLinearFt * 2.0);
  const drivewayArea = garageDoorCount > 0 ? (garageDoorCount >= 2 ? 620 : 360) : 180;

  
  const hvacType = String(context.hvacType || 'FORCED_AIR').toUpperCase();
  const outdoorType = String(context.outdoorType || 'NONE').toUpperCase();
  const outdoorArea = outdoorType === 'NONE' ? 0 : qty(context.outdoorArea);

  const lineItem = input => {
    const row = price(input.key);
    const selected = row.scope !== 'national' ? { ...input, materialRate: row.material, laborRate: row.labor, regionMultiplier: 1 } : input;
    const slot = { flooring_public: 'public', flooring_wet: 'wet', flooring_bedrooms: 'bedroom' }[input.key];
    const observation = slot && row.scope === 'national' ? flooringObservation(flooring[slot]?.material, context.estimateLocation) : null;
    const calculated = calculateLineItem(selected);
    if (observation) {
      // Published product is a representative of the selected material family,
      // not an exact user-selected SKU or an installed assembly quote.
      calculated.materialUnitPrice = observation.price;
      calculated.materialCost = roundMoney(calculated.quantity * observation.price);
      calculated.total = roundMoney(calculated.materialCost + calculated.laborCost);
      calculated.productPrice = { ...observation, matchBasis: 'representative_material_family', laborStatus: 'uncalibrated_allowance' };
    }
    return calculated;
  };
  const lines = [];
  lines.push(lineItem({
    key: 'site_prep_grading',
    lineItemName: 'Site Preparation & Grading',
    category: 'Site & Foundation',
    quantityValue: footprintArea,
    unit: 'sqft',
    materialRate: price('site_prep_grading').material * bMul,
    laborRate: price('site_prep_grading').labor * bMul,
    regionMultiplier: multiplier,
  }));
  const foundationRate = price('foundation_system');
  lines.push(lineItem({
    key: 'foundation_system',
    lineItemName: 'Foundation System',
    category: 'Site & Foundation',
    quantityValue: footprintArea,
    unit: 'sqft',
    materialRate: foundationRate.material * bMul,
    laborRate: foundationRate.labor * bMul,
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'driveway_hardscape',
    lineItemName: 'Driveway & Hardscape',
    category: 'Site & Foundation',
    quantityValue: drivewayArea,
    unit: 'sqft',
    materialRate: price('driveway_hardscape').material,
    laborRate: price('driveway_hardscape').labor,
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'framing',
    lineItemName: 'Framing (Walls + Floors + Roof)',
    category: 'Shell & Envelope',
    quantityValue: conditionedArea,
    unit: 'sqft',
    materialRate: price('framing').material * bMul,
    laborRate: price('framing').labor * bMul,
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'exterior_cladding_primary',
    lineItemName: 'Exterior Cladding - Primary',
    category: 'Shell & Envelope',
    quantityValue: exteriorWallArea * 0.8,
    unit: 'sqft',
    materialRate: qty(claddingPrimaryRate.costPerSqft),
    laborRate: qty(claddingPrimaryRate.laborPerSqft),
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'exterior_cladding_accent',
    lineItemName: 'Exterior Cladding - Accent',
    category: 'Shell & Envelope',
    quantityValue: exteriorWallArea * 0.2,
    unit: 'sqft',
    materialRate: qty(claddingAccentRate.costPerSqft),
    laborRate: qty(claddingAccentRate.laborPerSqft),
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'roofing',
    lineItemName: 'Roofing',
    category: 'Shell & Envelope',
    quantityValue: roofArea,
    unit: 'sqft',
    materialRate: qty(roofRate.costPerSqft),
    laborRate: qty(roofRate.laborPerSqft),
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'exterior_windows',
    lineItemName: 'Exterior Windows',
    category: 'Shell & Envelope',
    quantityValue: glazingCount,
    unit: 'unit',
    materialRate: windowsRate,
    laborRate: price('exterior_windows').labor,
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'exterior_doors',
    lineItemName: 'Exterior Doors',
    category: 'Shell & Envelope',
    quantityValue: exteriorDoorCount,
    unit: 'unit',
    materialRate: price('exterior_doors').material,
    laborRate: price('exterior_doors').labor,
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'garage_doors',
    lineItemName: 'Garage Doors',
    category: 'Shell & Envelope',
    quantityValue: garageDoorCount,
    unit: 'unit',
    materialRate: price('garage_doors').material,
    laborRate: price('garage_doors').labor,
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'insulation_air_sealing',
    lineItemName: 'Insulation & Air Sealing',
    category: 'Shell & Envelope',
    quantityValue: exteriorWallArea + roofArea,
    unit: 'sqft',
    materialRate: price('insulation_air_sealing').material * bMul,
    laborRate: price('insulation_air_sealing').labor * bMul,
    regionMultiplier: multiplier,
  }));
  const hvacRate = price('hvac_system');
  lines.push(lineItem({
    key: 'hvac_system',
    lineItemName: 'HVAC System',
    category: 'Mechanical',
    quantityValue: conditionedArea,
    unit: 'sqft',
    materialRate: hvacRate.material * bMul,
    laborRate: hvacRate.labor * bMul,
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'plumbing_rough_in',
    lineItemName: 'Plumbing Rough-in',
    category: 'Mechanical',
    quantityValue: fixtureCount,
    unit: 'fixture',
    materialRate: price('plumbing_rough_in').material * bMul,
    laborRate: price('plumbing_rough_in').labor * bMul,
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'electrical_rough_in',
    lineItemName: 'Electrical Rough-in + Panel',
    category: 'Mechanical',
    quantityValue: conditionedArea,
    unit: 'sqft',
    materialRate: price('electrical_rough_in').material * bMul,
    laborRate: price('electrical_rough_in').labor * bMul,
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'water_heater',
    lineItemName: 'Water Heater',
    category: 'Mechanical',
    quantityValue: 1,
    unit: 'unit',
    materialRate: price(hvacType === 'HEAT_PUMP' ? 'water_heater_HEAT_PUMP' : 'water_heater').material,
    laborRate: price('water_heater').labor,
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'drywall',
    lineItemName: 'Drywall',
    category: 'Interior Finishes',
    quantityValue: interiorWallArea,
    unit: 'sqft',
    materialRate: price('drywall').material * bMul,
    laborRate: price('drywall').labor * bMul,
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'interior_paint',
    lineItemName: 'Interior Paint',
    category: 'Interior Finishes',
    quantityValue: interiorWallArea * 0.85,
    unit: 'sqft',
    materialRate: price('interior_paint').material * bMul,
    laborRate: price('interior_paint').labor * bMul,
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'flooring_public',
    lineItemName: 'Flooring - Public, Service & Flex Areas',
    category: 'Interior Finishes',
    quantityValue: publicArea,
    unit: 'sqft',
    materialRate: publicFloorRate,
    laborRate: Math.max(2.1, publicFloorRate * 0.42),
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'flooring_wet',
    lineItemName: 'Flooring - Wet Areas',
    category: 'Interior Finishes',
    quantityValue: wetArea,
    unit: 'sqft',
    materialRate: wetFloorRate,
    laborRate: Math.max(3.1, wetFloorRate * 0.46),
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'flooring_bedrooms',
    lineItemName: 'Flooring - Bedrooms',
    category: 'Interior Finishes',
    quantityValue: sleepArea,
    unit: 'sqft',
    materialRate: bedroomFloorRate,
    laborRate: Math.max(1.8, bedroomFloorRate * 0.35),
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'interior_trim_millwork',
    lineItemName: 'Interior Trim & Millwork',
    category: 'Interior Finishes',
    quantityValue: trimLengthFt,
    unit: 'lin ft',
    materialRate: price('interior_trim_millwork').material * bMul,
    laborRate: price('interior_trim_millwork').labor * bMul,
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'kitchen_cabinets',
    lineItemName: 'Kitchen Cabinets',
    category: 'Kitchen & Bath',
    quantityValue: cabinetLinearFt,
    unit: 'lin ft',
    materialRate: cabinetRate,
    laborRate: Math.max(90, cabinetRate * 0.35),
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'kitchen_countertops',
    lineItemName: 'Kitchen Countertops',
    category: 'Kitchen & Bath',
    quantityValue: countertopArea,
    unit: 'sqft',
    materialRate: countertopRate,
    laborRate: Math.max(18, countertopRate * 0.25),
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'kitchen_appliances',
    lineItemName: 'Kitchen Appliances',
    category: 'Kitchen & Bath',
    quantityValue: kitchenCount,
    unit: 'kitchen',
    materialRate: price('kitchen_appliances').material * bMul,
    laborRate: price('kitchen_appliances').labor * bMul,
    regionMultiplier: multiplier,
  }));
  lines.push(lineItem({
    key: 'bathroom_fixtures_finishes',
    lineItemName: 'Bathroom Fixtures & Finishes',
    category: 'Kitchen & Bath',
    quantityValue: bathroomCount,
    unit: 'bath',
    materialRate: price('bathroom_fixtures_finishes').material * bMul * fMul,
    laborRate: price('bathroom_fixtures_finishes').labor * bMul * fMul,
    regionMultiplier: multiplier,
  }));
  const outdoorRate = price('outdoor_living');
  lines.push(lineItem({
    key: 'outdoor_living',
    lineItemName: 'Outdoor Living',
    category: 'Outdoor Living',
    quantityValue: outdoorArea,
    unit: 'sqft',
    materialRate: outdoorRate.material * bMul,
    laborRate: outdoorRate.labor * bMul,
    regionMultiplier: multiplier,
  }));

  const hardCosts = sumTotal(lines);
  lines.push(lineItem({
    key: 'permits_inspections',
    lineItemName: 'Permits & Inspections',
    category: 'Soft Costs',
    quantityValue: hardCosts,
    unit: 'lump',
    materialRate: price('permits_inspections').material,
    laborRate: price('permits_inspections').labor,
    regionMultiplier: 1.0,
  }));
  lines.push(lineItem({
    key: 'design_engineering',
    lineItemName: 'Design & Engineering',
    category: 'Soft Costs',
    quantityValue: hardCosts,
    unit: 'lump',
    materialRate: price('design_engineering').material,
    laborRate: price('design_engineering').labor,
    regionMultiplier: 1.0,
  }));

  return lines.map(item => ({ ...item, rateSource: { ...price(item.key), material: undefined, labor: undefined } }));
}

module.exports = {
  computeMaterialEstimate,
};
