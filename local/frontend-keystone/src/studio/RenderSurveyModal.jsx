import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import KeystoneRenderPreferences from '../lib/renderPreferences.generated.js';
import { FINISH_OVERRIDE_OPTIONS } from '../data/survey.js';
import { CloseIcon } from '../ui/icons.jsx';

// ---- Render survey modal
export const buildRenderSurveyDefaults = (baseSurveyData = {}, initialData = {}, planSpec = {}) =>
    KeystoneRenderPreferences.resolve(baseSurveyData, initialData, planSpec);

export const RenderSurveyModal = ({ isOpen, onClose, onSubmit, initialData, baseSurveyData, planSpec }) => {
    const dialogRef = useRef(null);
    useEffect(() => {
        if (!isOpen) return;
        const previousFocus = document.activeElement;
        const frame = requestAnimationFrame(() => dialogRef.current?.querySelector('button')?.focus());
        return () => { cancelAnimationFrame(frame); previousFocus?.focus?.(); };
    }, [isOpen]);

    // Escape is bound at the document, not on the dialog node.
    //
    // It used to live only in the dialog's own onKeyDown, which fires only
    // when focus is already inside. Focus is moved there by the rAF above,
    // so between opening and that frame the key went nowhere and the dialog
    // could not be dismissed at all. The same gap hits any keyboard user who
    // opens the dialog and presses Escape before tabbing into it.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [isOpen, onClose]);

    const handleDialogKey = e => {
        if (e.key !== 'Tab') return;
        const elements = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
        const first = elements[0], last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    const [overrides, setOverrides] = useState({});
    const [data, setData] = useState(buildRenderSurveyDefaults(baseSurveyData, initialData, planSpec));
    useEffect(() => {
        const resolved = buildRenderSurveyDefaults(baseSurveyData, initialData, planSpec);
        const defaults = buildRenderSurveyDefaults(baseSurveyData, null, planSpec);
        setData(resolved);
        setOverrides(initialData?.version === 2 ? initialData.overrides || {} : Object.fromEntries(Object.entries(resolved).filter(([key, value]) => value !== defaults[key])));
    }, [initialData, baseSurveyData, planSpec, isOpen]);
    const upd = (f, v) => { setOverrides(p => ({ ...p, [f]: v })); setData(p => ({ ...p, [f]: v })); };

    const BtnRow = ({ field, options }) => (
        <div className="flex flex-wrap gap-1.5">
            {options.map(opt => {
                const val = typeof opt === 'string' ? opt : opt.val;
                const label = typeof opt === 'string' ? opt : opt.label;
                const sel = data[field] === val;
                return <button key={val} type="button" aria-pressed={sel} onClick={() => upd(field, val)}
                    className="px-3 py-1.5 border rounded-xs text-[12px] font-semibold transition-colors"
                    style={{borderColor: sel?'var(--blue)':'rgba(0,0,0,0.1)', background: sel?'var(--ink)':'white', color: sel?'white':'var(--ink)'}}>
                    {label}
                </button>;
            })}
        </div>
    );
    const Lbl = ({children}) => <label className="mono text-[11px] uppercase tracking-widest text-mid block mb-1.5">{children}</label>;

    // Rendered on <body>: inside the studio window (glass, backdrop-filter) "fixed"
    // meant fixed to the window's scrolling content, so on a tablet the dialog opened
    // half off-screen (C7 tablet journey).
    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
                    className="fixed inset-0 z-[550] flex items-end md:items-center justify-center bg-black/88 backdrop-blur-xs p-0 md:p-6">
                    {/* damping without stiffness gave a spring that took ~2.5s to
                        settle, so the dialog lingered invisibly after closing and kept
                        its focus trap alive. */}
                    <motion.div initial={{y:40,opacity:0}} animate={{y:0,opacity:1}} exit={{y:40,opacity:0}}
                        transition={{type:'spring',stiffness:320,damping:30}}
                        ref={dialogRef} role="dialog" aria-modal="true" aria-label="3D Render Options" onKeyDown={handleDialogKey}
                        className="electric-border w-full md:max-w-lg rounded-t-2xl md:rounded-xl shadow-2xl relative overflow-hidden"
                        style={{
                            background:'linear-gradient(180deg, rgba(255,252,247,0.985), rgba(246,240,231,0.97))',
                            border:'1px solid var(--ink-soft)',
                            boxShadow:'0 30px 96px var(--ink-soft)',
                        }}>
                        <div style={{height:'3px',background:'linear-gradient(90deg,var(--blue),var(--red))'}}/>
                        <button type="button" onClick={onClose} aria-label="Close render options" className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center z-10"
                            style={{
                                background:'rgba(255,255,255,0.82)',
                                color:'var(--ink)',
                                border:'1px solid var(--ink-soft)',
                            }}>
                            <CloseIcon className="w-4 h-4"/>
                        </button>

                        <div className="p-6 overflow-y-auto" style={{maxHeight:'85vh', color:'var(--ink)'}}>
                            <span className="badge mb-3 inline-block">3D Render Options</span>
                            <h2 className="studio-step-title mb-1" style={{color:'var(--ink)'}}>Customise your render.</h2>
                            <p className="text-[13px] mb-3 leading-relaxed" style={{color:'var(--ink)'}}>Your floor-plan survey supplies the starting settings. Change finishes, site context, or lighting for this render. Room layout, openings, and roof shape follow the generated plan and elevations.</p>
                            <div className="p-3 mb-3 border rounded-xs text-[13px] leading-relaxed" style={{borderColor:'rgba(0,0,0,0.12)'}}>
                                <strong>From your floor-plan survey</strong>
                                <p>{[baseSurveyData?.materials, baseSurveyData?.stories, baseSurveyData?.bedrooms, baseSurveyData?.bathrooms, baseSurveyData?.garage].filter(Boolean).join(' · ')}</p>
                                <p>{[baseSurveyData?.frontFacing && `${baseSurveyData.frontFacing} facing`, baseSurveyData?.shape, baseSurveyData?.ceilingHeight, baseSurveyData?.naturalLight, baseSurveyData?.outdoorLiving].filter(Boolean).join(' · ')}</p>
                                <p className="mt-1 text-[12px]">Site details absent from your survey use suggested defaults.</p>
                            </div>
                            <button type="button" className="mb-5 min-h-8 text-[13px] underline" onClick={() => { setOverrides({}); setData(buildRenderSurveyDefaults(baseSurveyData, null, planSpec)); }}>Reset to floor-plan survey</button>

                            <div className="space-y-4">
                                <div>
                                    <Lbl>Exterior siding</Lbl>
                                    <select aria-label="Render exterior siding" value={data.exteriorSiding} onChange={e => upd('exteriorSiding', e.target.value)}>
                                        {[...new Set([data.exteriorSiding, ...FINISH_OVERRIDE_OPTIONS.exteriorSiding])].map(value => <option key={value}>{value}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <Lbl>Roof finish</Lbl>
                                    <select aria-label="Render roof finish" value={data.roofMaterial} onChange={e => upd('roofMaterial', e.target.value)}>
                                        {[...new Set([data.roofMaterial, ...FINISH_OVERRIDE_OPTIONS.roofMaterial])].map(value => <option key={value}>{value}</option>)}
                                    </select>
                                </div>
                                {/* ZIP CODE */}
                                <div>
                                    <Lbl>Project ZIP Code</Lbl>
                                    <input aria-label="Project ZIP Code" type="text" placeholder="e.g. 78701" maxLength="10"
                                        value={data.zipCode} onChange={e => upd('zipCode', e.target.value)}
                                        style={{maxWidth:'180px'}}/>
                                    <p className="text-[12px] mt-1" style={{color:'var(--ink)'}}>Helps set regional context - climate, terrain, neighborhood character</p>
                                </div>

                                {/* LOT CONTEXT */}
                                <div>
                                    <Lbl>Lot / Site Context</Lbl>
                                    <BtnRow field="lotContext" options={[
                                        {val:'Suburban standard lot', label:'Suburban'},
                                        {val:'Suburban corner lot',   label:'Corner'},
                                        {val:'Urban tight lot',       label:'Urban'},
                                        {val:'Rural acreage',         label:'Rural'},
                                        {val:'View focused site',     label:'View Site'},
                                        {val:'Waterfront lot',        label:'Waterfront'},
                                    ]}/>
                                    <p className="text-[12px] mt-1" style={{color:'var(--ink)'}}>Survey selection: {baseSurveyData?.lotContext || 'Suburban standard lot'}</p>
                                </div>

                                {/* CONTEXT DENSITY */}
                                <div>
                                    <Lbl>Neighborhood / Context</Lbl>
                                    <BtnRow field="contextDensity" options={[
                                        'Detached neighboring homes',
                                        'Close urban neighbors',
                                        'Open rural edge',
                                        'Tree-lined residential street',
                                        'View-oriented sparse context',
                                    ]}/>
                                </div>

                                {/* TOPOGRAPHY */}
                                <div>
                                    <Lbl>Topography / Site Grade</Lbl>
                                    <BtnRow field="topography" options={[
                                        'Mostly flat site',
                                        'Gentle front slope',
                                        'Gentle rear slope',
                                        'Hillside / stepped terrain',
                                    ]}/>
                                </div>

                                {/* SEASON */}
                                <div>
                                    <Lbl>Season / Vegetation</Lbl>
                                    <BtnRow field="season" options={['Spring','Summer','Fall','Winter (Snow)']}/>
                                </div>

                                {/* TIME OF DAY */}
                                <div>
                                    <Lbl>Time of Day / Lighting</Lbl>
                                    <BtnRow field="timeOfDay" options={['Sunrise','Midday','Golden Hour','Overcast','Night']}/>
                                </div>

                                {/* WEATHER */}
                                <div>
                                    <Lbl>Sky / Weather</Lbl>
                                    <BtnRow field="weather" options={[
                                        'Clear sky',
                                        'Soft clouds',
                                        'Overcast sky',
                                        'Stormy atmosphere',
                                        'Snowy air',
                                    ]}/>
                                </div>

                                {/* SURROUNDINGS */}
                                <div>
                                    <Lbl>Immediate Surroundings</Lbl>
                                    <BtnRow field="surroundings" options={[
                                        {val:'Suburban neighborhood', label:'Suburban'},
                                        {val:'Open countryside', label:'Countryside'},
                                        {val:'Urban streetscape', label:'Urban'},
                                        {val:'Open view corridor', label:'Open View'},
                                        {val:'Wooded edge / mature trees', label:'Wooded'},
                                        {val:'Desert arid landscape', label:'Desert'},
                                        {val:'Ocean or lake waterfront', label:'Waterfront'},
                                        {val:'Mountain or hillside backdrop', label:'Mountain'},
                                        {val:'Clean new-build street presence', label:'New Build'},
                                    ]}/>
                                </div>

                                {/* DRIVEWAY */}
                                <div>
                                    <Lbl>Driveway / Hardscape</Lbl>
                                    <BtnRow field="drivewayStyle" options={[
                                        'Concrete driveway',
                                        'Exposed aggregate concrete',
                                        'Paver driveway',
                                        'Gravel driveway',
                                        'Minimal hardscape',
                                    ]}/>
                                </div>

                                {/* LANDSCAPING */}
                                <div>
                                    <Lbl>Landscaping</Lbl>
                                    <BtnRow field="landscaping" options={[
                                        'Foundation plantings + lawn',
                                        'Native plantings',
                                        'Desert xeriscaping',
                                        'Formal hedges',
                                        'Wildflower meadow',
                                        'Minimal / gravel',
                                    ]}/>
                                </div>
                            </div>

                            <button onClick={() => onSubmit({ version: 2, overrides })}
                                className="w-full mt-6 py-3.5 bg-ink text-white mono text-[12px] uppercase tracking-[0.18em] font-bold hover:bg-blue transition-colors rounded-xs">
                                Generate Exterior Render
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    );
};
