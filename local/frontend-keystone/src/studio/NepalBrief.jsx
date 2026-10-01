import React, { lazy, Suspense, useEffect, useState } from 'react';
import PlotSketcher from './PlotSketcher.jsx';
import { surveyedPolygon } from './plotSketch.js';

const NepalModel3D = lazy(() => import('./NepalModel3D.jsx'));

const DRAFT_KEY = 'keystone-nepal:brief-v1';
const INITIAL = {
  municipality: 'Kathmandu Metropolitan City', ward: '', shape: 'rectangle', width: '11.25', depth: '11.25',
  vertices: '0, 0\n12, 0\n13, 10\n4, 13\n0, 9', sideLengths: '12, 10.0499, 9.4868, 5.6569, 9',
  declaredArea: '', areaUnit: 'aana', north: '90', northEvidence: '', roadEdge: '0', roadWidth: '4',
  surveyRevision: '', terrain: 'unknown', plinth: 'unknown', floodContext: 'unknown', roadAccess: 'unknown',
  balconies: '', laundry: 'unspecified', roofUse: 'unspecified', accessibility: 'none', utilities: 'unspecified',
  boundaryNeighbors: ['road', 'unknown', 'unknown', 'unknown'],
  boundaryHeights: ['', '', '', ''], boundarySetbacks: ['', '', '', ''],
  boundaryWindows: ['unknown', 'unknown', 'unknown', 'unknown'],
  storeys: '2.5', floorHeight: '3', partialArea: '50', bikes: '2', cars: '0', stair: 'halfTurnLanding',
  groundReservoirLitres: '8000',
  households: '1', bedrooms: '3', bathrooms: '2', kitchens: '1', livingRooms: '1', puja: true,
  rentFloors: false, rentalFloorCount: '1', rentalStairSide: 'auto', ownerBedrooms: '3', ownerBathrooms: '2', ownerAttachedBathrooms: '1',
  ownerKitchens: '1', ownerLivingRooms: '1', ownerSpecialRooms: 'puja',
  primaryWardrobe: 'standard', otherBedroomWardrobes: false,
  levelOccupancy: ['owner', 'owner', 'owner', 'owner'],
  levelBedrooms: ['0', '3', '0', '0'], levelBathrooms: ['1', '1', '0', '0'],
  levelKitchens: ['1', '0', '0', '0'], levelLivingRooms: ['1', '0', '0', '0'],
  levelSeparateDining: [false, false, false, false],
  levelAttachedBathrooms: ['0', '1', '0', '0'], levelSpecialRooms: ['', '', 'puja', ''],
  levelUses: ['family living', 'bedrooms', 'roof room and terrace access', 'roof room'], vastuProfile: 'Jain-led',
};
const decimal = value => value === '' ? '' : Number(value);
const rooms = value => String(value || '').split(',').map(s => s.trim()).filter(Boolean);
const drawnPlot = form => form.shape === 'surveyedPolygon' && Array.isArray(form.plotVertices) && form.plotVertices.length >= 3;
export function buildNepalSurvey(form) {
  const edgeCount = drawnPlot(form) ? form.plotVertices.length : 4;
  const levels = Array.from({ length: Math.ceil(Number(form.storeys)) }, (_, i) => ({
    id: `level-${i + 1}`, kind: i === Math.ceil(Number(form.storeys)) - 1 && Number(form.storeys) % 1 ? 'partial' : 'full',
    elevation: { value: i * decimal(form.floorHeight), unit: 'm' },
    bedrooms: decimal(form.levelBedrooms[i] ?? ''), bathrooms: decimal(form.levelBathrooms[i] ?? ''),
    kitchens: decimal(form.levelKitchens[i] ?? ''), livingRooms: decimal(form.levelLivingRooms[i] ?? ''),
    separateDiningRoom: Boolean(form.levelSeparateDining?.[i]),
    attachedBathrooms: decimal(form.levelAttachedBathrooms[i] ?? ''),
    occupancy: form.rentFloors ? form.levelOccupancy[i] : 'owner', specialRooms: rooms(form.levelSpecialRooms[i]),
    ...(i === Math.ceil(Number(form.storeys)) - 1 && Number(form.storeys) % 1 ? { targetArea: { value: decimal(form.partialArea), unit: 'sq_m' } } : {}),
    use: form.levelUses[i] || '',
  }));
  const totals = keys => Object.fromEntries(keys.map(key => [key,levels.reduce((sum,level)=>sum+Number(level[key]||0),0)]));
  const ownerLevels=levels.filter(level=>level.occupancy==='owner');
  const ownerTotals=Object.fromEntries(['bedrooms','bathrooms','kitchens','livingRooms','attachedBathrooms']
    .map(key=>[key,ownerLevels.reduce((sum,level)=>sum+Number(level[key]||0),0)]));
  const ownerSpecialRooms=ownerLevels.flatMap(level=>level.specialRooms);
  const site = {
    // A plot drawn in the sketcher is sent as surveyed corner coordinates (metres).
    ...(drawnPlot(form) ? surveyedPolygon(form.plotVertices) : {
      shape: 'rectangle', rectangle: { width: { value: decimal(form.width), unit: 'm' },
        depth: { value: decimal(form.depth), unit: 'm' } } }),
    ...(form.declaredArea !== '' ? { declaredArea: { value: decimal(form.declaredArea), unit: form.areaUnit } } : {}),
    north: { bearingDegrees: decimal(form.north), evidence: form.northEvidence },
    frontageEdges: [{ edgeIndex: decimal(form.roadEdge), roadWidth: { value: decimal(form.roadWidth), unit: 'm' } }],
    boundaries: Array.from({ length: edgeCount }, (_, i) => ({
      neighbor: form.boundaryNeighbors?.[i] || 'unknown',
      ...(form.boundaryHeights?.[i] ? { neighborHeight: { value: decimal(form.boundaryHeights[i]), unit: 'm' } } : {}),
      ...(form.boundarySetbacks?.[i] ? { proposedSetback: { value: decimal(form.boundarySetbacks[i]), unit: 'm' } } : {}),
      neighborHasWindows: form.boundaryWindows?.[i] === 'unknown' || !form.boundaryWindows?.[i]
        ? null : form.boundaryWindows[i] === 'yes',
    })),
    surveyRevision: form.surveyRevision, terrain: form.terrain, plinth: form.plinth,
    floodContext: form.floodContext, roadAccess: form.roadAccess,
  };
  return { jurisdiction: { country: 'NP', municipality: form.municipality, ward: form.ward }, site,
    buildingProgram: { storeys: decimal(form.storeys), levels, households: levels.filter(l=>l.occupancy==='rental').length+1,
      ...totals(['bedrooms','bathrooms','kitchens','livingRooms']), puja: ownerSpecialRooms.includes('puja'),
      rental: { intended: form.rentFloors, floorCount: form.rentFloors ? decimal(form.rentalFloorCount) : 0,
        ...(form.rentFloors ? { access: { type: 'continuousSharedStairOutsideUnits', sidePreference: form.rentalStairSide } } : {}) },
      ownerProgram: { ...ownerTotals, specialRooms: ownerSpecialRooms,
        primaryWardrobe: form.primaryWardrobe, otherBedroomWardrobes: form.otherBedroomWardrobes },
      parking: { bikes: decimal(form.bikes), cars: decimal(form.cars) },
      services: { groundReservoirLitres: decimal(form.groundReservoirLitres), groundReservoirPreference:'underStair' },
      stair: { type: form.stair },
      balconies: rooms(form.balconies), laundry: form.laundry, roofUse: form.roofUse,
      accessibility: form.accessibility, utilities: form.utilities }, vastuProfile: form.vastuProfile };
}
function Field({ label, value, onChange, type = 'text', ...props }) {
  return <label style={{ display: 'grid', gap: 5, fontSize: 12, marginBottom: 10 }}>
    <span>{label}</span><input type={type} value={value} onChange={e => onChange(e.target.value)}
      style={{ width: '100%', padding: '9px 10px', borderRadius: 6, border: '1px solid var(--control-edge)',
        color: 'var(--ink)', background: 'var(--chip-bg)' }} {...props}/>
  </label>;
}
export function NepalBrief() {
  const [form, setForm] = useState(() => {
    try { return { ...INITIAL, ...JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') }; }
    catch { return INITIAL; }
  });
  const [report, setReport] = useState(null);
  const [checking, setChecking] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [massing, setMassing] = useState(null);
  const [massingIndex, setMassingIndex] = useState(0);
  const [structureInputs, setStructureInputs] = useState({ soil: '', sbc: '', columnMm: '', fck: '' });
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch { /* private browser */ } }, [form]);
  const set = key => value => { setForm(prev => ({ ...prev, [key]: value })); setReport(null); setMassing(null); };
  const setLevel = (key, index) => value => { setForm(prev => {
    const next = [...(prev[key] || [])]; next[index] = value; return { ...prev, [key]: next };
  }); setReport(null); };
  async function check() {
    setChecking(true);
    try {
      const res = await fetch('/api/plan/preflight', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surveyData: buildNepalSurvey(form) }) });
      const result = await res.json();
      setReport(result);
    } catch { setReport({ message: 'Could not reach the local preflight server.', blockers: [] }); }
    finally { setChecking(false); }
  }
  async function openMassing() {
    setPreviewing(true);
    try {
      const res = await fetch('/api/nepal/concepts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surveyData: buildNepalSurvey(form), format: 'json' }) });
      const data = await res.json();
      if (!res.ok || !data.candidates?.length) {
        setReport(prev => ({ ...prev, message: data.message || (data.rejectedReasons?.length
          ? `No plan fits this brief yet. Main reasons: ${data.rejectedReasons.join(' · ')}`
          : 'No study massing could be built for this brief.') })); return;
      }
      setMassing(data.candidates); setMassingIndex(0);
    } catch {
      setReport(prev => ({ ...prev, message: 'Could not reach the local review-plan server.' }));
    } finally { setPreviewing(false); }
  }
  async function openDrawingSet(candidateIndex) {
    const tab = window.open('about:blank', '_blank');
    try {
      const res = await fetch('/api/nepal/concepts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surveyData: buildNepalSurvey(form), format: 'drawings', candidateIndex }) });
      if (!res.ok) { tab?.close(); const e = await res.json().catch(() => ({})); setReport(prev => ({ ...prev, message: e.message || 'Could not create the drawing set.' })); return; }
      const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
      if (tab) tab.location.href = url; else window.location.href = url;
    } catch { tab?.close(); setReport(prev => ({ ...prev, message: 'Could not reach the local review-plan server.' })); }
  }
  async function openStructure(candidateIndex) {
    const tab = window.open('about:blank', '_blank');
    try {
      const res = await fetch('/api/nepal/concepts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surveyData: buildNepalSurvey(form), format: 'structure', candidateIndex, structure: structureInputs }) });
      if (!res.ok) { tab?.close(); const e = await res.json().catch(() => ({})); setReport(prev => ({ ...prev, message: e.message || 'Could not run the structural calculation.' })); return; }
      const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
      if (tab) tab.location.href = url; else window.location.href = url;
    } catch { tab?.close(); setReport(prev => ({ ...prev, message: 'Could not reach the local review-plan server.' })); }
  }
  async function downloadDxf(candidateIndex) {
    try {
      const res = await fetch('/api/nepal/concepts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surveyData: buildNepalSurvey(form), format: 'dxf', candidateIndex }) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setReport(prev => ({ ...prev, message: e.message || 'Could not create the AutoCAD file.' })); return; }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = `keystone-nepal-option-${candidateIndex + 1}.dxf`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setReport(prev => ({ ...prev, message: 'Could not reach the local review-plan server.' })); }
  }
  async function openWorkingPlans(spatialStudy=false) {
    const tab=window.open('about:blank','_blank');
    setPreviewing(true);
    try {
      const res=await fetch('/api/nepal/concepts',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({surveyData:buildNepalSurvey(form),spatialStudy})});
      if(!res.ok){
        const error=await res.json();tab?.close();
        setReport(prev=>({...prev,message:error.message||'Could not create the review plans.'}));return;
      }
      const url=URL.createObjectURL(new Blob([await res.text()],{type:'text/html'}));
      if(tab)tab.location.href=url;
      else window.location.href=url;
    }catch{
      tab?.close();setReport(prev=>({...prev,message:'Could not reach the local review-plan server.'}));
    }finally{setPreviewing(false);}
  }
  return <div style={{ padding: 16, color: 'var(--ink)' }}>
    <div className="studio-item-title">Nepal site brief</div>
    <p className="studio-empty-note">Enter a rectangular plot, or draw the plot side by side with lengths and angles. The house itself can have a rectangular, stepped L or courtyard shape. On a side shared with a neighbour's wall, enter a 0 m proposed setback (plot edges section). Check the brief before design.</p>
    <Field label="Municipality" value={form.municipality} onChange={set('municipality')} list="nepal-municipalities"/>
    <datalist id="nepal-municipalities"><option value="Kathmandu Metropolitan City"/><option value="Pokhara Metropolitan City"/></datalist>
    <p className="studio-empty-note">Plans are available for Kathmandu and Pokhara Metropolitan Cities while other municipalities' bylaws are reviewed.</p>
    <Field label="Ward" value={form.ward} onChange={set('ward')} placeholder="Ward number"/>
    <label style={{ display: 'grid', gap: 5, fontSize: 12, marginBottom: 10 }}>Plot shape
      <select value={form.shape === 'surveyedPolygon' ? 'surveyedPolygon' : 'rectangle'} onChange={e => set('shape')(e.target.value)}>
        <option value="rectangle">Rectangle (width × depth)</option>
        <option value="surveyedPolygon">Draw the plot (lines, lengths and angles)</option>
      </select>
    </label>
    {form.shape === 'surveyedPolygon' ? <>
      <PlotSketcher initial={form.plotSketch} northBearing={Number(form.north)}
        onApply={({ vertices, sides, mode, unit }) => { setForm(prev => ({ ...prev, plotVertices: vertices, plotSketch: { sides, mode, unit },
          roadEdge: Number(prev.roadEdge) < vertices.length ? prev.roadEdge : '0' })); setReport(null); setMassing(null); }}/>
      <p className="studio-empty-note">{drawnPlot(form)
        ? `Plot in the brief: ${form.plotVertices.length} corners. Plans use the largest rectangle that fits inside the drawn plot, turned so the road side is at the bottom; the drawings show the real boundary.`
        : 'Draw and close the plot, then press “Use this plot in the brief”.'}</p>
    </> : <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="Plot width (m)" type="number" step="any" value={form.width} onChange={set('width')}/>
        <Field label="Plot depth (m)" type="number" step="any" value={form.depth} onChange={set('depth')}/>
      </div>
      <p className="studio-empty-note">Use the survey orientation: width runs left-right and depth runs bottom-top.</p>
    </>}
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
      <Field label="Recorded plot area (optional)" type="number" step="any" value={form.declaredArea} onChange={set('declaredArea')}/>
      <label style={{ display: 'grid', gap: 5, fontSize: 12, marginBottom: 10 }}>Area unit
        <select value={form.areaUnit} onChange={e => set('areaUnit')(e.target.value)}>
          {['aana', 'ropani', 'paisa', 'daam', 'sq_m', 'sq_ft'].map(unit => <option key={unit}>{unit}</option>)}
        </select>
      </label>
    </div>
    <Field label="True north bearing (counterclockwise from plot rightward axis; 90 = up)" type="number" step="any" value={form.north} onChange={set('north')}/>
    <Field label="Source of north bearing" value={form.northEvidence} onChange={set('northEvidence')} placeholder="e.g. signed survey drawing"/>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      <label style={{ display: 'grid', gap: 5, fontSize: 12, marginBottom: 10 }}>Road-facing plot side on the survey
        <select value={form.roadEdge} onChange={e => set('roadEdge')(e.target.value)}>
          {drawnPlot(form)
            ? form.plotVertices.map((_, i) => <option key={i} value={String(i)}>Side {i + 1} ({'ABCDEFGHIJKLMNOP'[i]}–{'ABCDEFGHIJKLMNOP'[(i + 1) % form.plotVertices.length]})</option>)
            : <><option value="0">Bottom edge</option><option value="1">Right edge</option>
              <option value="2">Top edge</option><option value="3">Left edge</option></>}
        </select>
      </label>
      <Field label="Road width (m)" type="number" step="any" value={form.roadWidth} onChange={set('roadWidth')}/>
    </div>
    <details style={{ marginBottom: 14 }}><summary>Plot edges and site notes for professional review</summary>
    <Field label="Survey drawing revision or date" value={form.surveyRevision} onChange={set('surveyRevision')} placeholder="For later permit review"/>
    <p className="studio-empty-note">Plot edges follow the corner order. Enter neighboring buildings and setbacks where known. Proposed setbacks are recorded here; adopted legal setbacks will be checked after municipality review.</p>
    {Array.from({ length: drawnPlot(form) ? form.plotVertices.length : 4 }, (_, i) =>
      <div key={i} style={{ borderTop: '1px solid var(--control-edge)', paddingTop: 8 }}>
        <strong>Plot edge {i}</strong>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, marginBottom: 10 }}>Neighbor
          <select value={form.boundaryNeighbors?.[i] || 'unknown'} onChange={e => setLevel('boundaryNeighbors', i)(e.target.value)}>
            {['unknown', 'open', 'building', 'road'].map(v => <option key={v}>{v}</option>)}
          </select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Neighbor height (m, if known)" type="number" step="any" value={form.boundaryHeights?.[i] || ''} onChange={setLevel('boundaryHeights', i)}/>
          <Field label="Proposed setback (m, if known)" type="number" step="any" value={form.boundarySetbacks?.[i] || ''} onChange={setLevel('boundarySetbacks', i)}/>
        </div>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, marginBottom: 10 }}>Neighbor has windows facing this edge?
          <select value={form.boundaryWindows?.[i] || 'unknown'} onChange={e => setLevel('boundaryWindows', i)(e.target.value)}>
            {['unknown', 'yes', 'no'].map(v => <option key={v}>{v}</option>)}
          </select>
        </label>
      </div>)}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      <Field label="Terrain / slope" value={form.terrain} onChange={set('terrain')}/>
      <Field label="Plinth / ground level note" value={form.plinth} onChange={set('plinth')}/>
      <Field label="Flood or drainage context" value={form.floodContext} onChange={set('floodContext')}/>
      <Field label="Road entry/access note" value={form.roadAccess} onChange={set('roadAccess')}/>
    </div>
    </details>
    <label style={{ display: 'grid', gap: 5, fontSize: 12, marginBottom: 10 }}>Storeys
      <select value={form.storeys} onChange={e => set('storeys')(e.target.value)}>
        {[1, 2, 2.5, 3, 3.5].map(n => <option key={n}>{n}</option>)}
      </select>
    </label>
    <Field label="Floor-to-floor height (m)" type="number" step="any" value={form.floorHeight} onChange={set('floorHeight')}/>
    {Number(form.storeys) % 1 !== 0 && <Field label="Partial top-floor target area (m²)" type="number" step="any" value={form.partialArea} onChange={set('partialArea')}/>}
    <p className="studio-empty-note">Household and room totals are calculated from the floors below.</p>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 10 }}>
      <input type="checkbox" checked={form.rentFloors} onChange={e => set('rentFloors')(e.target.checked)}/>
      Will you rent out one or more floors?
    </label>
    {form.rentFloors && <>
      <Field label="How many floors will be rented?" type="number" value={form.rentalFloorCount} onChange={set('rentalFloorCount')}/>
      <p className="studio-empty-note">Select each rental floor below. Each rental floor needs its own bedrooms, bathroom, kitchen, living room and entrance from a continuous stair outside the units.</p>
      <label style={{ display: 'grid', gap: 5, fontSize: 12, marginBottom: 10 }}>Preferred stair side
        <select value={form.rentalStairSide} onChange={e => set('rentalStairSide')(e.target.value)}>
          <option value="auto">Choose the best side from the site</option>
          {['north', 'south', 'east', 'west'].map(side => <option key={side}>{side}</option>)}
        </select>
      </label>
      <p className="studio-empty-note">The selected side is a preference. Later design checks must verify access, setbacks, structural continuity and Vaastu.</p>
    </>}
    {Array.from({ length: Math.ceil(Number(form.storeys)) }, (_, i) => <details key={i} open={i===0} style={{ borderTop: '1px solid var(--control-edge)', paddingTop: 8, marginBottom: 10 }}>
      <summary><strong>Level {i + 1}{i === Math.ceil(Number(form.storeys)) - 1 && Number(form.storeys) % 1 ? ' (partial)' : ''}</strong>
        {' - '}{form.rentFloors && form.levelOccupancy[i]==='rental' ? 'rental unit' : 'owner home'}, {form.levelBedrooms[i] || 0} bedrooms</summary>
      {form.rentFloors && <label style={{ display: 'grid', gap: 5, fontSize: 12, marginBottom: 10 }}>Who uses this floor?
        <select value={form.levelOccupancy[i] || 'owner'} onChange={e => setLevel('levelOccupancy', i)(e.target.value)}>
          <option value="owner">Owner household</option><option value="rental">Independent rental unit</option>
        </select>
      </label>}
      <Field label="Use" value={form.levelUses[i] ?? ''} onChange={setLevel('levelUses', i)}/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="Bedrooms" type="number" value={form.levelBedrooms[i] ?? ''} onChange={setLevel('levelBedrooms', i)}/>
        <Field label="Bathrooms" type="number" value={form.levelBathrooms[i] ?? ''} onChange={setLevel('levelBathrooms', i)}/>
        <Field label="Living rooms" type="number" value={form.levelLivingRooms[i] ?? ''} onChange={setLevel('levelLivingRooms', i)}/>
        <Field label="Kitchens" type="number" value={form.levelKitchens[i] ?? ''} onChange={setLevel('levelKitchens', i)}/>
        <Field label="Attached bathrooms" type="number" value={form.levelAttachedBathrooms[i] ?? ''} onChange={setLevel('levelAttachedBathrooms', i)}/>
      </div>
      {Number(form.levelKitchens[i] || 0) > 0 && <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 10 }}>
        <input type="checkbox" checked={Boolean(form.levelSeparateDining?.[i])}
          onChange={e => setLevel('levelSeparateDining', i)(e.target.checked)}/>
        Plan a separate dining room on this floor (default: dining within the kitchen)
      </label>}
      <Field label="Special rooms on this floor (puja, guestBedroom, study, store, laundry)" value={form.levelSpecialRooms[i] ?? ''}
        onChange={setLevel('levelSpecialRooms', i)} placeholder="Comma separated or blank"/>
    </details>)}
    <details style={{ borderTop: '1px solid var(--control-edge)', paddingTop: 10, marginTop: 8 }}>
      <summary>Bedroom wardrobes</summary>
      <p className="studio-empty-note">Only the primary bedroom gets a wardrobe by default.</p>
      <label style={{ display: 'grid', gap: 5, fontSize: 12, marginBottom: 10 }}>Primary bedroom wardrobe
        <select value={form.primaryWardrobe} onChange={e => set('primaryWardrobe')(e.target.value)}>
          <option value="standard">Standard wardrobe</option><option value="walkIn">Walk-in wardrobe</option><option value="none">None</option>
        </select>
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 10 }}>
        <input type="checkbox" checked={form.otherBedroomWardrobes} onChange={e => set('otherBedroomWardrobes')(e.target.checked)}/>
        Add wardrobes to other bedrooms
      </label>
    </details>
    <Field label="Ground-floor water reservoir (litres)" type="number" min="5000" step="500" value={form.groundReservoirLitres} onChange={set('groundReservoirLitres')}/>
    <p className="studio-empty-note">Usually 7,000–10,000 L under the staircase. Minimum 5,000 L for a full delivery truck; excavation and access need professional detailing.</p>
    <details style={{ marginBottom: 12 }}><summary>Parking, services and stair options</summary>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      <Field label="Bikes" type="number" value={form.bikes} onChange={set('bikes')}/>
      <Field label="Cars" type="number" value={form.cars} onChange={set('cars')}/>
    </div>
    <Field label="Balconies: level IDs, comma separated (e.g. level-2)" value={form.balconies} onChange={set('balconies')}/>
    <Field label="Laundry location or needs" value={form.laundry} onChange={set('laundry')}/>
    <Field label="Roof use" value={form.roofUse} onChange={set('roofUse')}/>
    <Field label="Accessibility needs" value={form.accessibility} onChange={set('accessibility')}/>
    <Field label="Water, drainage, electricity or other utility notes" value={form.utilities} onChange={set('utilities')}/>
    <label style={{ display: 'grid', gap: 5, fontSize: 12, marginBottom: 10 }}>Stair type
      <select value={form.stair} onChange={e => set('stair')(e.target.value)}>
        <option value="halfTurnLanding">Half-turn with landing</option><option value="straight">Straight</option>
        <option value="quarterTurnLanding">Quarter-turn with landing</option>
      </select>
    </label>
    </details>
    <p className="studio-empty-note">Vaastu profile: Jain-led. Other interpretations will become available after review.</p>
    <button type="button" className="studio-btn studio-btn-primary" onClick={check} disabled={checking}>
      {checking ? 'Checking…' : 'Check Nepal brief'}
    </button>
    {report && <div role="status" style={{ marginTop: 14, padding: 12, border: '1px solid var(--control-edge)', borderRadius: 8 }}>
      <strong>{report.contractReady ? 'Survey inputs complete' : 'More information needed'}</strong>
      {report.normalizedBrief?.site?.measuredAreaSqM > 0 && <p>Measured plot: {report.normalizedBrief.site.measuredAreaSqM.toFixed(2)} m².</p>}
      <p>{report.contractReady ? 'Your brief is ready for a local spatial-plan review. The drawings use provisional assumptions and are not permit sheets.' : report.message}</p>
      {report.contractReady && <button type="button" className="studio-btn studio-btn-primary" onClick={()=>openWorkingPlans(false)} disabled={previewing}>
        {previewing ? 'Preparing plans…' : 'Open working plan review'}
      </button>}
      {report.contractReady && <button type="button" className="studio-btn" onClick={()=>openWorkingPlans(true)} disabled={previewing}>
        Explore balconies, lightwells and irregular rooms
      </button>}
      {report.contractReady && <button type="button" className="studio-btn" onClick={openMassing} disabled={previewing}>
        View 3D study massing
      </button>}
      {massing && <>
        {massing.length > 1 && <label style={{ display: 'grid', gap: 5, fontSize: 12, marginTop: 10 }}>Hypothesis
          <select value={massingIndex} onChange={e => setMassingIndex(Number(e.target.value))}>
            {massing.map((c, i) => <option key={c.id} value={i}>{i + 1}. {c.id}</option>)}
          </select>
        </label>}
        <button type="button" className="studio-btn" onClick={() => openDrawingSet(massingIndex)}>
          Open A3 review drawing set (plans, elevations, section, schedules, sanitary, roof, structural layout)
        </button>
        <button type="button" className="studio-btn" onClick={() => downloadDxf(massingIndex)}>
          Download AutoCAD drawing (.dxf, millimetres)
        </button>
        <details style={{ margin: '10px 0', fontSize: 12 }}>
          <summary>Structural calculation inputs (optional)</summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <label style={{ display: 'grid', gap: 4 }}>Soil type (NBC 105 Table 4-2)
              <select value={structureInputs.soil} onChange={e => setStructureInputs(v => ({ ...v, soil: e.target.value }))}>
                <option value="">Not tested — use code default</option>
                <option value="A">A — rock</option><option value="B">B — very dense / very stiff</option>
                <option value="C">C — dense / medium dense, stiff</option><option value="D">D — loose / soft</option>
              </select></label>
            <label style={{ display: 'grid', gap: 4 }}>Safe bearing capacity (kN/m²)
              <input type="number" min="50" step="5" placeholder="100 if unknown" value={structureInputs.sbc}
                onChange={e => setStructureInputs(v => ({ ...v, sbc: e.target.value }))}/></label>
            <label style={{ display: 'grid', gap: 4 }}>Column size (mm, starting trial)
              <input type="number" min="300" step="25" placeholder="from layout" value={structureInputs.columnMm}
                onChange={e => setStructureInputs(v => ({ ...v, columnMm: e.target.value }))}/></label>
            <label style={{ display: 'grid', gap: 4 }}>Concrete grade (MPa)
              <select value={structureInputs.fck} onChange={e => setStructureInputs(v => ({ ...v, fck: e.target.value }))}>
                <option value="">Code minimum (M20; M25 above 12 m)</option><option value="20">M20</option><option value="25">M25</option><option value="30">M30</option>
              </select></label>
          </div>
        </details>
        <button type="button" className="studio-btn" onClick={() => openStructure(massingIndex)}>
          Open structural load calculation (NBC 105:2025, step by step)
        </button>
        <Suspense fallback={<p className="studio-empty-note">Loading 3D view…</p>}>
          <NepalModel3D key={massing[massingIndex].id} geometry={massing[massingIndex]}/>
        </Suspense>
      </>}
      {!!report.blockers?.length && <ul>{report.blockers.map((b, i) => <li key={`${b.code}-${i}`}>{b.message} <small>({b.field})</small></li>)}</ul>}
    </div>}
  </div>;
}
