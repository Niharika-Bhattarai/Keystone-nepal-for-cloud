'use strict';
// Code constants for the residential RC frame calculation, each with the source
// it was read from. Page numbers are physical PDF pages of the supplied files
// (not the printed folio). Values whose governing standard was NOT supplied in
// the repo (IS 456, IS 875) are marked status 'not_supplied_verify': they are the
// well-known clause values, shown so an engineer can check them against a copy.
const path=require('node:path');

const SOURCES={
  'nbc105-2025':{title:'NBC 105:2025 Seismic Design of Buildings in Nepal',file:'Codes/NBC 2025.pdf',
    sha256:'2ecc22003a3a295ac86e313dc024d8c5d8a92aff679eb7a921504b4c5d1d0550',status:'governing_seismic_code_project_adoption_review_required'},
  'nbc205-2024':{title:'NBC 205:2024 Ready-to-use detailing guideline for low-rise RC buildings without masonry infill',
    file:'Codes/NBC_205_READY-TO-USE_DETAILING_GUIDELINE_FOR-signed.pdf',
    sha256:'5285079da891a8b1082540978ef115776ac1f300d1cf26a450e94158280ff8c0',status:'eligibility_and_adoption_review'},
  'is1893-2016':{title:'IS 1893 (Part 1):2016 Criteria for earthquake resistant design of structures (scanned copy)',
    file:'Codes/Seismic design code/kupdf.net_is-1893-2016.pdf',
    sha256:'1dc6ee670ebabaf233a29bb995d974e74b8763e5bca6083c575c395c515f1a59',status:'cross_check_only_nbc105_governs'},
  'is456-2000':{title:'IS 456:2000 Plain and reinforced concrete (referred to by NBC 205 cl 6.1(g), 7.3)',file:null,sha256:null,
    status:'not_supplied_verify'},
  'is875-1987':{title:'IS 875 (Parts 1 & 2):1987 Dead and imposed loads (NBC 102/103 not supplied)',file:null,sha256:null,
    status:'not_supplied_verify'},
};
const ref=(source,clause,page)=>({source,clause,page:page??null});

const NBC105={
  // Table 4-1 (p44). Ta is taken as zero for the Equivalent Static Method (note 1).
  spectral:{A:{Ta:0.1,Tc:0.5,Td:4.0,alpha:2.5},B:{Ta:0.1,Tc:0.7,Td:4.0,alpha:2.5},
    C:{Ta:0.1,Tc:1.0,Td:4.0,alpha:2.5},D:{Ta:0.5,Tc:2.0,Td:5.0,alpha:2.25}},
  spectralRef:ref('nbc105-2025','Table 4-1, eq 4.1(2)',44),
  // Table 4-3 (p46): Kathmandu valley sites assigned soil type D by default.
  softSoilWards:[
    ['Kageswori Manahara',[8,9]],['Kathmandu Metropolitan',[1,2,5,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,32]],
    ['Kirtipur',[10]],['Nagarjun',[2,4,9]],['Tarakeswor',[4,8,9,10,11]],['Tokha',[4,5,6,7,8,9,10,11]],
    ['Lalitpur Metropolitan',[1,2,3,4,6,7,8,9,10,11,12,13,16,17,19,20]],['Mahalaxmi',[1,2,3,4,5,7]],
    ['Bhaktapur','all'],['Changunarayan',[2]],['Madhyapur Thimi','all'],['Suryabinayak',[2,3,5,6]]],
  softSoilRef:ref('nbc105-2025','4.1.3.3, Table 4-3',46),
  importance:{I:1.0,II:1.25,III:1.5},importanceRef:ref('nbc105-2025','4.1.5, Table 4-4',48),
  slsFactor:0.20,slsRef:ref('nbc105-2025','4.2, eq 4.2(1)',49),
  kt:{rcFrame:0.075},periodRef:ref('nbc105-2025','5.1.2, eq 5.1(2)',51),
  periodAmplification:1.25,periodAmpRef:ref('nbc105-2025','5.1.3',52),
  rayleighRef:ref('nbc105-2025','5.1.1, eq 5.1(1); lesser of the two adopted (5.1)',50),
  seismicLiveFactor:{storage:0.6,other:0.3,roof:0},seismicLiveRef:ref('nbc105-2025','5.2, Table 5-1',52),
  rcFrame:{Rmu:4,omegaU:1.5,omegaS:1.25},systemRef:ref('nbc105-2025','5.3, Table 5-2 (RC moment resisting frame)',54),
  crackedULS:{beam:0.35,column:0.70},crackedSLS:{beam:0.70,column:0.90},crackedRef:ref('nbc105-2025','3.4, Table 3-1',39),
  driftLimit:{uls:0.025,sls:0.006},driftRef:ref('nbc105-2025','5.5.3',59),
  deflectionUlsRef:ref('nbc105-2025','5.5.1.1 (ULS deflection × Rμ)',58),
  kd:[1.0,0.97,0.94,0.91,0.88,0.85],kdRef:ref('nbc105-2025','6.5, Table 6-1',61),
  accidentalEccentricity:0.05,eccRef:ref('nbc105-2025','5.6',59),
  combosLSM:ref('nbc105-2025','3.6.1, eq 3.6(1)',39),
  combosWSM:ref('nbc105-2025','3.7, eq 3.7(1)',41),
  bearingIncrease:0.5,bearingRef:ref('nbc105-2025','3.8',41),
  esmRef:ref('nbc105-2025','3.2.1',37),
  cdRef:ref('nbc105-2025','6.1.1 eq 6.1(1); 6.1.2 eq 6.1(2)',60),
  baseShearRef:ref('nbc105-2025','6.2, eq 6.2(1)',60),
  distributionRef:ref('nbc105-2025','6.3, eq 6.3(1)',61),
  elasticRef:ref('nbc105-2025','4.1.1, eq 4.1(1)',42),
  zoneRef:ref('nbc105-2025','4.1.4; Annex C Table C-1',46),
  irregularity:{softStorey:0.70,softStorey3:0.80,weakStorey:0.80,mass:1.5,geometric:1.30,torsion:1.5,extremeTorsion:2.5,
    reentrant:0.15,diaphragmOpening:0.5},
  verticalIrregRef:ref('nbc105-2025','5.4.1',55),planIrregRef:ref('nbc105-2025','5.4.2',56),
  separationRef:ref('nbc105-2025','5.5.2',58),
  foundationTieRef:ref('nbc105-2025','2.2.5 B',34),stabilityRef:ref('nbc105-2025','2.1.3.1 (2)',31),
  diaphragmRef:ref('nbc105-2025','2.2.4 E',34),floatingColumnRef:ref('nbc105-2025','5.3.6',53),
};

