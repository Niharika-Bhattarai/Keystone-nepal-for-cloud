#!/usr/bin/env node
'use strict';
// Survey case matrix. Builds each survey with the studio's own form builder
// (frontend-keystone/src/studio/NepalBrief.jsx, bundled on the fly) and sends it
// through the same API handler the studio calls: review, JSON, A3 drawings, DXF
// and the structural calculation. Writes a Markdown table of the outcomes.
//   node tools/nepal-survey-matrix.cjs [case-prefix] [--out report.md]
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {spawnSync}=require('node:child_process');
Object.assign(process.env,{KEYSTONE_RUNTIME:'local',NEPAL_LOCAL_STUDIO:'1',ACCOUNTS_STORE:'memory',ACCOUNTS_AUTH:'insecure-dev'});
const ROOT=path.resolve(__dirname,'..'),B=path.join(ROOT,'backend-keystone')+'/',FE=path.join(ROOT,'frontend-keystone');
function loadBuilder(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nepal-matrix-'));
  fs.writeFileSync(path.join(dir,'entry.mjs'),`export { buildNepalSurvey } from ${JSON.stringify(path.join(FE,'src/studio/NepalBrief.jsx'))};\nexport * from ${JSON.stringify(path.join(FE,'src/studio/plotSketch.js'))};\n`);
  const r=spawnSync(process.execPath,[path.join(FE,'node_modules/rolldown/bin/cli.mjs'),path.join(dir,'entry.mjs'),'--format','cjs','--dir',path.join(dir,'out'),
    '--external','react','--external','react-dom','--external','three','--external','@react-three/fiber','--external','@react-three/drei'],{encoding:'utf8',cwd:FE});
  if(r.status!==0)throw new Error('Could not bundle the survey builder: '+(r.stderr||r.stdout).slice(0,500));
  module.paths.unshift(path.join(FE,'node_modules'));process.env.NODE_PATH=path.join(FE,'node_modules');require('node:module').Module._initPaths();
  return require(path.join(dir,'out','entry.js'));
}
const {buildNepalSurvey,segmentsToVertices,corners}=loadBuilder();
const handler=require(B+'api/nepal_concepts.js');
const {preflightNepal}=require(B+'lib/nepal/preflight');
const {buildReviewCase}=require(B+'lib/nepal/reviewSheet');
const INITIAL={
  municipality:'Kathmandu Metropolitan City',ward:'10',shape:'rectangle',width:'11.25',depth:'11.25',
  declaredArea:'',areaUnit:'aana',north:'90',northEvidence:'survey drawing',roadEdge:'0',roadWidth:'4',
  surveyRevision:'',terrain:'unknown',plinth:'unknown',floodContext:'unknown',roadAccess:'unknown',
  balconies:'',laundry:'unspecified',roofUse:'unspecified',accessibility:'none',utilities:'unspecified',
  boundaryNeighbors:['road','unknown','unknown','unknown'],boundaryHeights:['','','',''],boundarySetbacks:['','','',''],
  boundaryWindows:['unknown','unknown','unknown','unknown'],
  storeys:'2.5',floorHeight:'3',partialArea:'50',bikes:'2',cars:'0',stair:'halfTurnLanding',groundReservoirLitres:'8000',
  rentFloors:false,rentalFloorCount:'1',rentalStairSide:'auto',primaryWardrobe:'standard',otherBedroomWardrobes:false,
  levelOccupancy:['owner','owner','owner','owner'],levelBedrooms:['0','3','0','0'],levelBathrooms:['1','1','0','0'],
  levelKitchens:['1','0','0','0'],levelLivingRooms:['1','0','0','0'],levelSeparateDining:[false,false,false,false],
  levelAttachedBathrooms:['0','1','0','0'],levelSpecialRooms:['','','puja',''],
  levelUses:['family living','bedrooms','roof room and terrace access','roof room'],vastuProfile:'Jain-led'};
