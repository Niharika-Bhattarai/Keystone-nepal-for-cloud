import React, { useEffect, useRef } from 'react';
import { computeElevationCardScale, computeScaleBaseFt, getElevationViews, resolveElevationSpanFt } from '../lib/elevations.js';
import { extractPrimaryNumber } from '../lib/format.js';
import { prepareSequence, playSequence, finishSequence, prefersReducedMotion } from '../lib/planSequence.js';
import { safeSvg } from '../lib/safeSvg.js';

export const BlueprintPresentationSheet = ({ planSvg, elevations, formData, footprintInfo, renderImage, planSpec }) => {
    /* The plan arrives the same way it does on the landing page: drawn
       rather than pasted in. It is the same module, so the studio and
       the hero cannot drift apart.

       It runs once per distinct drawing. Keying the effect on planSvg
       means switching between Rendered and Normal, or to an alternative
       layout, replays it - which is right, because that IS a different
       drawing - while a re-render for any other reason does not. */
    const planRef = useRef(null);
    const sheetRef = useRef(null);
    const cancelRef = useRef(null);

    useEffect(() => {
        const host = planRef.current;
        if (!host) return undefined;
        const svg = host.querySelector('svg');
        if (!svg) return undefined;

        let beats;
        try {
            ({ beats } = prepareSequence(svg));
        } catch {
            return undefined;   // never let the animation cost the drawing
        }
        if (!beats.length) return undefined;

        if (prefersReducedMotion()) {
            finishSequence(svg, beats);
            return undefined;
        }
        void svg.getBoundingClientRect();
        // The sheet goes black for the build and blooms back with the
        // drawing, exactly as the hero does.
        const sheet = sheetRef.current;
        sheet?.classList.add('seq-dark');
        cancelRef.current = playSequence(svg, beats, {
            speed: 2,
            onReveal: () => sheet?.classList.remove('seq-dark'),
        });
        return () => {
            cancelRef.current?.();
            cancelRef.current = null;
            sheet?.classList.remove('seq-dark');
        };
    }, [planSvg]);

    if (!planSvg) return null;
    const views = getElevationViews(elevations);
    const showSideRail = views.length > 0 || !!renderImage;
    const scaleBaseFt = computeScaleBaseFt({ planSpec, footprintInfo, views });
    const area = extractPrimaryNumber(formData?.totalArea, footprintInfo?.widthFt && footprintInfo?.heightFt ? String(footprintInfo.widthFt * footprintInfo.heightFt) : '');
    const styleLabel = elevations?.meta?.styleLabel || formData?.materials || 'Residential';
    const roofKind = String(elevations?.meta?.roofKind || 'gabled').replace(/_/g, ' ');
    const facing = String(formData?.frontFacing || elevations?.meta?.frontEdge || '').trim();
    const summaryBits = [
        area ? `${area} SQ FT` : null,
        formData?.bedrooms ? String(formData.bedrooms).toUpperCase() : null,
        formData?.bathrooms ? String(formData.bathrooms).toUpperCase() : null,
        facing ? `${facing.toUpperCase()} FACING` : null,
    ].filter(Boolean);

    return (
        <div style={{
            background:'var(--surface-1)',
            border:'1px solid rgba(120,102,82,0.18)',
            borderRadius:24,
            padding:24,
            boxShadow:'0 24px 60px rgba(0,0,0,0.14)',
            width: showSideRail ? 1480 : 'auto',
        }}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:20,marginBottom:18}}>
                <div>
                    <div className="cg" style={{fontSize:'2rem',lineHeight:0.94,letterSpacing:'-0.05em',textTransform:'uppercase',color:'var(--ink)',marginTop:6}}>
                        Plan, Elevations + Exterior Render
                    </div>
                    <div className="mono" style={{fontSize:10,letterSpacing:'0.16em',textTransform:'uppercase',color:'var(--ink-soft)',marginTop:8}}>
                        {summaryBits.join('  |  ') || 'Residential concept set'}
                    </div>
                </div>
                <div className="mono" style={{fontSize:10,letterSpacing:'0.14em',textTransform:'uppercase',textAlign:'right',color:'var(--ink-soft)',lineHeight:1.7}}>
                    <div>{styleLabel}</div>
                    <div>{roofKind}</div>
                </div>
            </div>

            <div style={{
                display:'grid',
                gridTemplateColumns: showSideRail ? 'minmax(0,1fr) 392px' : 'minmax(0,1fr)',
                gap:20,
                alignItems:'start',
            }}>
                <div ref={sheetRef} style={{
                    background:'var(--surface-1)',
                    border:'1px solid rgba(120,102,82,0.12)',
                    borderRadius:18,
                    padding:18,
                    boxShadow:'inset 0 0 0 1px rgba(255,255,255,0.6)',
                }}>
                    {/* Keyed on the drawing itself so React replaces the node
                        rather than diffing into it. The effect then always
                        runs against a clean SVG, which makes the replay on
                        every view switch deterministic instead of dependent
                        on how innerHTML happens to be reconciled. */}
                    <div
                        key={`${planSvg.length}:${planSvg.charCodeAt(2000) || 0}`}
                        className="presentation-plan-svg seq-surface"
                        ref={planRef}
                        dangerouslySetInnerHTML={{__html: safeSvg(planSvg, 'sheet-plan')}}
                    />
                </div>

                {showSideRail ? (
                    <div style={{display:'flex',flexDirection:'column',gap:12}}>
                        {renderImage ? (
                            <div style={{
                                background:'var(--surface-1)',
                                border:'1px solid rgba(120,102,82,0.12)',
                                borderRadius:16,
                                padding:'12px 12px 10px',
                                minHeight:218,
                                display:'flex',
                                flexDirection:'column',
                                gap:8,
                                boxShadow:'inset 0 0 0 1px rgba(255,255,255,0.58)',
                            }}>
                                <div className="mono" style={{fontSize:8,letterSpacing:'0.18em',textTransform:'uppercase',color:'var(--ink-soft)'}}>
                                    Exterior render
                                </div>
                                <img
                                    src={renderImage}
                                    alt="Exterior render preview"
                                    style={{
                                        width:'100%',
                                        height:220,
                                        objectFit:'cover',
                                        borderRadius:12,
                                        border:'1px solid rgba(120,102,82,0.12)',
                                    }}
                                />
                            </div>
                        ) : null}

                        {views.length ? (
                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                                {views.map(view => {
                                    const viewSpanFt = resolveElevationSpanFt({ viewKey: view.key, planSpec, footprintInfo });
                                    const targetScale = computeElevationCardScale({
                                        spanFt: viewSpanFt,
                                        scaleBaseFt,
                                        availableWidthPx: 180,
                                    });
                                    return (
                                    <div key={view.key} style={{
                                        background:'var(--surface-1)',
                                        border:'1px solid rgba(120,102,82,0.12)',
                                        borderRadius:16,
                                        padding:'12px 12px 10px',
                                        minHeight:176,
                                        display:'flex',
                                        flexDirection:'column',
                                        gap:8,
                                        boxShadow:'inset 0 0 0 1px rgba(255,255,255,0.58)',
                                    }}>
                                        <div className="mono" style={{fontSize:8,letterSpacing:'0.18em',textTransform:'uppercase',color:'var(--ink-soft)'}}>
                                            {view.label} elevation
                                        </div>
                                        <div className="mono" style={{fontSize:7,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--ink-soft)'}}>
                                            {Math.round(viewSpanFt)}' span (plan-scale)
                                        </div>
                                        <div
                                            className="presentation-elevation-svg"
                                            style={{
                                                flex:1,
                                                display:'flex',
                                                alignItems:'center',
                                                justifyContent:'center',
                                            }}
                                        >
                                            <div
                                                style={{ width:`${targetScale.widthPct}%`, maxWidth:'100%' }}
                                                dangerouslySetInnerHTML={{__html: safeSvg(elevations[view.key], `sheet-elev-${view.key}`)}}
                                            />
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
};
