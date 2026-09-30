'use strict';

const MATERIAL_STYLE_IDS = [
  'craftsman',
  'modern_farmhouse',
  'colonial',
  'contemporary',
  'mediterranean',
];

const STYLE_LABELS = {
  craftsman: 'Craftsman (Wood & Stone)',
  modern_farmhouse: 'Modern Farmhouse (Board & Batten)',
  colonial: 'Traditional Colonial (Brick)',
  contemporary: 'Contemporary Modern (Concrete)',
  mediterranean: 'Mediterranean (Stucco & Tile)',
};

const EXTERIOR_CLADDING_LIBRARY = {
  cedar_lap: { material: 'cedar_lap', label: 'Cedar lap', costPerSqft: 8.5, laborPerSqft: 4.0 },
  board_batten: { material: 'board_batten', label: 'Board & batten', costPerSqft: 7.25, laborPerSqft: 3.75 },
  brick_veneer: { material: 'brick_veneer', label: 'Brick', costPerSqft: 14.5, laborPerSqft: 7.0 },
  stucco_three_coat: { material: 'stucco_three_coat', label: 'Stucco', costPerSqft: 11.0, laborPerSqft: 5.5 },
  concrete_panel: { material: 'concrete_panel', label: 'Concrete panel', costPerSqft: 16.0, laborPerSqft: 8.5 },
  stone_veneer: { material: 'stone_veneer', label: 'Stone', costPerSqft: 22.0, laborPerSqft: 8.0 },
  fiber_cement_lap: { material: 'fiber_cement_lap', label: 'Fiber cement', costPerSqft: 6.75, laborPerSqft: 3.5 },
};

const ROOFING_LIBRARY = {
  asphalt_shingles_3tab: { material: 'asphalt_shingles_3tab', label: 'Asphalt shingles', costPerSqft: 3.5, laborPerSqft: 2.0 },
  asphalt_architectural: { material: 'asphalt_architectural', label: 'Architectural asphalt', costPerSqft: 4.25, laborPerSqft: 2.5 },
  standing_seam_metal: { material: 'standing_seam_metal', label: 'Standing seam metal', costPerSqft: 8.0, laborPerSqft: 4.25 },
  clay_tile: { material: 'clay_tile', label: 'Clay tile', costPerSqft: 12.0, laborPerSqft: 6.0 },
  slate: { material: 'slate', label: 'Slate', costPerSqft: 15.0, laborPerSqft: 8.0 },
  flat_membrane_tpo: { material: 'flat_membrane_tpo', label: 'Flat membrane', costPerSqft: 5.5, laborPerSqft: 3.0 },
};

const COUNTERTOP_LIBRARY = {
  laminate: { material: 'laminate', label: 'Laminate', costPerSqft: 28.0 },
  butcher_block: { material: 'butcher_block', label: 'Butcher block', costPerSqft: 42.0 },
  concrete: { material: 'concrete', label: 'Concrete', costPerSqft: 58.0 },
  granite: { material: 'granite', label: 'Granite', costPerSqft: 65.0 },
  quartz: { material: 'quartz', label: 'Quartz', costPerSqft: 72.0 },
  marble: { material: 'marble', label: 'Marble', costPerSqft: 95.0 },
};

const FLOORING_PUBLIC_LIBRARY = {
  hardwood: { material: 'hardwood', label: 'Hardwood', costPerSqft: 12.5 },
  engineered_hardwood: { material: 'engineered_hardwood', label: 'Engineered hardwood', costPerSqft: 8.0 },
  lvp: { material: 'lvp', label: 'LVP', costPerSqft: 5.5 },
  tile: { material: 'tile', label: 'Tile', costPerSqft: 9.5 },
  polished_concrete: { material: 'polished_concrete', label: 'Polished concrete', costPerSqft: 6.5 },
};

const CABINET_GRADE_LIBRARY = {
  builder_stock: { grade: 'builder_stock', label: 'Builder stock', costPerLinFt: 140.0 },
  semi_custom: { grade: 'semi_custom', label: 'Semi-custom', costPerLinFt: 280.0 },
  full_custom: { grade: 'full_custom', label: 'Full custom', costPerLinFt: 480.0 },
};

const FIXTURE_GRADE_LIBRARY = {
  builder: { grade: 'builder', label: 'Builder', costMultiplier: 0.9 },
  mid: { grade: 'mid', label: 'Mid-grade', costMultiplier: 1.0 },
  premium: { grade: 'premium', label: 'Premium', costMultiplier: 1.2 },
  luxury: { grade: 'luxury', label: 'Luxury', costMultiplier: 1.45 },
};