// L: [occupancy, bed, bath, kitchen, living, attached, special, dining]
function program(storeys,L,extra={}){
  const col=(k,d)=>L.map(l=>String(l[k]??d));
  return {storeys:String(storeys),levelOccupancy:L.map(l=>l[0]),levelBedrooms:col(1,0),levelBathrooms:col(2,0),levelKitchens:col(3,0),
    levelLivingRooms:col(4,0),levelAttachedBathrooms:col(5,0),levelSpecialRooms:L.map(l=>l[6]||''),levelSeparateDining:L.map(l=>!!l[7]),
    levelUses:L.map((l,i)=>`level ${i+1} use`),rentFloors:L.some(l=>l[0]==='rental'),rentalFloorCount:String(L.filter(l=>l[0]==='rental').length),...extra};
}
const drawn=(sides,mode='interior')=>{const pts=corners(segmentsToVertices(sides.map(([length,angle])=>({length,unit:'m',angle})),mode));
  return {shape:'surveyedPolygon',plotVertices:pts,boundaryNeighbors:pts.map((_,i)=>i===0?'road':'unknown'),
    boundaryHeights:pts.map(()=>''),boundarySetbacks:pts.map(()=>''),boundaryWindows:pts.map(()=>'unknown')};};
const P={
  owner1:program(1,[['owner',2,1,1,1,0,'puja']]),
  owner2:program(2,[['owner',1,1,1,1,0,'puja'],['owner',3,2,0,0,1,'']]),
  owner25:{},
  owner3:program(3,[['owner',1,2,1,1,0,'puja'],['owner',3,2,0,0,1,''],['owner',2,1,0,1,0,'study']]),
  owner35:program(3.5,[['owner',0,1,1,1,0,'puja'],['owner',3,2,0,0,1,''],['owner',2,1,0,1,0,''],['owner',0,0,0,0,0,'']]),
  rental35:program(3.5,[['rental',2,1,1,1,0,''],['rental',2,1,1,1,0,''],['owner',2,2,1,1,1,'puja,guestBedroom'],['owner',0,0,0,0,0,'']],{partialArea:'40'}),
  rental3:program(3,[['rental',2,1,1,1,0,''],['owner',2,2,1,1,1,'puja'],['owner',2,1,0,0,0,'']]),
  rentalAbove:program(3,[['owner',2,2,1,1,1,'puja'],['rental',2,1,1,1,0,''],['owner',2,1,0,0,0,'']]),
  bigOwner:program(3,[['owner',1,2,1,1,0,'puja,store',true],['owner',4,3,0,1,2,''],['owner',3,2,1,1,1,'laundry']]),
};
const cases=[
  // --- rectangles: size and proportion ---
  ['R1 standard 11.25×11.25 (4 aana), 2.5 st owner',{}],
  ['R2 tiny 6×9 m (1.7 aana), 2.5 st',{width:'6',depth:'9'}],
  ['R3 small 7.5×12 m, 2 st',{width:'7.5',depth:'12',...P.owner2}],
  ['R4 narrow-deep 6×18 m, 3 st',{width:'6',depth:'18',...P.owner3}],
  ['R5 wide-shallow 16×8 m, 2.5 st',{width:'16',depth:'8'}],
  ['R6 large 20×25 m, 3 st, 2 cars',{width:'20',depth:'25',...P.bigOwner,cars:'2'}],
  ['R7 single storey 10×12',{width:'10',depth:'12',...P.owner1}],
  ['R8 3.5 st owner 12×14',{width:'12',depth:'14',...P.owner35,partialArea:'40'}],
  ['S1 7.5×12, side setbacks 0 (shared walls), 2.5 st',{width:'7.5',depth:'12',boundarySetbacks:['1','0','1','0']}],
  ['S2 6×15, side setbacks 0, 2.5 st',{width:'6',depth:'15',boundarySetbacks:['1','0','1','0']}],
  ['S3 9×12, side setbacks 0, rear 1.5, 3 st',{width:'9',depth:'12',boundarySetbacks:['1','0','1.5','0'],...P.owner3}],
  ['S4 8×10 (2.5 aana), side 0, 2.5 st',{width:'8',depth:'10',boundarySetbacks:['1','0','1','0']}],
  ['T1 single storey 11.25 sq, 2 bed + puja',{...P.owner1}],
  ['T2 single storey 12×14, 2 bed + puja',{width:'12',depth:'14',...P.owner1}],
  ['T3 single storey 11.25 sq, 2 bed no puja',program(1,[['owner',2,1,1,1,0,'']])],
  ['T4 single storey 14×16, 3 bed + puja',{width:'14',depth:'16',...program(1,[['owner',3,2,1,1,1,'puja']])}],
  ['T5 2 storey on 11.25 sq',{...P.owner2}],
  ['T6 3 storey owner on 11.25 sq',{...P.owner3}],
  ['T7 3.5 owner on 11.25 sq',{...P.owner35,partialArea:'40'}],
  ['R10 wide-shallow 16×9 m',{width:'16',depth:'9'}],
  ['R11 13×20 m, 2.5 st, 1 car',{width:'13',depth:'20',cars:'1'}],
  ['R9 feet-sized 35×40 ft entered as m (10.67×12.19)',{width:'10.668',depth:'12.192'}],
  // --- road side and north ---
  ['N1 road top edge, north 90',{roadEdge:'2',boundaryNeighbors:['unknown','unknown','road','unknown']}],
  ['N2 road right edge (east road), north 90',{roadEdge:'1',boundaryNeighbors:['unknown','road','unknown','unknown']}],
  ['N3 road left edge (west road)',{roadEdge:'3',boundaryNeighbors:['unknown','unknown','unknown','road']}],
  ['N4 north 0 (north to the right)',{north:'0'}],
  ['N5 north 45 (skewed)',{north:'45'}],
  ['N6 north 270 (south up)',{north:'270'}],
  ['N7 north 200 + east road',{north:'200',roadEdge:'1',boundaryNeighbors:['unknown','road','unknown','unknown']}],
  ['N8 two road edges (corner plot) marked in boundaries',{boundaryNeighbors:['road','road','unknown','unknown']}],
  // --- programs ---
  ['P1 rental 3.5 st (2 rental floors)',{...P.rental35}],
  ['P2 rental 3 st (1 rental floor), stair west',{...P.rental3,rentalStairSide:'west',width:'12',depth:'13'}],
  ['P3 rental above owner (should be refused)',{...P.rentalAbove}],
  ['P4 big family 3 st, separate dining, store, laundry, walk-in',{...P.bigOwner,width:'13',depth:'15',primaryWardrobe:'walkIn',otherBedroomWardrobes:true}],
  ['P5 balconies requested on level-2',{balconies:'level-2'}],
  ['P6 car parking 1 on 11.25×11.25',{cars:'1'}],
  ['P7 10,000 L reservoir',{groundReservoirLitres:'10000'}],
  ['P8 floor height 2.9 m',{floorHeight:'2.9'}],
  ['P9 floor height 3.3 m',{floorHeight:'3.3'}],
  ['P10 declared area 4 aana (matches 126.56 m²? 4 aana=127.2 m²)',{declaredArea:'4',areaUnit:'aana'}],
  // --- drawn plots ---
  ['D1 drawn rectangle 11.25×11.25',drawn([[11.25,0],[11.25,90],[11.25,90],[11.25,90]])],
  ['D2 drawn near-rectangle (88° corner)',drawn([[11,0],[11.5,88],[11.2,92],[11.9,90]].map((s,i,a)=>s))],
  ['D3 trapezoid (front 12, back 9, depth 10)',{shape:'surveyedPolygon',plotVertices:[{x:0,y:0},{x:12,y:0},{x:10.5,y:10},{x:1.5,y:10}],
    boundaryNeighbors:['road','unknown','unknown','unknown'],boundaryHeights:Array(4).fill(''),boundarySetbacks:Array(4).fill(''),boundaryWindows:Array(4).fill('unknown')}],
  ['D7 rotated rectangle (road on side 3), north 30',{north:'30',roadEdge:'2',shape:'surveyedPolygon',plotVertices:[{x:0,y:0},{x:10,y:5},{x:4,y:17},{x:-6,y:12}],
    boundaryNeighbors:['unknown','unknown','road','unknown'],boundaryHeights:Array(4).fill(''),boundarySetbacks:Array(4).fill(''),boundaryWindows:Array(4).fill('unknown')}],
  ['D8 5-sided, road on side 2, 3.5 rental',{...P.rental35,roadEdge:'1',shape:'surveyedPolygon',plotVertices:[{x:0,y:0},{x:13,y:0},{x:14,y:12},{x:5,y:14},{x:0,y:10}],
    boundaryNeighbors:['unknown','road','unknown','unknown','unknown'],boundaryHeights:Array(5).fill(''),boundarySetbacks:Array(5).fill(''),boundaryWindows:Array(5).fill('unknown')}],
  ['D9 drawn in feet via sketcher (35×50 ft)',drawn([[10.668,0],[15.24,90],[10.668,90],[15.24,90]])],
  ['D4 5-sided irregular (fixture shape)',{shape:'surveyedPolygon',plotVertices:[{x:0,y:0},{x:12,y:0},{x:13,y:10},{x:4,y:13},{x:0,y:9}],
    boundaryNeighbors:['road','unknown','unknown','unknown','unknown'],boundaryHeights:Array(5).fill(''),boundarySetbacks:Array(5).fill(''),boundaryWindows:Array(5).fill('unknown')}],
  ['D5 L-shaped plot (6 corners)',{shape:'surveyedPolygon',plotVertices:[{x:0,y:0},{x:14,y:0},{x:14,y:7},{x:8,y:7},{x:8,y:14},{x:0,y:14}],
    boundaryNeighbors:['road','unknown','unknown','unknown','unknown','unknown'],boundaryHeights:Array(6).fill(''),boundarySetbacks:Array(6).fill(''),boundaryWindows:Array(6).fill('unknown')}],
  ['D6 triangle',{shape:'surveyedPolygon',plotVertices:[{x:0,y:0},{x:18,y:0},{x:6,y:14}],
    boundaryNeighbors:['road','unknown','unknown'],boundaryHeights:Array(3).fill(''),boundarySetbacks:Array(3).fill(''),boundaryWindows:Array(3).fill('unknown')}],
  // --- invalid / incomplete input (should be refused with a clear message) ---
  ['X1 ward missing',{ward:''}],
  ['X2 Lalitpur (no reviewed bylaw profile)',{municipality:'Lalitpur Metropolitan City'}],
  ['X3 Pokhara',{municipality:'Pokhara Metropolitan City',ward:'8'}],
  ['X4 municipality typed "Kathmandu"',{municipality:'Kathmandu'}],
  ['X25 municipality typed "kmc"',{municipality:'kmc'}],
  ['X26 municipality typed "pokhara"',{municipality:'pokhara',ward:'5'}],
  ['X27 partial floor 70 m² on 11.25 sq plot',{partialArea:'70'}],
  ['X5 width 0',{width:'0'}],
  ['X6 width blank',{width:''}],
  ['X7 north blank',{north:''}],
  ['X8 north 360',{north:'360'}],
  ['X9 north evidence blank',{northEvidence:''}],
  ['X10 road width blank',{roadWidth:''}],
  ['X11 straight stair',{stair:'straight'}],
  ['X12 reservoir 3000 L',{groundReservoirLitres:'3000'}],
  ['X13 declared area 6 aana vs 4 measured',{declaredArea:'6',areaUnit:'aana'}],
  ['X14 no bedrooms at all',program(2,[['owner',0,1,1,1,0,''],['owner',0,1,0,0,0,'']])],
  ['X15 no kitchen',program(2,[['owner',1,1,0,1,0,''],['owner',2,1,0,0,0,'']])],
  ['X16 attached > bedrooms',program(2,[['owner',1,1,1,1,0,''],['owner',1,2,0,0,2,'']])],
  ['X17 floor height 0',{floorHeight:'0'}],
  ['X18 partial area larger than plot',{partialArea:'500'}],
  ['X19 balcony on unknown level',{balconies:'level-9'}],
  ['X20 road edge also marked building',{boundaryNeighbors:['building','unknown','unknown','unknown']}],
  ['X21 guest bedroom with 1 owner bedroom',program(2,[['owner',0,1,1,1,0,''],['owner',1,1,0,0,0,'guestBedroom']])],
  ['X22 drawn self-crossing plot',{shape:'surveyedPolygon',plotVertices:[{x:0,y:0},{x:10,y:10},{x:10,y:0},{x:0,y:10}],
    boundaryNeighbors:['road','unknown','unknown','unknown'],boundaryHeights:Array(4).fill(''),boundarySetbacks:Array(4).fill(''),boundaryWindows:Array(4).fill('unknown')}],
  ['X23 typo special room "pooja"',{levelSpecialRooms:['','','pooja','']}],
  ['X24 rental flag but no rental floor',{rentFloors:true,rentalFloorCount:'1'}],
];
const call=async body=>{const res={code:0,body:null,status(c){this.code=c;return this},type(){return this},json(b){this.body=b;return this},send(b){this.body=b;return this},setHeader(){}};
  const t=Date.now();await handler({body,headers:{host:'127.0.0.1'},socket:{remoteAddress:'127.0.0.1'}},res);res.ms=Date.now()-t;return res;};