// Annex A (ductile RC detailing), NBC 105:2025.
const ANNEX_A={
  materials:ref('nbc105-2025','Annex A 2.1 (M20 minimum; M25 above 12 m)',80),
  beamDims:ref('nbc105-2025','Annex A 4.1.1',82),beamLong:ref('nbc105-2025','Annex A 4.1.2, eq 4.1.2',82),
  beamShear:ref('nbc105-2025','Annex A 4.1.3 (e) eq 4.1.3.1–4.1.3.4',84),beamLinks:ref('nbc105-2025','Annex A 4.1.3 (f)–(h)',85),
  colDims:ref('nbc105-2025','Annex A 4.2.1',86),colLong:ref('nbc105-2025','Annex A 4.2.2',87),
  colShear:ref('nbc105-2025','Annex A 4.2.3 (f), eq 4.2.3.1–4.2.3.2',88),
  confinement:ref('nbc105-2025','Annex A 4.3, eq 4.3.1–4.3.3',89),
  joint:ref('nbc105-2025','Annex A 4.4.1, eq 4.4.1.1–4.4.1.3',92),
  anchorage:ref('nbc105-2025','Annex A 4.4.2, eq 4.4.2(a)/(b)',94),
  devLength:ref('nbc105-2025','Annex A 4.4.3, Table 4.3',96),
  scwb:ref('nbc105-2025','Annex A 4.4.4, eq 4.4.4',96),
  laps:ref('nbc105-2025','Annex A 4.5.1',96),
  // Table 4.3 ld/φ, rows Fe250/415/500, columns M20..M40.
  ldPerDia:{250:[45,39,36,32,29],415:[47,40,38,33,30],500:[57,49,45,40,36]},
};

const NBC205={
  restrictions:ref('nbc205-2024','4.2, Figure 4-1',15),
  restrictionsText:ref('nbc205-2024','4.2 (a)–(m)',16),
  sbcTable:ref('nbc205-2024','3.5, Table 3-2',14),
  basis:ref('nbc205-2024','7.2.1, 7.4',24),
  softSoilMunicipalities:ref('nbc205-2024','6.2.1, Table 6-1',22),
};

const IS1893={
  periodInfill:ref('is1893-2016','7.6.2 (c) Ta = 0.09h/√d',24),
  periodBare:ref('is1893-2016','7.6.2 (a) Ta = 0.075h^0.75',24),
  spectrum:ref('is1893-2016','6.4.2, Fig 2(a) Sa/g',12),
  seismicLive:ref('is1893-2016','7.3.1, Table 8 (25 % up to 3 kN/m²)',22),
};

const IS456={
  ec:ref('is456-2000','6.2.3.1 Ec = 5000√fck'),
  flexure:ref('is456-2000','38.1, Annex G-1.1 (b)'),
  muLim:ref('is456-2000','Annex G-1.1 (c), 38.1 xu,max/d'),
  shear:ref('is456-2000','40.1–40.4, Table 19 (τc), Table 20 (τc,max)'),
  axial:ref('is456-2000','39.3, 39.6 (biaxial), 25.4 (minimum eccentricity)'),
  coefficients:ref('is456-2000','22.5, Tables 12–13 (moment and shear coefficients)'),
  slab:ref('is456-2000','24.1, 26.5.2; span/depth 23.2.1'),
  footing:ref('is456-2000','34.2.4 (one-way and punching shear 31.6.3)'),
  combos:ref('is456-2000','Table 18 (1.5 DL + 1.5 LL)'),
  minSteel:ref('is456-2000','26.5.1.1 (a) 0.85 bd/fy'),
};

const IS875={
  unitWeights:ref('is875-1987','Part 1 — RC 25 kN/m³, brick masonry 18.85 kN/m³, cement plaster 20.4 kN/m³'),
  liveLoads:ref('is875-1987','Part 2 Table 1 — residential rooms 2.0, stairs/corridors/balconies 3.0, accessible roof 1.5, inaccessible roof 0.75 kN/m²'),
};

let annexC=null;
function annexCRows(){
  if(!annexC)annexC=require(path.join(__dirname,'data','nbc105-2025-annex-c.json'));
  return annexC.rows.map(([sn,district,localUnit,pga,page])=>({sn,district,localUnit,pga,page}));
}

module.exports={SOURCES,NBC105,ANNEX_A,NBC205,IS1893,IS456,IS875,annexCRows,ref};
