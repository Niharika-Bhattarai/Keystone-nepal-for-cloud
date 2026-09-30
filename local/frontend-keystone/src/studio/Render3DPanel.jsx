import React, { useEffect, useRef, useState } from 'react';
import { RENDER_REFINEMENTS } from '../data/content.js';
import { buildPlanExportFilename } from '../lib/format.js';
import { composeElevationReferenceSheet, EXPORT_PAPER, svgToPngDataUrl } from '../lib/raster.js';
import { normalizeRenderState } from '../lib/storage.js';
import { RenderSurveyModal } from './RenderSurveyModal.jsx';
import { SmartImage } from '../ui/primitives.jsx';

export const Render3DPanel = ({
    planSpec,
    formData,
    planSvg,
    elevations,
    galleryId,
    onRenderReady,
    onRenderStateSnapshot,
    launchSignal = 0,
    showLaunchButton = true,
    onRenderStatusChange,
    accessToken = null,
    initialState = null,
    resetKey = 0,
    isLocked = false,
    onLockedAction,
}) => {
    const [renderStatus, setRenderStatus] = useState(() => normalizeRenderState(initialState).status); // idle|survey|loading|error|ready
    const [renderImage, setRenderImage] = useState(() => normalizeRenderState(initialState).image || null);
    const [renderImageClean, setRenderImageClean] = useState(() => normalizeRenderState(initialState).imageClean || null); // without watermark, for lighting edits
    const [errorMsg, setErrorMsg] = useState(() => normalizeRenderState(initialState).errorMsg || '');
    const [activeRefinement, setActiveRefinement] = useState(() => normalizeRenderState(initialState).activeRefinement || null);
    const [showSurvey, setShowSurvey] = useState(false);
    const [renderSurveyData, setRenderSurveyData] = useState(() => normalizeRenderState(initialState).surveyData || null);
    const renderRequest = useRef(0);
    useEffect(() => () => { renderRequest.current += 1; }, [planSvg]);
    const launchHandledRef = useRef(launchSignal);
    const ensureAdvancedAccess = React.useCallback((featureLabel = 'Exterior Render') => {
        if (!isLocked) return true;
        onLockedAction?.(featureLabel);
        return false;
    }, [isLocked, onLockedAction]);

    const applyWatermark = (imgSrc) => new Promise((resolve) => {
        const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'), img = new Image();
        img.onload = () => {
            canvas.width = img.width; canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            const barH = Math.max(28, canvas.height * 0.05);
            ctx.fillStyle = '#0B0B0B'; // --ink; a canvas cannot read CSS variables
            ctx.fillRect(0, canvas.height - barH, canvas.width, barH);
            ctx.fillStyle = '#fff';
            ctx.font = `italic ${Math.floor(barH * 0.42)}px serif`;
            ctx.textBaseline = 'middle';
            ctx.fillText('Keystone AI', barH * 0.5, canvas.height - barH / 2);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(imgSrc);
        img.src = imgSrc;
    });

    const doRender = async (renderSurvey, lightingHint = null, existingImageForLighting = null) => {
        const requestId = ++renderRequest.current;
        setRenderStatus('loading');
        setErrorMsg('');
        try {
            const isLightingOnly = !!(lightingHint && existingImageForLighting);
            const elevationSet = elevations || planSpec?.elevations || null;
            const safeRasterize = async (svgMarkup, background = EXPORT_PAPER) => {
                if (!svgMarkup) return null;
                try {
                    return await svgToPngDataUrl(svgMarkup, { background });
                } catch (_) {
                    return null;
                }
            };

            const [planImage, elevationSheetImage] = isLightingOnly
                ? [null, null]
                : await Promise.all([
                    svgToPngDataUrl(planSvg, { background: EXPORT_PAPER, longEdge: 2400 }),
                    composeElevationReferenceSheet(elevationSet),
                ]);

            const payload = {
                surveyData: formData,
                renderSurveyData: renderSurvey || renderSurveyData || {},
                planSpec,
                galleryId,
                lightingHint: lightingHint || null,
                // Pass existing render (without watermark) for lighting-only edits
                existingRenderImage: existingImageForLighting || null,
                // Ground new renders against the generated floor plan image
                planImage,
                elevationSheetImage,
            };

            const res = await fetch('/api/render', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                },
                body: JSON.stringify(payload),
            });

            let data;
            try { data = await res.json(); } catch(_) { data = { success: false, message: 'The exterior render was not created. Try again.' }; }
            if (requestId !== renderRequest.current) return;

            if (!res.ok || !data.success) {
                setErrorMsg(data.message || 'The exterior render was not created. Try again.');
                setRenderStatus('error');
                return;
            }

            const imgSrc = data.image.startsWith('data:') ? data.image : `data:image/jpeg;base64,${data.image}`;
            setRenderImageClean(imgSrc); // store clean copy for future lighting edits
            const watermarked = await applyWatermark(imgSrc);
            if (requestId !== renderRequest.current) return;
            setRenderImage(watermarked);
            setRenderStatus('ready');
            if (onRenderReady) onRenderReady(watermarked);
        } catch(err) {
            if (requestId !== renderRequest.current) return;
            console.error('[render]', err);
            setErrorMsg(err.message || 'Could not reach Keystone AI. Check your connection, then try again.');
            setRenderStatus('error');
        }
    };

    const handleSurveySubmit = (surveyData) => {
        setShowSurvey(false);
        setRenderSurveyData(surveyData);
        setActiveRefinement(null);
        doRender(surveyData, null, null);
    };

    const handleRender = () => {
        if (!ensureAdvancedAccess('Exterior Render')) return;
        setActiveRefinement(null);
        setShowSurvey(true);
    };
    const handleRegenerate = () => {
        if (!ensureAdvancedAccess('Exterior Render')) return;
        setActiveRefinement(null);
        doRender(renderSurveyData, null, null);
    };

    const handleRefinement = (ref) => {
        if (!ensureAdvancedAccess('Exterior Render')) return;
        setActiveRefinement(ref.label);
        // Pass the clean (un-watermarked) existing image so backend can do lighting-only edit
        doRender(renderSurveyData, ref.hint, renderImageClean);
    };

    // Session-restore: apply initialState once on mount only (prevents snapshot feedback loop)
    const _initialApplied = useRef(false);
    useEffect(() => {
        if (_initialApplied.current || !initialState) return;
        _initialApplied.current = true;
        const next = normalizeRenderState(initialState);
        setRenderStatus(next.status);
        setRenderImage(next.image || null);
        setRenderImageClean(next.imageClean || null);
        setErrorMsg(next.errorMsg || '');
        setActiveRefinement(next.activeRefinement || null);
        setRenderSurveyData(next.surveyData || null);
        setShowSurvey(false);
    }, [initialState]);

    // Explicit reset when parent generates a new plan (resetKey increments)
    useEffect(() => {
        if (!resetKey) return;
        setRenderStatus('idle');
        setRenderImage(null);
        setRenderImageClean(null);
        setErrorMsg('');
        setActiveRefinement(null);
        setRenderSurveyData(null);
        setShowSurvey(false);
    }, [resetKey]);

    useEffect(() => {
        if (typeof onRenderStatusChange === 'function') onRenderStatusChange(renderStatus);
    }, [renderStatus, onRenderStatusChange]);

    useEffect(() => {
        if (typeof onRenderStateSnapshot === 'function') {
            onRenderStateSnapshot({
                status: renderStatus,
                image: renderImage,
                imageClean: renderImageClean,
                surveyData: renderSurveyData,
                activeRefinement,
                errorMsg,
            });
        }
    }, [renderStatus, renderImage, renderImageClean, renderSurveyData, activeRefinement, errorMsg, onRenderStateSnapshot]);

    useEffect(() => {
        if (!launchSignal || launchSignal === launchHandledRef.current) return;
        launchHandledRef.current = launchSignal;
        handleRender();
    }, [launchSignal]);

    if (renderStatus === 'idle') return (
        <>
            <RenderSurveyModal isOpen={showSurvey} onClose={() => setShowSurvey(false)} onSubmit={handleSurveySubmit} initialData={renderSurveyData} baseSurveyData={formData} planSpec={planSpec}/>
            {showLaunchButton ? (
                <button onClick={handleRender}
                    className="w-full py-3.5 cta-hero text-[12px]">
                    {isLocked ? 'Unlock Exterior Render' : 'Generate Exterior Render'}
                </button>
            ) : (
                <div className="p-4 rounded-[16px] border border-black/8 bg-white/72">
                    <p className="mono text-[11px] uppercase tracking-[0.22em]" style={{color:'var(--ink-soft)'}}>Exterior render</p>
                    <p className="text-[13px] leading-relaxed mt-2" style={{color:'var(--ink)'}}>
                        {isLocked
                            ? 'Keystone AI Pro generates an exterior render of this plan and lets you download it.'
                            : 'Use the main action bar above to open render options and generate the exterior render from this plan.'}
                    </p>
                </div>
            )}
        </>
    );

    if (renderStatus === 'loading') return (
        <div className="flex flex-col items-center gap-3 py-5">
            <div className="flex items-center gap-3 text-blue">
                <div className="w-4 h-4 border-2 border-blue border-t-transparent rounded-full animate-spin"/>
                <span className="mono text-[12px] uppercase tracking-widest animate-pulse">
                    {activeRefinement ? `Adjusting lighting: ${activeRefinement}...` : 'Rendering exterior view...'}
                </span>
            </div>
            <p className="mono text-[11px] text-mid opacity-50">
                {activeRefinement ? 'Changing lighting only - architecture unchanged' : 'Usually 15-30 seconds'}
            </p>
        </div>
    );

    if (renderStatus === 'error') return (
        <>
            <RenderSurveyModal isOpen={showSurvey} onClose={() => setShowSurvey(false)} onSubmit={handleSurveySubmit} initialData={renderSurveyData} baseSurveyData={formData} planSpec={planSpec}/>
            <div className="p-4 bg-red/5 border border-red/20 rounded-xs">
                <p className="mono text-[12px] font-bold text-red uppercase mb-1">Render Failed</p>
                <p className="text-[12px] text-mid leading-relaxed mb-3" style={{wordBreak:'break-word'}}>{errorMsg}</p>
                <button onClick={() => {
                    if (!ensureAdvancedAccess('Exterior Render')) return;
                    setShowSurvey(true);
                }}
                    className="mono text-[12px] uppercase tracking-widest px-3 py-1.5 bg-ink text-white rounded-xs hover:bg-blue transition-colors">
                    Retry
                </button>
            </div>
        </>
    );

    if (renderStatus === 'ready') return (
        <div>
            <RenderSurveyModal isOpen={showSurvey} onClose={() => setShowSurvey(false)} onSubmit={handleSurveySubmit} initialData={renderSurveyData} baseSurveyData={formData} planSpec={planSpec}/>
            <SmartImage src={renderImage} className="w-full object-cover rounded-[16px] shadow-xl" alt="Exterior render"/>
            {/* Toolbar */}
            <div className="flex items-center gap-2 mt-2 mb-3 flex-wrap">
                <span className="mono text-[11px] uppercase tracking-widest text-mid">
                    {activeRefinement ? `Lighting: ${activeRefinement}` : 'Exterior render'}
                </span>
                <button onClick={() => {
                    if (!ensureAdvancedAccess('Exterior Render')) return;
                    const l=document.createElement('a'); l.href=renderImage; l.download=buildPlanExportFilename(formData, '3d render', 'png'); l.click();
                }}
                    className="ml-auto mono text-[12px] text-blue underline">Download</button>
                <button onClick={handleRegenerate} className="mono text-[12px] text-mid underline">Regenerate</button>
                <button onClick={() => {
                    if (!ensureAdvancedAccess('Exterior Render')) return;
                    setShowSurvey(true);
                }} className="mono text-[12px] text-mid underline">Options</button>
            </div>

            {/* Lighting refinement chips Ã¢â‚¬" lighting only, architecture unchanged */}
            <div className="border-t border-black/5 pt-3">
                <div className="flex items-center justify-between mb-2">
                    <p className="mono text-[11px] uppercase tracking-widest text-mid">Lighting &amp; Mood</p>
                    <p className="mono text-[11px] text-mid/40">Architecture stays unchanged</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                    {RENDER_REFINEMENTS.map(ref => (
                        <button key={ref.label}
                            onClick={() => handleRefinement(ref)}
                            className="flex items-center gap-1.5 px-3 py-1.5 border rounded-xs transition-all mono text-[12px] font-bold uppercase tracking-wide"
                            style={{
                                borderColor: activeRefinement === ref.label ? 'var(--blue)' : 'rgba(0,0,0,0.1)',
                                background: activeRefinement === ref.label ? 'var(--blue)' : 'white',
                                color: activeRefinement === ref.label ? 'white' : 'var(--ink)',
                            }}>
                            {ref.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
    return null;
};