const MATERIAL_SPECS = {
  craftsman: {
    styleId: 'craftsman',
    styleLabel: STYLE_LABELS.craftsman,
    exterior: {
      primaryCladding: EXTERIOR_CLADDING_LIBRARY.cedar_lap,
      accentCladding: EXTERIOR_CLADDING_LIBRARY.stone_veneer,
      trim: { material: 'painted_wood', costPerLinFt: 3.5, laborPerLinFt: 2.0 },
    },
    roofing: ROOFING_LIBRARY.asphalt_architectural,
    windows: {
      frameType: 'wood_clad',
      costPerUnit: 650,
      mullionPattern: 'divided_lite_top',
    },
    interiorFinishes: {
      flooring: {
        public: FLOORING_PUBLIC_LIBRARY.engineered_hardwood,
        wet: { material: 'porcelain_tile', label: 'Porcelain tile', costPerSqft: 10.0 },
        bedroom: { material: 'carpet', label: 'Carpet', costPerSqft: 4.5 },
        garage: { material: 'sealed_concrete', label: 'Sealed concrete', costPerSqft: 3.0 },
      },
      countertops: COUNTERTOP_LIBRARY.granite,
      cabinets: CABINET_GRADE_LIBRARY.semi_custom,
      fixtures: FIXTURE_GRADE_LIBRARY.mid,
    },
    entryExpression: {
      porchType: 'covered_with_columns',
      columnStyle: 'tapered_craftsman',
    },
  },
  modern_farmhouse: {
    styleId: 'modern_farmhouse',
    styleLabel: STYLE_LABELS.modern_farmhouse,
    exterior: {
      primaryCladding: EXTERIOR_CLADDING_LIBRARY.board_batten,
      accentCladding: EXTERIOR_CLADDING_LIBRARY.fiber_cement_lap,
      trim: { material: 'painted_trim_composite', costPerLinFt: 3.0, laborPerLinFt: 1.9 },
    },
    roofing: ROOFING_LIBRARY.standing_seam_metal,
    windows: {
      frameType: 'fiberglass_black',
      costPerUnit: 740,
      mullionPattern: 'none',
    },
    interiorFinishes: {
      flooring: {
        public: FLOORING_PUBLIC_LIBRARY.hardwood,
        wet: { material: 'porcelain_tile', label: 'Porcelain tile', costPerSqft: 10.5 },
        bedroom: { material: 'carpet', label: 'Carpet', costPerSqft: 4.25 },
        garage: { material: 'sealed_concrete', label: 'Sealed concrete', costPerSqft: 3.0 },
      },
      countertops: COUNTERTOP_LIBRARY.quartz,
      cabinets: CABINET_GRADE_LIBRARY.semi_custom,
      fixtures: FIXTURE_GRADE_LIBRARY.premium,
    },
    entryExpression: {
      porchType: 'covered_linear',
      columnStyle: 'square_modern_farm',
    },
  },
  colonial: {
    styleId: 'colonial',
    styleLabel: STYLE_LABELS.colonial,
    exterior: {
      primaryCladding: EXTERIOR_CLADDING_LIBRARY.brick_veneer,
      accentCladding: EXTERIOR_CLADDING_LIBRARY.fiber_cement_lap,
      trim: { material: 'painted_wood', costPerLinFt: 3.25, laborPerLinFt: 2.0 },
    },
    roofing: ROOFING_LIBRARY.asphalt_architectural,
    windows: {
      frameType: 'vinyl',
      costPerUnit: 520,
      mullionPattern: 'six_over_six',
    },
    interiorFinishes: {
      flooring: {
        public: FLOORING_PUBLIC_LIBRARY.engineered_hardwood,
        wet: { material: 'ceramic_tile', label: 'Ceramic tile', costPerSqft: 8.0 },
        bedroom: { material: 'carpet', label: 'Carpet', costPerSqft: 4.0 },
        garage: { material: 'sealed_concrete', label: 'Sealed concrete', costPerSqft: 2.8 },
      },
      countertops: COUNTERTOP_LIBRARY.laminate,
      cabinets: CABINET_GRADE_LIBRARY.builder_stock,
      fixtures: FIXTURE_GRADE_LIBRARY.builder,
    },
    entryExpression: {
      porchType: 'columned_entry',
      columnStyle: 'fluted_classical',
    },
  },
  contemporary: {
    styleId: 'contemporary',
    styleLabel: STYLE_LABELS.contemporary,
    exterior: {
      primaryCladding: EXTERIOR_CLADDING_LIBRARY.concrete_panel,
      accentCladding: EXTERIOR_CLADDING_LIBRARY.stucco_three_coat,
      trim: { material: 'anodized_aluminum', costPerLinFt: 4.2, laborPerLinFt: 2.4 },
    },
    roofing: ROOFING_LIBRARY.flat_membrane_tpo,
    windows: {
      frameType: 'aluminum_thermally_broken',
      costPerUnit: 860,
      mullionPattern: 'minimal',
    },
    interiorFinishes: {
      flooring: {
        public: FLOORING_PUBLIC_LIBRARY.polished_concrete,
        wet: { material: 'large_format_tile', label: 'Large format tile', costPerSqft: 11.5 },
        bedroom: { material: 'engineered_hardwood', label: 'Engineered hardwood', costPerSqft: 8.0 },
        garage: { material: 'epoxy_concrete', label: 'Epoxy concrete', costPerSqft: 4.8 },
      },
      countertops: COUNTERTOP_LIBRARY.concrete,
      cabinets: CABINET_GRADE_LIBRARY.full_custom,
      fixtures: FIXTURE_GRADE_LIBRARY.premium,
    },
    entryExpression: {
      porchType: 'recessed_entry',
      columnStyle: 'none',
    },
  },
  mediterranean: {
    styleId: 'mediterranean',
    styleLabel: STYLE_LABELS.mediterranean,
    exterior: {
      primaryCladding: EXTERIOR_CLADDING_LIBRARY.stucco_three_coat,
      accentCladding: EXTERIOR_CLADDING_LIBRARY.stone_veneer,
      trim: { material: 'decorative_stucco_trim', costPerLinFt: 3.75, laborPerLinFt: 2.2 },
    },
    roofing: ROOFING_LIBRARY.clay_tile,
    windows: {
      frameType: 'wood_clad',
      costPerUnit: 770,
      mullionPattern: 'arched_mixed',
    },
    interiorFinishes: {
      flooring: {
        public: FLOORING_PUBLIC_LIBRARY.tile,
        wet: { material: 'natural_stone_tile', label: 'Natural stone tile', costPerSqft: 13.0 },
        bedroom: { material: 'carpet', label: 'Carpet', costPerSqft: 4.4 },
        garage: { material: 'sealed_concrete', label: 'Sealed concrete', costPerSqft: 3.0 },
      },
      countertops: COUNTERTOP_LIBRARY.marble,
      cabinets: CABINET_GRADE_LIBRARY.semi_custom,
      fixtures: FIXTURE_GRADE_LIBRARY.luxury,
    },
    entryExpression: {
      porchType: 'arched_portico',
      columnStyle: 'stucco_arch',
    },
  },
};

