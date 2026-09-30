import React from 'react';
import { getElevationViews } from '../lib/elevations.js';
import { buildPlanExportFilename, svgMarkupToDataUri } from '../lib/format.js';

export const ElevationsPanel = ({ elevations, formData, onOpenPreview }) => {
    const availableViews = getElevationViews(elevations);

    const defaultKey = `${elevations?.meta?.supportViewKey || 'front'}Svg`;
    const [activeKey, setActiveKey] = React.useState(availableViews.some(view => view.key === 'frontSvg') ? 'frontSvg' : (availableViews[0]?.key || null));

    React.useEffect(() => {
        const nextKey = availableViews.some(view => view.key === 'frontSvg') ? 'frontSvg' : (availableViews[0]?.key || defaultKey || null);
        setActiveKey(current => availableViews.some(view => view.key === current) ? current : nextKey);
    }, [elevations]);

    if (!elevations || availableViews.length === 0) return null;

    const activeView = availableViews.find(view => view.key === activeKey) || availableViews[0];
    const activeSvg = elevations?.[activeView?.key] || '';
    const activeSrc = svgMarkupToDataUri(activeSvg);
    const styleLabel = elevations?.meta?.styleLabel || formData?.materials || 'Residential';
    const roofKind = String(elevations?.meta?.roofKind || 'gabled').replace(/_/g, ' ');
    const supportLabel = elevations?.meta?.supportViewKey ? `${elevations.meta.supportViewKey} elevation` : 'side elevation';

    const downloadActive = () => {
        if (!activeSrc) return;
        const link = document.createElement('a');
        link.href = activeSrc;
        link.download = buildPlanExportFilename(formData, `${activeView.label} elevation`, 'svg');
        link.click();
    };

    return (
        <div className="paper-panel">
            <div className="p-4 border-b border-black/5 bg-white/40 flex items-start justify-between gap-3">
                <div>
                    <span className="section-label">Elevations</span>
                    <p className="text-[13px] leading-relaxed mt-2" style={{color:'var(--ink)'}}>
                        Deterministic facade views derived from the plan geometry, vertical model, and survey style.
                    </p>
                </div>
                <div className="mono text-[11px] uppercase tracking-[0.22em] text-right" style={{color:'var(--ink-soft)'}}>
                    {styleLabel}<br/>
                    {roofKind}
                </div>
            </div>
            <div className="p-4">
                <div className="rounded-[18px] border border-black/8 bg-white overflow-hidden shadow-xs">
                    {/* The preview is capped by height, not width: a
                        full-width elevation is most of a screen on its own and
                        pushed everything below it out of reach. Clicking still
                        opens it full size. */}
                    {activeSrc ? (
                        <img
                            src={activeSrc}
                            alt={`${activeView.label} elevation`}
                            className="elevation-preview cursor-zoom-in"
                            onClick={() => onOpenPreview && onOpenPreview(activeSrc)}
                        />
                    ) : (
                        <div className="p-8 text-center text-mid text-[13px]">Elevation preview unavailable.</div>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                    {availableViews.map(view => {
                        const selected = activeView?.key === view.key;
                        return (
                            <button
                                key={view.key}
                                type="button"
                                aria-label={`${view.label} elevation view`}
                                onClick={() => setActiveKey(view.key)}
                                className="px-3 py-2.5 border rounded-[12px] text-left transition-all"
                                style={{
                                    borderColor: selected ? 'var(--d-accent-fill)' : 'var(--d-control-edge)',
                                    /* The unselected state used to fill
                                       rgba(255,255,255,0.9) - a near-white card in
                                       the middle of the dark studio - while its text
                                       kept var(--ink), which the studio remaps to
                                       near-white. That is 1.04:1: four captions that
                                       were not merely low contrast but invisible.
                                       Unselected now matches every other unchosen
                                       control in here. */
                                    background: selected ? 'var(--d-accent-fill)' : 'rgba(255,255,255,0.7)',
                                }}
                            >
                                {/* Selected fills with the ember, so its text flips to
                                    ink. Leaving it light gave 2.25:1 on the orange. */}
                                <div className="mono text-[11px] uppercase tracking-[0.18em]" style={{color:selected?'var(--d-on-fill)':'var(--d-muted)'}}>{view.label} view</div>
                                <div className="text-[13px] mt-1" style={{color:selected?'var(--d-on-fill)':'var(--d-text)'}}>
                                    {view.key === 'frontSvg' ? 'Primary street-facing facade' :
                                     view.key === 'rearSvg' ? 'Rear massing and glazing' :
                                     view.key === 'leftSvg' ? 'Left-side profile' : 'Right-side profile'}
                                </div>
                            </button>
                        );
                    })}
                </div>
                <div className="flex items-center gap-3 mt-3 flex-wrap">
                    <button onClick={downloadActive} className="mono text-[12px] text-blue underline">Download active view</button>
                    <span className="mono text-[11px] uppercase tracking-[0.18em]" style={{color:'var(--ink-soft)'}}>
                        {supportLabel} is also used to ground the Exterior Render.
                    </span>
                </div>
            </div>
        </div>
    );
};
