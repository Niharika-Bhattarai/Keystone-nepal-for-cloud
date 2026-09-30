'use strict';

const { computeMaterialEstimate } = require('./materialCostEngine');
const { getRegionalMultiplier } = require('./regionalMultipliers');

function roundCurrency(value) {
  return Math.round(Number(value) || 0);
}

function chooseRateFamily(brief) {
  const key = String(brief?.budgetTier || 'MID').toUpperCase();
  if (key === 'ENTRY' || key === 'LUXURY') return key;
  return 'MID';
}

function toLegacyCategory(categoryLabel) {
  const label = String(categoryLabel || '').toLowerCase();
  if (label.includes('shell')) return 'shell';
  if (label.includes('mechanical')) return 'mechanical';
  if (label.includes('interior')) return 'finishes';
  if (label.includes('kitchen') || label.includes('bath')) return 'millwork';
  if (label.includes('site') || label.includes('outdoor')) return 'site';
  if (label.includes('soft')) return 'softCosts';
  return 'site';
}

function computeEstimateRange(takeoff, brief, finishSpec = null, region = null) {
  const raw = takeoff?.raw || {};
  const rateKey = chooseRateFamily(brief);

  const context = (region && typeof region === 'object')
    ? { ...region }
    : { location: String(region || '') };

  context.location = String(
    context.location || brief?.location || ''
  );
  context.foundationType = String(
    context.foundationType || brief?.foundationType || 'SLAB'
  );
  context.hvacType = String(
    context.hvacType || brief?.hvacType || 'FORCED_AIR'
  );
  context.outdoorType = String(
    context.outdoorType || brief?.outdoorType || 'NONE'
  );
  context.outdoorArea = Number.isFinite(Number(context.outdoorArea))
    ? Number(context.outdoorArea)
    : Number(brief?.outdoorArea || 0);
  context.budgetTier = rateKey;

  const detailLineItems = computeMaterialEstimate(
    takeoff,
    finishSpec || brief?.finishSpec || null,
    context
  );

  const lineItems = detailLineItems.map((item) => {
    const target = roundCurrency(item?.total);
    const low = roundCurrency(target * 0.85);
    const high = roundCurrency(target * 1.2);

    return {
      key: String(item?.key || ''),
      label: String(item?.lineItem || 'Line Item'),
      unit: String(item?.unit || ''),
      quantity: Number(item?.quantity || 0),
      low,
      target,
      high,
      rateSource: item.rateSource,
      productPrice: item.productPrice || null,
      materialUnitPrice: item.materialUnitPrice,
      laborUnitPrice: item.laborUnitPrice,
      notes: `Material ${roundCurrency(item?.materialCost)} + Labor ${roundCurrency(item?.laborCost)}; ${item.rateSource?.scope || 'national'} ${item.rateSource?.status || 'uncalibrated'} allowance (${item.rateSource?.date || 'undated'})${item.productPrice ? `; representative retail material ${item.productPrice.sku} at $${item.productPrice.price}/${item.unit}; labor and accessories unverified; excludes ${item.productPrice.exclusions}` : ''}`,
      category: toLegacyCategory(item?.category),
    };
  });

  const subtotal = lineItems.reduce((totals, item) => ({
    low: totals.low + (item.low || 0),
    target: totals.target + (item.target || 0),
    high: totals.high + (item.high || 0),
  }), { low: 0, target: 0, high: 0 });

  const total = {
    low: subtotal.low,
    target: subtotal.target,
    high: subtotal.high,
  };

  const categoryKeys = ['shell', 'mechanical', 'finishes', 'millwork', 'site', 'softCosts'];
  const categoryTotals = {};
  for (const cat of categoryKeys) {
    const catItems = lineItems.filter((item) => item.category === cat);
    categoryTotals[cat] = {
      low: catItems.reduce((sum, item) => sum + (item.low || 0), 0),
      target: catItems.reduce((sum, item) => sum + (item.target || 0), 0),
      high: catItems.reduce((sum, item) => sum + (item.high || 0), 0),
    };
  }

  return {
    currency: 'USD',
    rateFamily: rateKey,
    regionalMultiplier: getRegionalMultiplier(context.location || ''),
    subtotal,
    lineItems,
    detailLineItems,
    total,
    categoryTotals,
    normalizedCostPerConditionedSqFt: {
      low: raw.conditionedAreaSqFt ? roundCurrency(total.low / raw.conditionedAreaSqFt) : 0,
      target: raw.conditionedAreaSqFt ? roundCurrency(total.target / raw.conditionedAreaSqFt) : 0,
      high: raw.conditionedAreaSqFt ? roundCurrency(total.high / raw.conditionedAreaSqFt) : 0,
    },
  };
}

module.exports = {
  computeEstimateRange,
};

