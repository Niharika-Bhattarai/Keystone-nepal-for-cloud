import React, { useMemo, useRef, useState } from 'react';
import { segmentsToVertices, closure, corners, area, selfIntersects, closingSegment, verticesToSegments, rapd }
    from './plotSketch.js';

/* CAD-like plot sketch for the survey. Enter each boundary side as a length and
   an angle (the inside corner angle, or the direction of the side), or click
   on the grid to place corners. The sketch shows corner letters, side lengths,
   the closing gap, area and crossing checks, and hands the corners (metres) to
   the brief as a surveyed polygon. */

const LETTERS = 'ABCDEFGHIJKLMNOP';
const MAX_SIDES = 16;
const VIEW = 320;

export default function PlotSketcher({ initial, northBearing = 90, onApply }) {
    const [mode, setMode] = useState(initial?.mode || 'interior');
    const [unit, setUnit] = useState(initial?.unit || 'm');
    const [sides, setSides] = useState(initial?.sides?.length ? initial.sides : [
        { length: '12', angle: '0' }, { length: '10', angle: '90' }, { length: '12', angle: '90' }]);
    const [clickMode, setClickMode] = useState(false);
    const svg = useRef(null);

    // One length unit for the whole sketch, as on a survey sheet.
    const numeric = sides.map(s => ({ length: Number(s.length), unit, angle: Number(s.angle) }));
    const points = useMemo(() => segmentsToVertices(numeric, mode), [JSON.stringify(numeric), mode]); // eslint-disable-line react-hooks/exhaustive-deps
    const gap = closure(points), plot = corners(points);
    const closed = gap.closed && plot.length >= 3;
    const crossing = plot.length >= 4 && selfIntersects(plot);
    const m2 = closed ? area(plot) : 0;

    // Fit the drawing into the square view with a 10% margin.
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 1), minY = Math.min(...ys, 0), maxY = Math.max(...ys, 1);
    const size = Math.max(maxX - minX, maxY - minY, 5) * 1.25;
    const ox = (minX + maxX) / 2 - size / 2, oy = (minY + maxY) / 2 - size / 2;
    const sx = x => (x - ox) / size * VIEW, sy = y => VIEW - (y - oy) / size * VIEW;
    const gridStep = size > 60 ? 5 : 1;

    const fromMetres = m => Math.round((unit === 'ft' ? m / 0.3048 : m) * 1000) / 1000;
    const update = (i, key, value) => setSides(prev => prev.map((s, j) => j === i ? { ...s, [key]: value } : s));
    const addSide = () => sides.length < MAX_SIDES && setSides(prev => [...prev, { length: '', angle: mode === 'interior' ? '90' : '' }]);
    const closeIt = () => {
        const last = closingSegment(numeric, mode);
        if (last && sides.length < MAX_SIDES) setSides(prev => [...prev, { length: String(fromMetres(last.length)), angle: String(last.angle) }]);
    };
    const onCanvasClick = e => {
        if (!clickMode || sides.length >= MAX_SIDES) return;
        const r = svg.current.getBoundingClientRect();
        const x = ox + (e.clientX - r.left) / r.width * size, y = oy + (1 - (e.clientY - r.top) / r.height) * size;
        const snap = v => Math.round(v * 10) / 10; // 0.1 m snap
        const pts = [...points, { x: snap(x), y: snap(y) }];
        setSides(verticesToSegments(pts, mode).map(s => ({ length: String(fromMetres(s.length)), angle: String(s.angle) })));
    };

    const a = (northBearing || 0) * Math.PI / 180;
    return <div style={{ border: '1px solid var(--control-edge)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <div className="studio-item-title" style={{ marginBottom: 6 }}>Draw the plot</div>
        <p className="studio-empty-note">Start at corner A. Side 1 runs along the bottom (east–west line of the sketch). Enter each side's length and the inside angle at its starting corner (90° for a square corner), or switch to directions. You can also click on the grid to place corners.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
            <label style={{ display: 'grid', gap: 4 }}>Angle entry
                <select value={mode} onChange={e => {
                    const next = e.target.value;
                    setSides(verticesToSegments(points, next).map(s => ({ length: String(fromMetres(s.length)), angle: String(s.angle) })));
                    setMode(next);
                }}>
                    <option value="interior">Inside corner angle (°)</option>
                    <option value="direction">Direction of side (° counter-clockwise from side 1)</option>
                </select>
            </label>
            <label style={{ display: 'grid', gap: 4 }}>Length unit (all sides)
                <select value={unit} onChange={e => setUnit(e.target.value)}><option value="m">metres</option><option value="ft">feet</option></select>
            </label>
        </div>
        <svg ref={svg} viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label="Plot sketch" onClick={onCanvasClick}
            style={{ width: '100%', aspectRatio: '1', background: '#fbfbf8', border: '1px solid var(--control-edge)', borderRadius: 6, margin: '10px 0', cursor: clickMode ? 'crosshair' : 'default' }}>
            {Array.from({ length: Math.ceil(size / gridStep) + 2 }, (_, i) => {
                const gx = Math.floor(ox / gridStep) * gridStep + i * gridStep, gy = Math.floor(oy / gridStep) * gridStep + i * gridStep;
                return <g key={i}><line x1={sx(gx)} y1={0} x2={sx(gx)} y2={VIEW} stroke="#e6e6e0" strokeWidth="0.6"/>
                    <line x1={0} y1={sy(gy)} x2={VIEW} y2={sy(gy)} stroke="#e6e6e0" strokeWidth="0.6"/></g>;
            })}
            {closed && <polygon points={plot.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill={crossing ? '#f8dcd8' : '#e7efe2'} stroke="none"/>}
            {points.slice(1).map((p, i) => {
                const q = points[i], mx = (sx(p.x) + sx(q.x)) / 2, my = (sy(p.y) + sy(q.y)) / 2;
                const len = Math.hypot(p.x - q.x, p.y - q.y);
                return <g key={i}><line x1={sx(q.x)} y1={sy(q.y)} x2={sx(p.x)} y2={sy(p.y)} stroke="#1f2a30" strokeWidth="2"/>
                    <text x={mx} y={my - 4} fontSize="9" textAnchor="middle" fill="#1f2a30">{i + 1}: {len.toFixed(2)} m</text></g>;
            })}
            {!gap.closed && points.length > 2 && <line x1={sx(points.at(-1).x)} y1={sy(points.at(-1).y)} x2={sx(0)} y2={sy(0)}
                stroke="#b3261e" strokeWidth="1.2" strokeDasharray="4 3"/>}
            {plot.map((p, i) => <g key={i}><circle cx={sx(p.x)} cy={sy(p.y)} r="3.2" fill="#fff" stroke="#1f2a30" strokeWidth="1.2"/>
                <text x={sx(p.x) + 5} y={sy(p.y) - 5} fontSize="10" fontWeight="700">{LETTERS[i]}</text></g>)}
            <g transform={`translate(${VIEW - 28},28)`}><circle r="16" fill="#fff" stroke="#1f2a30" strokeWidth="0.8"/>
                <line x1={-Math.cos(a) * 12} y1={Math.sin(a) * 12} x2={Math.cos(a) * 12} y2={-Math.sin(a) * 12} stroke="#1f2a30" strokeWidth="1.4"/>
                <text x={Math.cos(a) * 21} y={-Math.sin(a) * 21 + 3} fontSize="9" textAnchor="middle" fontWeight="700">N</text></g>
        </svg>
        <div role="status" style={{ fontSize: 12, marginBottom: 8 }}>
            {closed
                ? <>Closed plot, {plot.length} corners. Area <strong>{m2.toFixed(2)} m²</strong> ({(m2 / 0.09290304).toFixed(0)} sq ft, {rapd(m2)} ropani-aana-paisa-daam).</>
                : <>Not closed yet: the last corner is <strong>{gap.gapM.toFixed(2)} m</strong> from A. Add sides or use “Close the plot”.</>}
            {crossing && <div style={{ color: '#b3261e' }}>The boundary crosses itself. Check the angles and lengths.</div>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '62px 1fr 1fr', gap: '4px 6px', fontSize: 12, alignItems: 'center' }}>
            <strong>Side</strong><strong>Length ({unit})</strong><strong>{mode === 'interior' ? 'Corner °' : 'Direction °'}</strong>
            {sides.map((s, i) => {
                const to = closed && i === sides.length - 1 ? 0 : i + 1;
                return <React.Fragment key={i}>
                    <span>{i + 1}: {LETTERS[i]}–{LETTERS[to] || '?'}
                        <button type="button" aria-label={`Remove side ${i + 1}`} onClick={() => setSides(prev => prev.filter((_, j) => j !== i))}
                            style={{ marginLeft: 4, border: 'none', background: 'none', color: '#b3261e', cursor: 'pointer', padding: 0 }}>×</button></span>
                    <input aria-label={`Side ${i + 1} length`} type="number" step="any" value={s.length} onChange={e => update(i, 'length', e.target.value)}
                        style={{ width: '100%', minWidth: 0, padding: '4px 6px' }}/>
                    {mode === 'interior' && i === 0
                        ? <span title="Side 1 sets the base line">—</span>
                        : <input aria-label={`Side ${i + 1} angle`} type="number" step="any" value={s.angle} onChange={e => update(i, 'angle', e.target.value)}
                            style={{ width: '100%', minWidth: 0, padding: '4px 6px' }}/>}
                </React.Fragment>;
            })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            <button type="button" className="studio-btn" onClick={addSide}>Add side</button>
            <button type="button" className="studio-btn" onClick={closeIt} disabled={gap.closed || points.length < 3}>Close the plot</button>
            <button type="button" className="studio-btn" aria-pressed={clickMode} onClick={() => setClickMode(v => !v)}>{clickMode ? 'Stop clicking corners' : 'Click to place corners'}</button>
            <button type="button" className="studio-btn studio-btn-primary" disabled={!closed || crossing}
                onClick={() => onApply({ vertices: plot, sides, mode, unit })}>Use this plot in the brief</button>
        </div>
    </div>;
}