const DEFAULT_STYLE_BY_BUDGET_TIER = {
  ENTRY: 'colonial',
  MID: 'craftsman',
  LUXURY: 'contemporary',
};

const STYLE_ALIASES = {
  craftsman: 'craftsman',
  farmhouse: 'modern_farmhouse',
  modern_farmhouse: 'modern_farmhouse',
  colonial: 'colonial',
  traditional: 'colonial',
  contemporary: 'contemporary',
  modern: 'contemporary',
  mediterranean: 'mediterranean',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeBudgetTier(value) {
  const s = String(value || '').toLowerCase();
  if (s.includes('entry') || s.includes('120')) return 'ENTRY';
  if (s.includes('luxury') || s.includes('350')) return 'LUXURY';
  return 'MID';
}

function resolveStyleId(styleIdOrLabel) {
  const raw = String(styleIdOrLabel || '').trim().toLowerCase();
  if (!raw) return null;
  if (MATERIAL_STYLE_IDS.includes(raw)) return raw;
  for (const [alias, id] of Object.entries(STYLE_ALIASES)) {
    if (raw === alias || raw.includes(alias)) return id;
  }
  if (raw.includes('board') && raw.includes('batten')) return 'modern_farmhouse';
  if (raw.includes('brick')) return 'colonial';
  if (raw.includes('stucco') && raw.includes('tile')) return 'mediterranean';
  if (raw.includes('concrete')) return 'contemporary';
  return null;
}

function pickByLabel(rawValue, library, aliases = {}) {
  const text = String(rawValue || '').trim().toLowerCase();
  if (!text) return null;
  for (const [alias, key] of Object.entries(aliases)) {
    if (text === alias || text.includes(alias)) return library[key] ? clone(library[key]) : null;
  }
  for (const item of Object.values(library)) {
    const label = String(item?.label || item?.material || item?.grade || '').toLowerCase();
    const id = String(item?.material || item?.grade || '').toLowerCase();
    if (text === id || text === label || label.includes(text) || text.includes(label)) return clone(item);
  }
  return null;
}

function applyFinishOverrides(baseSpec, finishOverrides = {}) {
  const spec = clone(baseSpec || getDefaultSpec('MID'));
  if (!finishOverrides || typeof finishOverrides !== 'object') return spec;

  const siding = pickByLabel(
    finishOverrides.exteriorSiding || finishOverrides.siding || finishOverrides.exteriorCladding,
    EXTERIOR_CLADDING_LIBRARY,
    {
      'cedar lap': 'cedar_lap',
      cedar: 'cedar_lap',
      'board & batten': 'board_batten',
      'board and batten': 'board_batten',
      brick: 'brick_veneer',
      stucco: 'stucco_three_coat',
      'concrete panel': 'concrete_panel',
      stone: 'stone_veneer',
      'fiber cement': 'fiber_cement_lap',
    }
  );
  if (siding) spec.exterior.primaryCladding = siding;

  const roofing = pickByLabel(
    finishOverrides.roofMaterial || finishOverrides.roofing,
    ROOFING_LIBRARY,
    {
      'asphalt shingles': 'asphalt_shingles_3tab',
      'architectural asphalt': 'asphalt_architectural',
      'standing seam metal': 'standing_seam_metal',
      'clay tile': 'clay_tile',
      slate: 'slate',
      'flat membrane': 'flat_membrane_tpo',
      tpo: 'flat_membrane_tpo',
    }
  );
  if (roofing) spec.roofing = roofing;

  const countertop = pickByLabel(
    finishOverrides.countertop || finishOverrides.countertops,
    COUNTERTOP_LIBRARY,
    {
      laminate: 'laminate',
      granite: 'granite',
      quartz: 'quartz',
      marble: 'marble',
      'butcher block': 'butcher_block',
      concrete: 'concrete',
    }
  );
  if (countertop) spec.interiorFinishes.countertops = countertop;

  const flooringPublic = pickByLabel(
    finishOverrides.flooringPublic || finishOverrides.publicFlooring || finishOverrides.flooring,
    FLOORING_PUBLIC_LIBRARY,
    {
      hardwood: 'hardwood',
      'engineered hardwood': 'engineered_hardwood',
      lvp: 'lvp',
      tile: 'tile',
      'polished concrete': 'polished_concrete',
    }
  );
  if (flooringPublic) spec.interiorFinishes.flooring.public = flooringPublic;

  const cabinetGrade = pickByLabel(
    finishOverrides.cabinetGrade || finishOverrides.cabinets,
    CABINET_GRADE_LIBRARY,
    {
      builder: 'builder_stock',
      'builder stock': 'builder_stock',
      'semi-custom': 'semi_custom',
      'semi custom': 'semi_custom',
      'full-custom': 'full_custom',
      'full custom': 'full_custom',
    }
  );
  if (cabinetGrade) spec.interiorFinishes.cabinets = cabinetGrade;

  const fixtureGrade = pickByLabel(
    finishOverrides.fixtureGrade || finishOverrides.fixtures,
    FIXTURE_GRADE_LIBRARY,
    {
      builder: 'builder',
      'mid-grade': 'mid',
      mid: 'mid',
      premium: 'premium',
      luxury: 'luxury',
    }
  );
  if (fixtureGrade) spec.interiorFinishes.fixtures = fixtureGrade;

  return spec;
}

function getMaterialSpec(styleIdOrLabel) {
  const styleId = resolveStyleId(styleIdOrLabel) || DEFAULT_STYLE_BY_BUDGET_TIER.MID;
  const spec = MATERIAL_SPECS[styleId] || MATERIAL_SPECS[DEFAULT_STYLE_BY_BUDGET_TIER.MID];
  return clone(spec);
}

function getDefaultSpec(budgetTier) {
  const budgetKey = normalizeBudgetTier(budgetTier);
  const styleId = DEFAULT_STYLE_BY_BUDGET_TIER[budgetKey] || DEFAULT_STYLE_BY_BUDGET_TIER.MID;
  return getMaterialSpec(styleId);
}

module.exports = {
  MATERIAL_STYLE_IDS,
  MATERIAL_SPECS,
  getMaterialSpec,
  getDefaultSpec,
  resolveStyleId,
  normalizeBudgetTier,
  applyFinishOverrides,
};