(async()=>{
  const args=process.argv.slice(2),outAt=args.indexOf('--out'),outFile=outAt>=0?args[outAt+1]:null;
  const only=args.find((a,i)=>!a.startsWith('--')&&i!==outAt+1);const out=[];
  for(const [name,patch] of cases){
    if(only&&!name.startsWith(only))continue;
    const form={...INITIAL,...patch};
    const survey=buildNepalSurvey(form);
    const row={name};
    try{
      const pf=preflightNepal(survey);
      row.ready=pf.contractReady;
      row.blockers=pf.blockers.filter(b=>!['NEPAL_GENERATOR_PENDING','RULE_SOURCE_DRIFT','KMC_RULE_REVIEW_REQUIRED'].includes(b.code)).map(b=>`${b.code}: ${b.message}`);
      if(pf.contractReady){
        const html=await call({surveyData:survey});row.review=html.code;row.reviewMs=html.ms;
        if(html.code!==200)row.reviewMsg=html.body?.message;
        const j=await call({surveyData:survey,format:'json'});row.json=j.code;
        row.candidates=j.body?.candidates?.length||0;row.jsonMsg=j.code!==200?j.body?.message:undefined;
        if(!row.candidates&&html.code===200){try{const rv=buildReviewCase('x',pf.normalizedBrief);
          // group reasons that differ only in numbers; show the first wording
          const rs={};for(const a of rv.result.attempts.filter(a=>a.status==='rejected')){const k=a.reason.replace(/[0-9.,]+/g,'#');(rs[k]??={n:0,text:a.reason.replace(/^[\w-]+: /,'')}).n++;}
          row.rejected=Object.values(rs).sort((a,b)=>b.n-a.n).slice(0,4).map(r=>`${r.n}× ${r.text}`);row.assumptions=rv.assumptions;}catch(e){row.rejected=[e.message];}}
        if(row.candidates){
          const c0=j.body.candidates[0];row.first=c0.id;row.levels=c0.levels.map(l=>`${l.kind[0]}${l.rooms.length}`).join('/');
          const d=await call({surveyData:survey,format:'drawings',candidateIndex:0});row.drawings=d.code;row.drawMs=d.ms;
          if(d.code!==200)row.drawMsg=d.body?.message;else row.sheets=(d.body.match(/<section class="sheet">/g)||[]).length;
          const x=await call({surveyData:survey,format:'dxf',candidateIndex:0});row.dxf=x.code;row.dxfKB=x.code===200?Math.round(x.body.length/1024):x.body?.message;
          const s=await call({surveyData:survey,format:'structure-json',candidateIndex:0});row.structure=s.code;row.structMs=s.ms;
          if(s.code===200){row.struct=`${s.body.sizes.columnMm} col, ${s.body.sizes.beam.join('×')} beam, pass=${s.body.summary.pass}, V=${Math.round(s.body.seismic.Vx)} kN, NBC205=${s.body.nbc205.eligible}`;}
          else row.structMsg=s.body?.message;
        }
      }
    }catch(e){row.crash=e.stack.split('\n').slice(0,3).join(' | ');}
    out.push(row);
    const verdict=row.crash?'CRASH':!row.ready?'refused':!row.candidates?'no plan':'planned';
    console.log(`${verdict.padEnd(8)} ${name}`);
  }
  const cell=t=>String(t??'').replace(/\|/g,'/').replace(/[0-9]+(\.[0-9]+)?(?= ?(m|mm|%))/g,m=>m);
  const md=['| Case | Result | Detail |','|---|---|---|',...out.map(r=>{
    if(r.crash)return `| ${r.name} | CRASH | ${cell(r.crash)} |`;
    if(!r.ready)return `| ${r.name} | refused | ${cell(r.blockers.join('; '))} |`;
    if(!r.candidates)return `| ${r.name} | no plan | ${cell((r.rejected||[]).slice(0,2).join('; '))} |`;
    return `| ${r.name} | planned | ${r.candidates} options, floors ${r.levels}; drawings ${r.drawings} (${r.sheets} sheets), DXF ${r.dxf}, structure: ${cell(r.struct||r.structMsg)} |`;})].join('\n');
  if(outFile)fs.writeFileSync(outFile,md+'\n');
  const n=k=>out.filter(r=>k(r)).length;
  console.log(`\n${out.length} cases: ${n(r=>r.candidates)} planned, ${n(r=>r.ready&&!r.candidates&&!r.crash)} no plan, ${n(r=>!r.ready&&!r.crash)} refused, ${n(r=>r.crash)} crashed`);
  if(out.some(r=>r.crash))process.exitCode=1;
})();
