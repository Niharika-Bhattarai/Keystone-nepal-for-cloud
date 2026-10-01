'use strict';
// Step-by-step structural calculation report (HTML) for one hypothesis. Every
// number is shown with its formula, substitution and the clause/page it comes
// from, so an engineer can check it line by line.
const {SOURCES,NBC105,ANNEX_A,NBC205,IS456,IS875,IS1893}=require('./codeData');
const S=require('./sections');

const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const f=(n,d=2)=>Number.isFinite(n)?Number(n).toFixed(d):n===Infinity?'∞':'—';
const SHORT={'nbc105-2025':'NBC 105:2025','nbc205-2024':'NBC 205:2024','is1893-2016':'IS 1893(1):2016',
  'is456-2000':'IS 456:2000*','is875-1987':'IS 875*'};
const cite=r=>r?`<span class="ref">${esc(SHORT[r.source]||r.source)} ${esc(r.clause)}${r.page?`, PDF p.${r.page}`:''}</span>`:'';
const badge=(ok,{warn=false,text}={})=>`<span class="b ${ok?'ok':warn?'warn':'bad'}">${esc(text||(ok?'OK':warn?'CHECK':'FAILS'))}</span>`;
const table=(head,rows,cls='')=>`<table class="${cls}"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

function steps(list){
  return `<ol class="steps">${list.map(s=>`<li><div class="st"><b>${esc(s.title)}</b>${cite(s.ref)}</div>`+
    (s.formula?`<div class="fx">${s.formula}</div>`:'')+(s.sub?`<div class="sub">= ${s.sub}</div>`:'')+
    `<div class="res">${s.result}${s.status!=null?' '+s.status:''}</div>${s.note?`<div class="note">${s.note}</div>`:''}</li>`).join('')}</ol>`;
}

function renderStructuralReport(r,{option='Option 1',date=new Date().toISOString().slice(0,10)}={}){
  const {model,grav,an}=r,inp=model.inputs,hz=an.hz,j=model.brief?.jurisdiction||{};
  const G={x:an.dirs.x.gov,y:an.dirs.y.gov};
  const sec=[];
  const add=(id,title,body)=>sec.push(`<section id="${id}"><h2>${esc(title)}</h2>${body}</section>`);

  // 0 Summary
  const sm=r.summary;
  const checks=[['Storey drift ULS (≤ 0.025) and SLS (≤ 0.006)',sm.driftOk],['Columns: strength (biaxial, all combinations)',sm.columnsOk],
    ['Beams: flexure, shear, Annex A limits',sm.beamsOk],['Strong column – weak beam (ΣMc ≥ 1.2 ΣMb)',sm.scwbOk],
    ['No extreme torsional irregularity (ratio ≤ 2.5)',!sm.extremeTorsion],['Overturning stability',sm.stabilityOk],['No floating columns',!sm.floating]];
  add('summary','Summary',
    `<p class="lead">${sm.pass?badge(true,{text:'PRELIMINARY CHECKS PASS'}):badge(false,{text:'CHECKS DO NOT ALL PASS'})} with
      columns <b>${inp.columnMm} × ${inp.columnMm} mm</b>, beams <b>${inp.beamWidthMm} × ${inp.beamDepthMm||'layout'} mm</b>,
      slab ${inp.slabMm} mm, M${r.fck} concrete, Fe${r.fy} steel.</p>`+
    table(['Check','Result'],checks.map(([t,ok])=>[esc(t),badge(ok)]))+
    `<p>Seismic weight W = <b>${f(an.Wt,0)} kN</b>; Z = ${hz.Z}; soil ${G.x.soil}; T = ${f(G.x.T,3)} s; C<sub>d</sub>(T) = ${f(G.x.Cd,4)};
      base shear V = <b>${f(G.x.V,1)} kN</b> (X) / <b>${f(G.y.V,1)} kN</b> (Y).</p>`+
    `<h3>Size trials</h3>`+table(['Column','Beam b × D','Max ULS drift','Max SLS drift','Drift','Beams','Full check'],
      r.trials.map(t=>[`${t.columnMm}`,`${t.beamWidthMm} × ${t.beamDepthMm}`,`${f(t.maxDrift*100,2)} %`,`${f(t.maxSls*100,3)} %`,
        badge(t.driftOk),badge(t.beamsOk),t.full?(t.full.pass?badge(true,{text:'adopted'}):badge(false,{text:'fails: '+[['driftOk','drift'],['columnsOk','columns'],['beamsOk','beams'],['scwbOk','strong column'],['stabilityOk','stability']].filter(([k])=>!t.full[k]).map(([,n])=>n).concat(t.full.extremeTorsion?['torsion']:[],t.full.floating?['floating column']:[]).join(', ')})):'screened out']))+
    `<p class="note">Sizes start from the layout/owner input and step up until the checks pass${r.locked?' (sizes were locked by the user)':''}.</p>`+
    `<h3>NBC 205:2024 ready-to-use guideline eligibility</h3>${cite(NBC205.restrictions)}`+
    table(['Restriction','This building',''],r.elig.items.map(i=>[esc(i.id),esc(i.text),badge(i.ok)]))+
    `<p>${r.elig.eligible?'The building meets the NBC 205 layout restrictions; its tabulated member sizes may be compared with this calculation.':
      'The building is <b>outside</b> NBC 205 restrictions, so it must be designed to NBC 105 (as below) rather than by the ready-to-use tables (NBC 205 cl 4.2).'}</p>`);

  // 1 Inputs
  const st=(v,s)=>`<span class="tag ${s}">${s.replace(/_/g,' ')}</span>`;
  add('inputs','1. Inputs and assumptions',table(['Item','Value','Basis','Status'],[
    ['Location',esc(`${j.municipality||'—'}, Ward ${j.ward||'—'}`),'survey','owner input'],
    ['Structural system','RC moment resisting frame, bare frame (infill not counted for strength)',cite(NBC205.basis),st(0,'code')],
    ['Concrete',`M${r.fck} (f<sub>ck</sub> = ${r.fck} MPa)`,cite(ANNEX_A.materials),st(0,'code')],
    ['Steel',`Fe${r.fy}`,cite(NBC205.basis),st(0,'code')],
    ['Importance class',`${inp.importanceClass} (residence) → I = ${hz.I}`,cite(NBC105.importanceRef),st(0,'code')],
    ['RC concrete unit weight',`${inp.gammaRC} kN/m³`,cite(IS875.unitWeights),st(0,'not_supplied_verify')],
    ['Brick masonry unit weight',`${inp.gammaBrick} kN/m³; plaster ${inp.plasterPerFace} kN/m² per face`,cite(IS875.unitWeights),st(0,'not_supplied_verify')],
    ['Floor / roof finish',`${inp.floorFinish} / ${inp.roofFinish} kN/m²`,'common Nepali practice (screed + tiles; roof screed + waterproofing)',st(0,'assumed')],
    ['Live loads',`rooms ${inp.liveRoom}, stair/corridor/balcony ${inp.liveCirculation}, roof ${inp.liveRoof} kN/m²`,cite(IS875.liveLoads),st(0,'not_supplied_verify')],
    ['Seismic live load',`${NBC105.seismicLiveFactor.other} × LL on floors, nil on roof`,cite(NBC105.seismicLiveRef),st(0,'code')],
    ['Parapet',`${inp.parapetThicknessMm} mm brick, ${inp.parapetMm} mm high`,'drawing set AR sheets',st(0,'assumed')],
    ['Overhead tank',`${inp.tankLitres} L on top roof`,'roof plan',st(0,'assumed')],
    ['Stair waist',`${inp.stairWaistMm} mm`,cite(NBC205.basis),st(0,'code')],
    ['Safe bearing capacity',`${r.sbc} kN/m²${model.inputs.sbc?'':' (lowest NBC 205 Table 3-2 value — soil test required)'}`,cite(NBC205.sbcTable),st(0,model.inputs.sbc?'owner_input':'assumed')],
    ['Covers',`beam ${inp.coverBeamMm}, column ${inp.coverColumnMm}, footing ${inp.coverFootingMm} mm`,cite(IS456.flexure),st(0,'not_supplied_verify')],
  ])+`<p class="note">* IS 456 and IS 875 are referred to by NBC 205 but are <b>not among the supplied code files</b>; their clause values are shown so an engineer can verify them against an official copy.</p>`);

  // 2 Geometry
  add('geometry','2. Geometry',table(['Storey','Floor level (m)','Height (m)','Plan area (m²)','Columns','Walls'],
    model.storeys.map(s=>[esc(s.id),f(s.z0),f(s.h),f(s.areaSqM,1),s.columns.length,s.wallsAssumed?'assumed 9" perimeter, 30 % openings':`${s.walls.length} from plan`]))+
    `<p>Grid X: ${model.candidate.grid.xAxesMm.map(v=>f(v/1000)).join(', ')} m; Y: ${model.candidate.grid.yAxesMm.map(v=>f(v/1000)).join(', ')} m. Height to top roof H = ${f(an.H)} m.</p>`);

  // 3 Unit loads
  const fl=model.candidate.core?.flights?.[0]||{},R=(fl.riserMm||175)/1000,T=(fl.treadMm||250)/1000;
  const wall=t=>inp.gammaBrick*t+2*inp.plasterPerFace;
  add('loads','3. Unit loads',steps([
    {title:'Slab self weight',formula:'g<sub>s</sub> = γ<sub>c</sub> × t',sub:`${inp.gammaRC} × ${inp.slabMm/1000}`,result:`${f(inp.gammaRC*inp.slabMm/1000,3)} kN/m²`,ref:IS875.unitWeights},
    {title:'Floor dead load',formula:'g = g<sub>s</sub> + finish',sub:`${f(inp.gammaRC*inp.slabMm/1000,3)} + ${inp.floorFinish}`,result:`${f(inp.gammaRC*inp.slabMm/1000+inp.floorFinish,3)} kN/m² (roof ${f(inp.gammaRC*inp.slabMm/1000+inp.roofFinish,3)})`},
    {title:'Stair (waist slab + steps, per plan area)',formula:'g = γ<sub>c</sub>(t·√(R²+T²)/T + R/2) + finish',sub:`${inp.gammaRC}(${inp.stairWaistMm/1000}·√(${R}²+${T}²)/${T} + ${R}/2) + ${inp.stairFinish}`,
      result:`${f(inp.gammaRC*(inp.stairWaistMm/1000*Math.hypot(R,T)/T+R/2)+inp.stairFinish,2)} kN/m²`},
    {title:'9" (229 mm) wall per m² of wall',formula:'γ<sub>b</sub>·t + 2 × plaster',sub:`${inp.gammaBrick} × 0.229 + 2 × ${inp.plasterPerFace}`,result:`${f(wall(0.229),2)} kN/m²`},
    {title:'4" (102 mm) wall per m² of wall',formula:'γ<sub>b</sub>·t + 2 × plaster',sub:`${inp.gammaBrick} × 0.102 + 2 × ${inp.plasterPerFace}`,result:`${f(wall(0.102),2)} kN/m²`},
    {title:'Wall heights',formula:'h<sub>w</sub> = storey height − beam depth; openings deducted (windows 1.2 m, doors 2.1 m high)',result:`walls are taken wall-by-wall from the plan, in 0.1 m pieces`},
    {title:'Parapet per metre',formula:'(γ<sub>b</sub>·t + 2 plaster) × h',sub:`${f(wall(inp.parapetThicknessMm/1000),2)} × ${inp.parapetMm/1000}`,result:`${f(wall(inp.parapetThicknessMm/1000)*inp.parapetMm/1000,2)} kN/m`},
  ]));

  // 4 Seismic weight
  add('weight','4. Seismic weight of each floor',cite(NBC105.seismicLiveRef)+
    table(['Level','z (m)','Slab+finish','Stair','Beams','Walls ½ below + ½ above','Columns','Parapet / tank','0.3 LL','W<sub>i</sub> (kN)'],
      grav.levels.map(l=>{const a=l.acc;return [esc(l.id),f(l.z),f(a.slabDL+a.finishDL,1),f(a.stairDL,1),f(a.beams,1),f(a.wallHalfBelow+a.wallHalfAbove,1),
        f(a.colHalfBelow+a.colHalfAbove,1),f(a.parapet+a.tank,1),f(a.LLseismic,1),`<b>${f(l.W,1)}</b>`];}))+
    `<p>W = ΣW<sub>i</sub> = <b>${f(an.Wt,1)} kN</b> (${f(an.Wt/model.storeys.reduce((n,s)=>n+s.areaSqM,0),2)} kN/m² of floor). Roof live load is not included (Table 5-1).</p>`);

  // 5 Hazard and base shear
  const soilNote=hz.soilBasis.basis==='table_4_3_default'?`soil type D by default for ${esc(hz.soilBasis.entry)} (Table 4-3)`:
    hz.soilBasis.basis==='owner_or_engineer_input'?`soil type ${G.x.soil} from input`:`soil type not established — both C and D calculated, governing ${G.x.soil}`;
  const g=G.x,p=g.ch.params;
  add('seismic','5. Seismic hazard and base shear (Equivalent Static Method)',steps([
    {title:'Seismic zoning factor Z',formula:'from Annex C, Table C-1',sub:hz.zone?esc(`${hz.zone.row.district} — ${hz.zone.row.localUnit}`):'input',result:`Z = ${hz.Z}`,ref:hz.zone?.ref||NBC105.zoneRef},
    {title:'Site soil type',result:soilNote,ref:NBC105.softSoilRef,note:hz.notes.join(' ')},
    {title:'Importance factor',result:`I = ${hz.I}`,ref:NBC105.importanceRef},
    {title:'Empirical period',formula:'T<sub>1</sub> = k<sub>t</sub> H<sup>3/4</sup>, k<sub>t</sub> = 0.075 (RC frame)',sub:`0.075 × ${f(an.H)}<sup>0.75</sup>`,result:`${f(an.Tbase,3)} s`,ref:NBC105.periodRef},
    {title:'Amplified period',formula:'1.25 T<sub>1</sub>',sub:`1.25 × ${f(an.Tbase,3)}`,result:`${f(an.Temp,3)} s`,ref:NBC105.periodAmpRef},
    {title:'Rayleigh period (X / Y)',formula:'T = 2π √(ΣW<sub>i</sub>d<sub>i</sub>² / (g ΣF<sub>i</sub>d<sub>i</sub>))',
      sub:`2π √(${f(G.x.rayleigh.num,4)} / ${f(G.x.rayleigh.den,3)}) ; 2π √(${f(G.y.rayleigh.num,4)} / ${f(G.y.rayleigh.den,3)})`,result:`${f(G.x.Tray,3)} s / ${f(G.y.Tray,3)} s`,ref:NBC105.rayleighRef,
      note:'d<sub>i</sub> from the cracked-section storey stiffness (section 7) under the ESM force pattern.'},
    {title:'Adopted period (lesser)',result:`T = ${f(G.x.T,3)} s (X), ${f(G.y.T,3)} s (Y)`,ref:NBC105.rayleighRef},
    {title:'Spectral shape factor',formula:`C<sub>h</sub>(T) — soil ${g.soil}: T<sub>a</sub> = 0 (ESM), T<sub>c</sub> = ${p.Tc}, T<sub>d</sub> = ${p.Td}, α = ${p.alpha}; branch ${esc(g.ch.branch)}`,result:`C<sub>h</sub> = ${f(g.ch.value,3)}`,ref:NBC105.spectralRef},
    {title:'Elastic site spectrum',formula:'C(T) = C<sub>h</sub>(T) Z I',sub:`${f(g.ch.value,3)} × ${hz.Z} × ${hz.I}`,result:`${f(g.C,4)}`,ref:NBC105.elasticRef},
    {title:'ULS base shear coefficient',formula:'C<sub>d</sub>(T) = C(T) / (R<sub>μ</sub> Ω<sub>u</sub>), RC frame R<sub>μ</sub> = 4, Ω<sub>u</sub> = 1.5',sub:`${f(g.C,4)} / (4 × 1.5)`,result:`${f(g.Cd,4)}`,ref:NBC105.cdRef},
    {title:'SLS base shear coefficient',formula:'C<sub>s</sub>(T) = 0.20 C(T); C<sub>d</sub> = C<sub>s</sub>/Ω<sub>s</sub>, Ω<sub>s</sub> = 1.25',sub:`0.20 × ${f(g.C,4)} / 1.25`,result:`${f(g.CdS,4)}`,ref:NBC105.slsRef},
    {title:'Base shear',formula:'V = C<sub>d</sub>(T) W',sub:`${f(g.Cd,4)} × ${f(an.Wt,1)}`,result:`<b>V = ${f(g.V,1)} kN</b> (ULS), ${f(g.VS,1)} kN (SLS)`,ref:NBC105.baseShearRef},
    {title:'ESM applicability',result:`${an.esm.ok?badge(true):badge(false,{warn:true})} ${esc(an.esm.basis)}`,ref:NBC105.esmRef},
  ]));

  // 6 Distribution
  add('distribution','6. Vertical distribution of the base shear',cite(NBC105.distributionRef)+
    `<p>F<sub>i</sub> = W<sub>i</sub>h<sub>i</sub><sup>k</sup> / ΣW<sub>j</sub>h<sub>j</sub><sup>k</sup> × V, with k = ${f(g.dist.k,3)} for T = ${f(g.T,3)} s (k = 1 for T ≤ 0.5 s, 2 for T ≥ 2.5 s, linear between).</p>`+
    table(['Level','W<sub>i</sub> (kN)','h<sub>i</sub> (m)','W<sub>i</sub>h<sub>i</sub><sup>k</sup>','F<sub>i</sub> X (kN)','Storey shear X','F<sub>i</sub> Y (kN)','Storey shear Y'],
      grav.levels.map((l,i)=>[esc(l.id),f(l.W,1),f(l.z),f(l.W*l.z**g.dist.k,0),f(G.x.dist.F[i],1),f(G.x.Vs[i],1),f(G.y.dist.F[i],1),f(G.y.Vs[i],1)])));

  // 7 Stiffness and drift
  const kd=an.kd;
  const st7=['x','y'].map(dir=>`<h3>Direction ${dir.toUpperCase()}</h3>`+table(['Storey','K (kN/m) ULS','Elastic drift (mm)','ULS drift ×R<sub>μ</sub>×k<sub>d</sub> (mm)','ULS ratio','K SLS','SLS drift (mm)','SLS ratio',''],
    an.dirs[dir].drifts.map((d,i)=>[esc(d.storey),f(an.uls[i].K[dir],0),f(d.elastic*1000,2),f(d.uls*1000,1),`${f(d.ulsRatio*100,3)} %`,f(an.sls[i].K[dir],0),f(d.sls*1000,2),`${f(d.slsRatio*100,3)} %`,badge(d.okULS&&d.okSLS)]))).join('');
  const c0=an.uls[0].cols.x[0];
  add('drift','7. Storey stiffness and drift',steps([
    {title:'Concrete modulus',formula:'E<sub>c</sub> = 5000 √f<sub>ck</sub>',sub:`5000 √${r.fck}`,result:`${f(5000*Math.sqrt(r.fck),0)} MPa`,ref:IS456.ec},
    {title:'Cracked stiffness',formula:'beams 0.35 E<sub>c</sub>I<sub>g</sub>, columns 0.70 E<sub>c</sub>I<sub>g</sub> (ULS); 0.70 / 0.90 (SLS)',result:'applied to every member',ref:NBC105.crackedRef},
    {title:'Column lateral stiffness (D-value method)',formula:'D = a · 12 E<sub>c</sub>I<sub>c</sub>/h³; k̄ = ΣK<sub>b</sub>/(2K<sub>c</sub>), a = k̄/(2+k̄); ground storey (fixed base) k̄ = ΣK<sub>b</sub>/K<sub>c</sub>, a = (0.5+k̄)/(2+k̄)',
      sub:`e.g. ${esc(c0.id)} ground X: k̄ = ${f(c0.kbar,3)}, a = ${f(c0.a,3)}`,result:`D = ${f(c0.D,0)} kN/m`,note:'Muto D-value method; beams as rectangular sections (slab flange ignored — conservative for drift).'},
    {title:'Design deflections',formula:'ULS: elastic × R<sub>μ</sub> (5.5.1.1) × k<sub>d</sub>; SLS: elastic × k<sub>d</sub>',sub:`k<sub>d</sub> = ${kd} for ${model.storeys.length} storeys`,result:'limits 0.025 h (ULS), 0.006 h (SLS)',ref:NBC105.driftRef},
  ])+st7);

  // 8 Torsion and irregularity
  add('torsion','8. Torsion and structural irregularity',cite(NBC105.eccRef)+
    ['x','y'].map(dir=>`<h3>Load in ${dir.toUpperCase()}</h3>`+table(['Storey','b (m)','Mass centre','Rigidity centre','e<sub>0</sub> (m)','±0.05b','Δmax/Δmin',''],
      an.dirs[dir].torsion.map(t=>[esc(t.storey),f(t.b),f(t.cmResultant),f(t.cr),f(t.e0),f(t.acc),f(t.ratio),
        badge(!t.irregular,{warn:t.irregular&&!t.extreme,text:t.extreme?'EXTREME — revise':t.irregular?'irregular':'OK'})]))).join('')+
    `<h3>Irregularity checks</h3>`+table(['Type','Dir','Storey','Value','',''],r.irr.map(i=>[esc(i.kind),i.dir||'',esc(i.storey),esc(i.value),
      i.irregular?badge(false,{warn:!i.extreme,text:i.extreme?'NOT PERMITTED':'irregular'}):badge(true),cite(i.ref)]))+
    (r.td.floating.length?`<p>${badge(false)} Columns without support below (floating): ${r.td.floating.map(x=>esc(`${x.id} at ${x.storey}`)).join(', ')} — not permitted in the lateral system ${cite(NBC105.floatingColumnRef)}</p>`:''));

  // 9 Combinations
  add('combos','9. Load combinations',
    `<p>NBC 105 limit state ${cite(NBC105.combosLSM)}: 1.2DL + 1.5LL; DL + λLL ± E (λ = 0.3); 0.9DL ± E. Gravity: 1.5(DL + LL) ${cite(IS456.combos)}.
     Earthquake one orthogonal direction at a time (3.3). Footings: working stress ${cite(NBC105.combosWSM)} DL + LL; DL + 0.3LL ± 0.7E, bearing +50 % ${cite(NBC105.bearingRef)}.</p>`);

  // 10 Takedown
  const base=Object.values(r.td.base);
  add('takedown','10. Gravity load takedown',
    `<p>Each slab is divided into 0.1 m cells, each cell assigned to the nearest column (tributary area) and to the nearest beam (45° yield-line share). Walls, beams, parapets and tank follow the same rule. Equilibrium: Σ footing dead load ${f(r.td.equilibrium.sumFootingDL,1)} kN = total dead load ${f(r.td.equilibrium.totalDL,1)} kN.</p>`+
    table(['Column','x, y (m)',...model.storeys.map(s=>`${esc(s.id)} P<sub>D</sub> / P<sub>L</sub> (kN)`),'Footing P<sub>D</sub> / P<sub>L</sub>'],
      base.map(b=>[esc(b.id),`${f(b.x)}, ${f(b.y)}`,...model.storeys.map((s,i)=>{const q=r.td.storeys[i][b.id];return q?`${f(q.PD,0)} / ${f(q.PL,0)}`:'—';}),`<b>${f(b.PD,0)} / ${f(b.PL,0)}</b>`])));

  // 11 Beams
  const worstBeam=r.beams.filter(b=>b.level!=='plinth').reduce((a,b)=>b.hog>a.hog?b:a);
  const wb=worstBeam;
  add('beams','11. Beam design',
    `<h3>Worked example — beam ${esc(wb.id)} (${esc(wb.level)}, span ${f(wb.L)} m, ${wb.b} × ${wb.D} mm)</h3>`+steps([
      {title:'Loads on the beam',formula:'slab share (45° lines) + walls on it + self weight',result:`w<sub>D</sub> = ${f(wb.wD)} kN/m, w<sub>L</sub> = ${f(wb.wL)} kN/m`},
      {title:'Gravity moments (continuous beam coefficients)',formula:'M<sub>sup</sub> = w<sub>D</sub>L²/10 + w<sub>L</sub>L²/9; M<sub>span</sub> = w<sub>D</sub>L²/12 + w<sub>L</sub>L²/10',ref:IS456.coefficients,
        result:`M<sub>sup</sub> = ${f(wb.wD*wb.L**2/10+wb.wL*wb.L**2/9)} kNm, M<sub>span</sub> = ${f(wb.wD*wb.L**2/12+wb.wL*wb.L**2/10)} kNm`},
      {title:'Earthquake end moment',formula:'column moments at each joint shared to the beams by stiffness',result:`M<sub>E</sub> = ${f(wb.ME)} kNm`},
      {title:'Design hogging moment',formula:'max[1.5(D+L); 1.2D+1.5L; D+0.3L+E]',result:`M<sub>u</sub> = ${f(wb.hog)} kNm`,ref:NBC105.combosLSM},
      {title:'Limiting moment',formula:`M<sub>u,lim</sub> = 0.36·(x<sub>u,max</sub>/d)(1−0.416 x<sub>u,max</sub>/d) f<sub>ck</sub> b d², x<sub>u,max</sub>/d = ${S.xuMaxRatio(r.fy)}`,
        sub:`${f(S.muLimCoeff(r.fy),4)} × ${r.fck} × ${wb.b} × ${wb.d}²`,result:`${f(S.muLimCoeff(r.fy)*r.fck*wb.b*wb.d**2/1e6,1)} kNm`,ref:IS456.muLim},
      {title:'Top steel',formula:'A<sub>st</sub> = 0.5 f<sub>ck</sub>/f<sub>y</sub> [1 − √(1 − 4.6 M<sub>u</sub>/(f<sub>ck</sub> b d²))] b d ≥ ρ<sub>min</sub> b d, ρ<sub>min</sub> = 0.24√f<sub>ck</sub>/f<sub>y</sub>',
        sub:`ρ<sub>min</sub> = ${f(0.24*Math.sqrt(r.fck)/r.fy,5)}`,result:`required ${f(wb.topReq,0)} mm² → <b>${esc(wb.top)}</b>`,ref:ANNEX_A.beamLong},
      {title:'Bottom steel',formula:'max(span moment, earthquake sagging at support, ½ top steel at the face, ¼ top steel anywhere)',result:`required ${f(wb.botReq,0)} mm² → <b>${esc(wb.bottom)}</b>`,ref:ANNEX_A.beamLong},
      {title:'Capacity design shear',formula:'V<sub>u</sub> = V<sup>D+0.5L</sup> + 1.4 (M<sub>u</sub><sup>s</sup> + M<sub>u</sub><sup>h</sup>)/L<sub>clear</sub>',
        sub:`${f(wb.Vg,1)} + 1.4 (${f(wb.Ms,1)} + ${f(wb.Mh,1)}) / ${f(wb.L-model.colB)}`,result:`V<sub>u</sub> = ${f(wb.Vcap,1)} kN (analysis ${f(wb.Van,1)} kN) → ${f(wb.Vu,1)} kN`,ref:ANNEX_A.beamShear},
      {title:'Stirrups',formula:'τ<sub>v</sub> = V<sub>u</sub>/(bd); s = 0.87 f<sub>y</sub> A<sub>sv</sub> d / (V<sub>u</sub> − τ<sub>c</sub>bd); ends ≤ min(d/4, 8d<sub>b</sub>, 100), ≥ 75; elsewhere ≤ d/2',
        sub:`τ<sub>v</sub> = ${f(wb.tv)} MPa, τ<sub>c</sub> = ${f(wb.tc)} MPa`,result:`<b>${wb.links.dia}φ 2-legged @ ${wb.links.end} mm</b> over ${wb.lengths.endZone} mm from each face, @ ${wb.links.mid} mm elsewhere; first link ≤ 50 mm from the face`,ref:ANNEX_A.beamLinks},
    ])+`<details><summary><b>Beam schedule</b> (${r.beams.length} beams)</summary>`+table(['Beam','Level','Dir','Span (m)','b × D','w<sub>D</sub> / w<sub>L</sub> (kN/m)','M<sub>E</sub>','M<sub>u</sub> hog / sag (kNm)','Top','Bottom','V<sub>u</sub> (kN)','Links end / mid',''],
      r.beams.map(b=>[esc(b.id),esc(b.level),b.axis.toUpperCase(),f(b.L),`${b.b} × ${b.D}`,`${f(b.wD,1)} / ${f(b.wL,1)}`,f(b.ME,1),`${f(b.hog,1)} / ${f(b.sagSpan,1)}`,
        esc(b.top),esc(b.bottom),f(b.Vu,1),`${b.links.dia}φ @ ${b.links.end} / ${b.links.mid}`,badge(b.ok,{text:b.ok?'OK':b.checks.filter(c=>!c.ok&&!c.advisory).map(c=>c.id).join(', ')})]),'small')+'</details>');

  // 12 Columns
  const wc=r.columns.reduce((a,b)=>(b.worst?.ratio||0)>(a.worst?.ratio||0)?b:a);
  const cb=wc.worst?.combo||{};
  add('columns','12. Column design',
    `<h3>Worked example — column ${esc(wc.id)}, ${esc(wc.storey)} (most stressed)</h3>`+steps([
      {title:'Axial loads',result:`P<sub>D</sub> = ${f(wc.P.PD,1)} kN, P<sub>L</sub> = ${f(wc.P.PL,1)} kN; earthquake axial ±${f(wc.E.x.P,1)} (X), ±${f(wc.E.y.P,1)} (Y) kN`,
        note:'Earthquake axial from the beam end shears of the frame (sway in each direction).'},
      {title:'Earthquake moments',formula:'column shear V<sub>i</sub> = D<sub>i</sub>/ΣD × V<sub>storey</sub> + torsion; M = V × inflection height (0.6h ground, 0.5h above)',
        result:`M<sub>E</sub> = ${f(wc.E.x.M,1)} kNm (X), ${f(wc.E.y.M,1)} kNm (Y)`},
      {title:'Gravity moments',formula:'unbalanced fixed-end moments of the beams shared to the column by stiffness',result:`X: ${f(wc.Mg.x.MD,1)} D + ${f(wc.Mg.x.ML,1)} L; Y: ${f(wc.Mg.y.MD,1)} D + ${f(wc.Mg.y.ML,1)} L kNm`},
      {title:'Minimum eccentricity',formula:'e<sub>min</sub> = l/500 + D/30 ≥ 20 mm',result:`${f(wc.emin,1)} mm`,ref:IS456.axial},
      {title:'Governing combination',result:`${esc(cb.name)}: P<sub>u</sub> = ${f(cb.Pu,1)} kN, M<sub>ux</sub> = ${f(cb.Mx,1)}, M<sub>uy</sub> = ${f(cb.My,1)} kNm`,ref:NBC105.combosLSM},
      {title:'Section capacity',formula:'strain compatibility, IS 456 stress block (0.446f<sub>ck</sub>, ε<sub>cu</sub> 0.0035), bars on four faces; P<sub>uz</sub> = 0.45f<sub>ck</sub>A<sub>c</sub> + 0.75f<sub>y</sub>A<sub>sc</sub>',
        result:`M<sub>u1</sub> = ${f((wc.worst?.cap?.Mu||0)/1e6,1)} kNm at P<sub>u</sub>; P<sub>uz</sub> = ${f((wc.worst?.Puz||0)/1e3,0)} kN; α<sub>n</sub> = ${f(wc.worst?.an,2)}`,ref:IS456.axial},
      {title:'Biaxial interaction',formula:'(M<sub>ux</sub>/M<sub>ux1</sub>)<sup>α<sub>n</sub></sup> + (M<sub>uy</sub>/M<sub>uy1</sub>)<sup>α<sub>n</sub></sup> ≤ 1',result:`${f(wc.worst?.ratio,3)} with <b>${esc(wc.label)}</b> ${badge(wc.ok)}`,ref:IS456.axial},
      {title:'Longitudinal steel limits',formula:'1 % ≤ ρ ≤ 4 %, ≥ 8 bars, ≥ 12 mm',result:'enforced in the bar choice',ref:ANNEX_A.colLong},
    ])+`<details open><summary><b>Column schedule</b></summary>`+table(['Storey','Column','P<sub>D</sub> / P<sub>L</sub> (kN)','Governing','P<sub>u</sub> (kN)','M<sub>ux</sub> / M<sub>uy</sub> (kNm)','Ratio','Bars',''],
      r.columns.map(c=>[esc(c.storey),esc(c.id),`${f(c.P.PD,0)} / ${f(c.P.PL,0)}`,esc(c.worst?.combo?.name),f(c.worst?.combo?.Pu,0),
        `${f(c.worst?.combo?.Mx,1)} / ${f(c.worst?.combo?.My,1)}`,f(c.worst?.ratio,2),esc(c.label),badge(c.ok)]),'small')+'</details>'+
    `<h3>Confinement and ties</h3>${cite(ANNEX_A.confinement)}`+table(['Storey','l<sub>o</sub> = max(D, l<sub>c</sub>/6, 450)','Spacing in l<sub>o</sub> = min(B/4, 8d<sub>b</sub>, 100)','A<sub>sh</sub> = max(0.18 s h f<sub>ck</sub>/f<sub>y</sub>(A<sub>g</sub>/A<sub>cc</sub> − 1), 0.05 s h f<sub>ck</sub>/f<sub>y</sub>)','Hoop','Elsewhere'],
      r.details.map(d=>[esc(d.storey),`${d.lo} mm`,`${d.s} mm`,`${f(d.AshReq,1)} mm² (h = ${f(d.hLink,0)} mm)`,`${d.dia}φ${d.crossTie?' + cross-ties':''}`,`@ ${d.midSpacing} mm`]))+
    `<p class="note">Hoops: 135° hooks with 6d (≥ 65 mm) extension ${cite(ANNEX_A.colShear)}; confinement continues 300 mm into the footing; laps only in the central half of the column ${cite(ANNEX_A.laps)}.</p>`);

  // 13 Joints
  const jn=r.joints.filter(x=>!x.roof);
  const minR=jn.reduce((a,b)=>b.ratio<a.ratio?b:a,jn[0]||{ratio:Infinity});
  add('joints','13. Strong column – weak beam and beam-column joints',
    `<p>ΣM<sub>c</sub> ≥ 1.2 ΣM<sub>b</sub> at every joint below the roof ${cite(ANNEX_A.scwb)}. Lowest ratio ΣM<sub>c</sub>/ΣM<sub>b</sub> = <b>${f(minR.ratio,2)}</b> at ${esc(minR.id)} (${esc(minR.level)}, ${minR.dir?.toUpperCase()}). ${badge(r.summary.scwbOk)}</p>`+
    `<details><summary><b>Joint table</b></summary>`+`<p>Joint shear ${cite(ANNEX_A.joint)}: V<sub>jh</sub> = 1.25f<sub>y</sub>(A<sub>st1</sub>+A<sub>st2</sub>) − V<sub>col</sub> (interior), 1.25f<sub>y</sub>A<sub>st1</sub> − V<sub>col</sub> (exterior);
      V<sub>jc</sub> = 1.5/1.2/1.0 A<sub>ej</sub>√f<sub>ck</sub> for 4/3/other confined faces, b<sub>j</sub> = min(b<sub>b</sub>, b<sub>c</sub>). Where V<sub>jc</sub> &lt; V<sub>jh</sub>, horizontal joint steel A<sub>jh</sub> = (V<sub>jh</sub> − V<sub>jc</sub>)/f<sub>y</sub> is provided.</p>`+
    table(['Level','Column','Dir','ΣM<sub>c</sub> / ΣM<sub>b</sub> (kNm)','Ratio','Faces','V<sub>jh</sub> / V<sub>jc</sub> (kN)','A<sub>jh</sub> (mm²)','l<sub>dh</sub> / available (mm)'],
      r.joints.map(x=>[esc(x.level),esc(x.id),x.dir.toUpperCase(),`${f(x.Mc,0)} / ${f(x.Mb,0)}`,x.roof?'roof — waived':`${f(x.ratio,2)} ${badge(x.scwbOk)}`,x.faces,
        `${f(x.Vjh,0)} / ${f(x.Vjc,0)}`,x.Ajh?f(x.Ajh,0):'—',x.interior?'interior':`${f(x.ldh,0)} / ${f(x.avail,0)} ${badge(x.anchorOk,{warn:true,text:x.anchorOk?'OK':'beam stub'})}`]),'small')+'</details>'+
    `<p class="note">Exterior joints: l<sub>dh</sub> = f<sub>y</sub>d<sub>b</sub>/(4.85√f<sub>ck</sub>) with a 12d<sub>b</sub> hook ${cite(ANNEX_A.anchorage)}; where it does not fit, extend the beam as a stub (Fig 4-12). Straight development lengths per Table 4.3 ${cite(ANNEX_A.devLength)}.</p>`);

  // 14 Footings
  const wf=r.footings.reduce((a,b)=>b.serv>a.serv?b:a);
  add('footings','14. Isolated footings',steps([
    {title:'Bearing (service)',formula:'B² ≥ 1.1 (P<sub>D</sub>+P<sub>L</sub>)/q<sub>a</sub>; seismic DL+0.3LL+0.7E with M at 0.7E, q ≤ 1.5 q<sub>a</sub>',sub:`worst ${esc(wf.id)}: 1.1 × ${f(wf.serv,1)} / ${r.sbc}`,result:`B = ${wf.B} mm`,ref:NBC105.bearingRef},
    {title:'Punching shear at d/2',formula:'τ<sub>v</sub> = q<sub>u</sub>(B² − (c+d)²)/(4(c+d)d) ≤ 0.25√f<sub>ck</sub>',sub:`${f(wf.punch,3)} ≤ ${f(wf.tp,3)} MPa`,result:`D = ${wf.D} mm (d = ${wf.d} mm)`,ref:IS456.footing},
    {title:'One-way shear at d',formula:'τ<sub>v</sub> ≤ τ<sub>c</sub>',sub:`${f(wf.oneWay,3)} ≤ ${f(wf.tc,3)} MPa`,result:'OK',ref:IS456.shear},
    {title:'Bending at the column face',formula:'M<sub>u</sub> = q<sub>u</sub>B((B−c)/2)²/2',sub:`${f(wf.Mu/1e6,1)} kNm`,result:`A<sub>st</sub> = ${f(wf.Ast,0)} mm² → ${wf.bar.dia}φ @ ${wf.bar.spacing} mm both ways`,ref:IS456.flexure},
  ])+table(['Column','Service P (kN)','Seismic P (kN)','B × B (mm)','D (mm)','Bars both ways'],
    r.footings.map(x=>[esc(x.id),f(x.serv,0),f(x.seis,0),`${x.B} × ${x.B}`,x.D,`${x.bar.dia}φ @ ${x.bar.spacing}`]),'small')+
    `<p>Tie/plinth beams in both directions for axial ${f(r.tieForce,1)} kN (10 % of the largest footing load under seismic conditions) ${cite(NBC105.foundationTieRef)}.</p>`);

  // 15 Stability, separation
  add('stability','15. Overall stability and separation',table(['Direction','Overturning ΣF<sub>i</sub>h<sub>i</sub> (kNm)','Resisting 0.9W·b/2 (kNm)','Factor',''],
    r.stability.map(x=>[x.dir.toUpperCase(),f(x.Mo,0),f(x.Mr,0),f(x.fos,2),badge(x.ok)]))+cite(NBC105.stabilityRef)+
    `<p>ULS roof displacement: ${r.roofDisp.map(x=>`${x.dir.toUpperCase()} ${f(x.uls*1000,0)} mm`).join(', ')}. Gap to an adjacent building on the same site Δ<sub>gap</sub> = √(Δ<sub>1</sub>² + Δ<sub>2</sub>²) ${cite(NBC105.separationRef)} — this building's share is Δ<sub>1</sub> above.</p>`);

  // 16 IS 1893 cross-check
  add('is1893','16. IS 1893 (Part 1):2016 cross-check (information only)',
    `<p>NBC 105:2025 governs. IS 1893 zoning does not cover Nepal; the comparison takes the NBC Z as the design-basis PGA (Z/2 in IS terms) with R = 5 (SMRF).</p>`+
    table(['Dir','Base dimension d (m)','T<sub>a</sub> = 0.09h/√d (infilled)','T<sub>a</sub> = 0.075h<sup>0.75</sup> (bare)','IS soil','S<sub>a</sub>/g','A<sub>h</sub>','NBC C<sub>d</sub>'],
      an.isCheck.map(x=>[x.dir.toUpperCase(),f(x.d),`${f(x.Tinfill,3)} s`,`${f(x.Tbare,3)} s`,x.soilType,f(x.SaG,2),f(x.AhUsingNbcZ,4),f(x.nbcCd,4)]))+
    `${cite(IS1893.periodInfill)} ${cite(IS1893.spectrum)}`);

  // 17 Limitations
  add('limits','17. Limitations — what a licensed engineer must still do',`<ul>
    <li>This is an automated preliminary calculation from a spatial hypothesis. It is <b>not</b> a stamped design, permit drawing or construction document.</li>
    <li>Frame analysis uses the D-value (Muto) method and tributary areas, not a 3D finite-element model. NBC 205 cl 6.4 expects a 3D bare-frame model with rigid diaphragms; run one (ETABS/SAP/STAAD) and compare.</li>
    <li>IS 456 and IS 875 (or NBC 102/103) are not in the supplied files: verify the member-strength formulas, unit weights and live loads against official copies.</li>
    <li>Site soil type and bearing capacity need a soil investigation (NBC 105 Table 4-2; NBC 205 cl 3.3–3.5). The underground reservoir, retaining walls, slabs, staircase reinforcement and parapet anchorage are not designed here.</li>
    <li>Municipal adoption of NBC 105:2025 and local requirements must be confirmed with the municipality.</li></ul>`);

  const srcs=Object.entries(SOURCES).map(([id,s])=>`<li><b>${esc(SHORT[id])}</b> — ${esc(s.title)}${s.file?` · <code>${esc(s.file)}</code> · sha256 ${esc(s.sha256.slice(0,12))}…`:' · <i>not supplied</i>'} · ${esc(s.status.replace(/_/g,' '))}</li>`).join('');
  const toc=sec.map(s=>{const m=s.match(/<section id="([^"]+)"><h2>([^<]+)<\/h2>/);return m?`<a href="#${m[1]}">${m[2]}</a>`:'';}).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Structural calculation — ${esc(option)}</title><style>
:root{--ink:#1d2327;--muted:#5b6670;--line:#d9dee2;--ok:#1f7a3d;--bad:#b3261e;--warn:#9a6700;--bg:#fff;--soft:#f5f7f8}
@media (prefers-color-scheme:dark){:root{--ink:#e6eaed;--muted:#a3adb5;--line:#3a4247;--bg:#15191c;--soft:#1e2428}}
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg);margin:0;padding:16px;max-width:1100px;margin-inline:auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;border-bottom:2px solid var(--line);padding-bottom:4px;margin-top:32px}h3{font-size:15px;margin:18px 0 6px}
.banner{background:#fbe9e7;color:#7a1b12;border:1px solid #e8b4ad;padding:8px 12px;border-radius:6px;font-weight:600}
@media (prefers-color-scheme:dark){.banner{background:#3b1c19;color:#f3c1ba;border-color:#6e3029}}
table{border-collapse:collapse;width:100%;margin:8px 0;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
th{background:var(--soft);font-weight:600}table.small{font-size:12px}
.b{display:inline-block;padding:0 6px;border-radius:4px;font-size:12px;font-weight:700;color:#fff}.b.ok{background:var(--ok)}.b.bad{background:var(--bad)}.b.warn{background:var(--warn)}
.ref{display:inline-block;margin-left:6px;font-size:12px;color:var(--muted)}.tag{font-size:12px;color:var(--muted)}.tag.not_supplied_verify,.tag.assumed{color:var(--warn);font-weight:600}
ol.steps{padding-left:34px}ol.steps li{margin:8px 0;padding:6px 8px;background:var(--soft);border-radius:6px}.fx{font-family:Georgia,serif}.sub{color:var(--muted)}.res{font-weight:600}.note{font-size:12px;color:var(--muted)}
nav{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px;margin:10px 0}a{color:inherit}.lead{font-size:15px}
@media print{nav{display:none}section{break-inside:avoid-page}}
</style></head><body>
<h1>Structural calculation — residential RC frame</h1>
<div>${esc(option)} · ${esc(model.candidate.id)} · ${esc(j.municipality||'')}${j.ward?`, Ward ${esc(j.ward)}`:''} · ${esc(date)}</div>
<p class="banner">PRELIMINARY — FOR ENGINEER REVIEW ONLY. Not for construction or permit. Prepared automatically; checked by: — NEC no.: — signature: —</p>
<nav>${toc}</nav>
<details><summary>Code sources used</summary><ul>${srcs}</ul></details>
${sec.join('\n')}
</body></html>`;
}

module.exports={renderStructuralReport};
