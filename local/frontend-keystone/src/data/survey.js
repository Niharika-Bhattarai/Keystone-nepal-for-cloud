// Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬ SURVEY FORM Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬
import { normalizeFeatureSelections } from '../lib/featureRooms.js';

export const STYLE_FINISH_DEFAULTS = {
    'Craftsman (Wood & Stone)': {
        exteriorSiding: 'Cedar lap',
        roofMaterial: 'Architectural asphalt',
        countertop: 'Granite',
        flooringPublic: 'Engineered hardwood',
        cabinetGrade: 'Semi-custom',
        fixtureGrade: 'Mid-grade',
    },
    'Modern Farmhouse (Board & Batten)': {
        exteriorSiding: 'Board & batten',
        roofMaterial: 'Standing seam metal',
        countertop: 'Quartz',
        flooringPublic: 'Hardwood',
        cabinetGrade: 'Semi-custom',
        fixtureGrade: 'Premium',
    },
    'Traditional Colonial (Brick)': {
        exteriorSiding: 'Brick',
        roofMaterial: 'Architectural asphalt',
        countertop: 'Laminate',
        flooringPublic: 'Engineered hardwood',
        cabinetGrade: 'Builder stock',
        fixtureGrade: 'Builder',
    },
    'Contemporary Modern (Concrete)': {
        exteriorSiding: 'Concrete panel',
        roofMaterial: 'Flat membrane',
        countertop: 'Concrete',
        flooringPublic: 'Polished concrete',
        cabinetGrade: 'Full custom',
        fixtureGrade: 'Premium',
    },
    'Mediterranean (Stucco & Tile)': {
        exteriorSiding: 'Stucco',
        roofMaterial: 'Clay tile',
        countertop: 'Marble',
        flooringPublic: 'Tile',
        cabinetGrade: 'Semi-custom',
        fixtureGrade: 'Luxury',
    },
};

export const FINISH_OVERRIDE_OPTIONS = {
    exteriorSiding: ['Cedar lap', 'Board & batten', 'Brick', 'Stucco', 'Concrete panel', 'Stone', 'Fiber cement'],
    roofMaterial: ['Asphalt shingles', 'Architectural asphalt', 'Standing seam metal', 'Clay tile', 'Slate', 'Flat membrane'],
    countertop: ['Laminate', 'Granite', 'Quartz', 'Marble', 'Butcher block', 'Concrete'],
    flooringPublic: ['Hardwood', 'Engineered hardwood', 'LVP', 'Tile', 'Polished concrete'],
    cabinetGrade: ['Builder stock', 'Semi-custom', 'Full custom'],
    fixtureGrade: ['Builder', 'Mid-grade', 'Premium', 'Luxury'],
};

export const SURVEY_STEPS = [
    { id:'basics',    title:'Basic Requirements',   subtitle:'Size, stories, and rooms',           fields:['totalArea','stories','bedrooms','bathrooms','privateBaths'] },
    { id:'structure', title:'Structure & Site',      subtitle:'Garage, shape, and orientation',     fields:['garage','shape','frontFacing','lotContext','lotWidth','lotDepth'] },
    { id:'lifestyle', title:'Lifestyle & Layout',    subtitle:'How you live in the home',           fields:['openConcept','masterLocation','kitchenPlacement','laundryLocation','ceilingHeight'] },
    { id:'style',     title:'Style & Materials',     subtitle:'Aesthetic and finishes',             fields:['materials','indoorOutdoor','naturalLight'] },
    { id:'extras',    title:'Special Features',      subtitle:'Additional rooms and preferences',   fields:['features','accessibilityNeeds','budgetTier','foundationType','hvacSystem','outdoorLiving','outdoorArea','freeformWishes'] },
];

export const DEFAULT_FORM_DATA = {
    location:'', totalArea:'2400', stories:'2 Stories', bedrooms:'3 Bed', bathrooms:'3 Bath',
    privateBaths:'1',
    bedroomConfigs: null,
    shape:'Rectangular', garage:'1 Car Garage', materials:'Craftsman (Wood & Stone)',
    openConcept:'Open Concept (Combined)', masterLocation:'Level 2 (Upper)', kitchenPlacement:'Rear of House',
    features:'', frontFacing:'South', lotContext:'Suburban standard lot',
    laundryLocation:'Level 1 (near garage/mud)', ceilingHeight:'Standard (9 ft)',
    indoorOutdoor:'Moderate (some connection)', naturalLight:'Balanced windows',
    accessibilityNeeds:'None', budgetTier:'Mid ($200-300/sqft)',
    foundationType:'Slab-on-grade', hvacSystem:'Forced air (gas)', outdoorLiving:'None', outdoorArea:'0',
    lotWidth:'', lotDepth:'',
    finishOverrides:{},
    freeformWishes:'',
};

// The old picker offered these aliases as two separate rooms. Migrate that
// picker combination while preserving explicit counts such as "2 Study".
export function normalizeSurveyFeatures(value = '', sourceVersion = null) {
    return normalizeFeatureSelections(value, sourceVersion);
}
