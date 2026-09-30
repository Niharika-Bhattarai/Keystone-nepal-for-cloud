import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FINISH_OVERRIDE_OPTIONS, STYLE_FINISH_DEFAULTS, SURVEY_STEPS } from '../data/survey.js';
import { surveyWithBedroomConfigurations } from '../lib/bedroomConfigurations.js';
import { FeatureRoomControls } from './FeatureRoomControls.jsx';

export const SurveyForm = ({ formData, setFormData, onSubmit, isLoading, onReset }) => {
    const [step, setStep] = useState(0);
    const [preflight, setPreflight] = useState(null);
    const [featurePending, setFeaturePending] = useState(false);
    const generationSurvey = useMemo(() => surveyWithBedroomConfigurations(formData), [formData]);
    const surveyKey = JSON.stringify(generationSurvey);
    const currentPreflight = preflight?.surveyKey === surveyKey;
    // A contradictory survey (for example every bathroom set as an en-suite
    // while a bedroom has none) is refused by the server whatever engine runs.
    const conflict = preflight?.blockers?.some(b => ['PROGRAM_CONFLICT', 'BRIEF_INVALID'].includes(b.code));
    useEffect(() => {
        const controller = new AbortController();
        setPreflight(null);
        const timer = setTimeout(async () => {
            let timedOut = false;
            const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
            try {
                const response = await fetch('/api/plan/preflight', { method:'POST', signal:controller.signal,
                    headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ surveyData:generationSurvey }) });
                if (!response.ok) throw new Error('Preflight unavailable');
                const data = await response.json();
                if (!controller.signal.aborted) setPreflight({ ...data, surveyKey: JSON.stringify(generationSurvey) });
            } catch (error) {
                if (!controller.signal.aborted || timedOut) setPreflight({ unavailable:true, surveyKey: JSON.stringify(generationSurvey) });
            } finally {
                clearTimeout(deadline);
            }
        }, 450);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [generationSurvey]);
    const upd = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));
    const styleFinishDefaults = STYLE_FINISH_DEFAULTS[formData.materials] || STYLE_FINISH_DEFAULTS['Craftsman (Wood & Stone)'];
    const effectiveFinishValue = (key) => (formData.finishOverrides?.[key] || styleFinishDefaults?.[key] || '');
    const updateFinishOverride = (key, value) => {
        setFormData(prev => ({
            ...prev,
            finishOverrides: {
                ...(prev.finishOverrides || {}),
                [key]: value,
            },
        }));
    };
    const handleReset = () => {
        if (onReset) onReset();
        setStep(0);
    };
    const choiceStyle = (selected, tone = 'ink') => {
        if (selected) {
            // The survey only ever renders inside the dark studio, where
            // --ink is remapped to near-white. The old selected state was a
            // gradient ending at var(--ink) with white text on top, which
            // became white-on-white: "3" measured 2.03:1 and "2 Stories"
            // 3.70:1. A filled accent chip with near-black type is 7.4:1 and
            // reads as chosen at a glance.
            return {
                // --d-accent-fill, not --d-accent: the latter is lightened
                // so the accent clears 4.5:1 as TEXT, which a fill does not
                // need. This is the same ember as the hero's button.
                borderColor: 'var(--d-accent-fill)',
                background: 'var(--d-accent-fill)',
                color: 'var(--d-on-fill)',
                fontWeight: 700,
                boxShadow: '0 6px 16px -8px rgba(15,20,32,0.45)',
            };
        }
        // Surface token, not hardcoded white: the same chip has to work on the
        // light page and inside the dark studio, where var(--ink) is light.
        return {
            borderColor: 'var(--control-edge)',
            background: 'var(--chip-bg)',
            color: 'var(--ink)',
            boxShadow: 'none',
        };
    };
    /* Both of these were near-white text on a gradient. The 'ink' tone ran
       to var(--ink), which the studio remaps to near-white, so "Generate
       floor plan" was pale type on a silver gradient - and a gradient is
       invisible to a contrast check that reads backgroundColor. Continue
       and Generate never appear together, so both are simply the primary
       control: the ember fill with near-black on it, 7.36:1, the same
       treatment as every other primary action in here. */
    const actionStyle = () => ({
        borderColor: 'var(--d-accent-fill)',
        background: 'var(--d-accent-fill)',
        color: 'var(--d-on-fill)',
    });

    // One stable component (declared once, reading the live form through a ref):
    // declared inline it was a new type on every render, so React remounted the row
    // and a choice made from the keyboard lost focus. Each row is a radio group named
    // by its label: one Tab stop, and the arrow keys, Home and End choose (C7).
    const live = useRef(null);
    live.current = { formData, upd, choiceStyle };
    const BtnGrid = useMemo(() => function BtnGrid({ field, options, cols = 2 }) {
        const { formData: data, upd: update, choiceStyle: styleFor } = live.current;
        const vals = options.map(opt => (typeof opt === 'string' ? opt : opt.val));
        const current = vals.indexOf(data[field]);
        const onKeyDown = (e) => {
            const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
            let next;
            if (step) next = current < 0 ? (step > 0 ? 0 : vals.length - 1) : (current + step + vals.length) % vals.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = vals.length - 1;
            else return;
            e.preventDefault();
            update(field, vals[next]);
            e.currentTarget.querySelectorAll('[role=radio]')[next]?.focus();
        };
        return (
            <div role="radiogroup" aria-labelledby={`survey-${field}-label`} onKeyDown={onKeyDown}
                className="grid gap-2" style={{gridTemplateColumns:`repeat(${cols},1fr)`}}>
                {options.map((opt, i) => {
                    const val = vals[i];
                    const label = typeof opt === 'string' ? opt : opt.label;
                    const desc = typeof opt === 'object' ? opt.desc : null;
                    const sel = data[field] === val;
                    return (
                        <button key={val} type="button" role="radio" aria-checked={sel}
                            tabIndex={sel || (current < 0 && i === 0) ? 0 : -1}
                            onClick={() => update(field, val)}
                            className="py-3 px-3 border text-left rounded-xs transition-colors"
                            style={styleFor(sel)}>
                            <div className="text-[13px] font-semibold leading-tight">{label}</div>
                            {desc && <div className="text-[12px] mt-0.5 leading-tight" style={{opacity: sel ? 0.74 : 0.42}}>{desc}</div>}
                        </button>
                    );
                })}
            </div>
        );
    }, []);

    // htmlFor ties a label to its field; over a row of choices, id names the radio group.
    const Lbl = ({children, htmlFor, id}) => <label htmlFor={htmlFor} id={id} className="studio-field-label block mb-1.5">{children}</label>;

    // Footprint shape visual options
    const FootprintOption = ({ val, label, desc, ratio }) => {
        const sel = formData.shape === val;
        // ratio: [w, h] proportional
        const [fw, fh] = ratio;
        return (
            <button type="button" aria-pressed={sel} onClick={() => upd('shape', val)}
                className="p-3 border rounded-xs transition-all flex flex-col items-center gap-2"
                style={choiceStyle(sel)}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'36px'}}>
                    <div style={{
                        width: `${fw * 28}px`, height: `${fh * 28}px`,
                        border: `2px solid ${sel ? 'rgba(255,255,255,0.7)' : 'var(--blue)'}`,
                        background: sel ? 'rgba(255,255,255,0.08)' : 'var(--accent)',
                        borderRadius: '2px',
                    }}/>
                </div>
                <div className="text-[12px] font-semibold leading-tight text-center">{label}</div>
                <div className={`text-[11px] leading-tight text-center ${sel?'opacity-50':'opacity-40'}`}>{desc}</div>
            </button>
        );
    };

    // Lot context visual option (like street/front but for lot type)
    const LotOption = ({ val, label, svgContent }) => {
        const sel = formData.lotContext === val;
        return (
            <button type="button" aria-pressed={sel} onClick={() => upd('lotContext', val)}
                className={`p-2 border rounded-xs transition-all flex flex-col items-center gap-1.5 ${sel ? 'border-blue' : 'border-black/10 bg-white hover:border-blue'}`}
                style={{background: sel ? 'var(--accent)' : 'white'}}>
                <svg viewBox="0 0 60 40" width="60" height="40" style={{display:'block'}}>
                    {svgContent}
                </svg>
                <div className="text-[12px] font-semibold leading-tight text-center" style={{color: sel ? 'var(--blue)' : 'var(--ink)'}}>{label}</div>
            </button>
        );
    };

    const renderField = (field) => {
        const bedCount = parseInt(formData.bedrooms) || 3;
        switch(field) {
            case 'totalArea': return <div key={field} className="space-y-1.5"><Lbl htmlFor="survey-totalArea">Total Floor Area (Sq Ft)</Lbl><input id="survey-totalArea" type="number" placeholder="e.g. 2400" value={formData.totalArea} onChange={e=>upd('totalArea',e.target.value)} min="600" max="10000"/><p className="text-[12px] text-mid/60">Total finished sq ft across all levels</p></div>;
            case 'stories': return <div key={field} className="space-y-1.5"><Lbl id="survey-stories-label">Number of Stories</Lbl><BtnGrid field="stories" options={['1 Story','2 Stories']}/></div>;
            case 'bedrooms': return (
                <div key={field} className="space-y-1.5">
                    <Lbl>Bedrooms</Lbl>
                    <div className="flex gap-2">{[1,2,3,4,5].map(n=>{ const selected = formData.bedrooms===`${n} Bed`; return <button key={n} type="button" aria-pressed={selected} onClick={()=>upd('bedrooms',`${n} Bed`)} className="flex-1 h-11 border text-sm font-bold rounded-xs transition-all" style={choiceStyle(selected)}>{n}</button>; })}</div>
                </div>
            );
            case 'bathrooms': return (
                <div key={field} className="space-y-1.5">
                    <Lbl>Full Bathrooms</Lbl>
                    <div className="flex gap-2">{[1,2,3,4,5].map(n=>{ const selected = formData.bathrooms===`${n} Bath`; return <button key={n} type="button" aria-pressed={selected} onClick={()=>upd('bathrooms',`${n} Bath`)} className="flex-1 h-11 border text-sm font-bold rounded-xs transition-all" style={choiceStyle(selected)}>{n}</button>; })}</div>
                    <p className="text-[12px] text-mid/60">Half baths added automatically</p>
                </div>
            );
            case 'privateBaths': {
                const bedLabels = bedCount <= 1
                    ? ['Primary Bedroom']
                    : ['Primary Bedroom', ...Array.from({length: bedCount - 1}, (_, i) => `Bedroom ${i + 2}`)];
                const configs = generationSurvey.bedroomConfigs;
                const updateConfig = (idx, key, val) => {
                    const next = configs.map(config => ({ ...config }));
                    next[idx] = { ...next[idx], [key]: val };
                    setFormData(prev => ({ ...prev, bedroomConfigs: next, privateBaths: String(next.filter(c => c.privateBath === 'Yes').length) }));
                };
                return (
                    <div key={field} className="space-y-3 p-3 bg-blue/4 border border-blue/15 rounded-xs">
                        <Lbl>Bedroom Configuration</Lbl>
                        <p className="text-[12px] text-mid mb-1">Set private bathroom and closet type for each bedroom.</p>
                        {bedLabels.map((label, idx) => {
                            const cfg = configs[idx];
                            return (
                                <div key={idx} className="p-2.5 bg-white/60 border border-black/5 rounded-xs space-y-2">
                                    <div className="text-[12px] font-bold uppercase tracking-wider" style={{color:'var(--blue)'}}>{label}</div>
                                    <div className="flex gap-3 items-center">
                                        <span className="text-[12px] font-medium text-mid w-16 shrink-0">En-Suite</span>
                                        <div className="flex gap-1.5 flex-1">
                                            {['Yes', 'No'].map(v => {
                                                const sel = cfg.privateBath === v;
                                                return <button key={v} type="button" aria-pressed={sel} onClick={() => updateConfig(idx, 'privateBath', v)} className="flex-1 min-h-11 border text-[12px] font-bold rounded-xs" style={choiceStyle(sel, 'blue')}>{v}</button>;
                                            })}
                                        </div>
                                    </div>
                                    <div className="flex gap-3 items-center">
                                        <span className="text-[12px] font-medium text-mid w-16 shrink-0">Closet</span>
                                        <div className="flex gap-1.5 flex-1">
                                            {['Walk-in', 'Standard'].map(v => {
                                                const sel = cfg.closet === v;
                                                return <button key={v} type="button" aria-pressed={sel} onClick={() => updateConfig(idx, 'closet', v)} className="flex-1 min-h-11 border text-[12px] font-bold rounded-xs" style={choiceStyle(sel, 'blue')}>{v}</button>;
                                            })}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        <p className="text-[12px] text-mid/50">These choices apply to each bedroom. Standard closets are reach-in; walk-in closets reserve an internal aisle. Remaining bathrooms are shared.</p>
                    </div>
                );
            }
            case 'garage': return (
                <div key={field} className="space-y-1.5">
                    <Lbl id="survey-garage-label">Garage</Lbl>
                    <BtnGrid field="garage" options={[
                        {val:'No Garage', label:'No Garage', desc:'Driveway only'},
                        {val:'1 Car Garage', label:'1 Car', desc:'Single attached garage'},
                        {val:'2 Car Garage', label:'2 Car', desc:'Double attached garage'},
                    ]}/>
                </div>
            );
            case 'shape': return (
                <div key={field} className="space-y-1.5">
                    <Lbl>Footprint Shape</Lbl>
                    <div className="grid grid-cols-2 gap-2">
                        <FootprintOption val="Rectangular (Wide)" label="Wide Rectangle" desc="Width > depth - more street frontage" ratio={[1.6, 1]}/>
                        <FootprintOption val="Rectangular (Deep)" label="Deep Rectangle" desc="Depth > width - narrow lot" ratio={[1, 1.4]}/>
                        <FootprintOption val="Square" label="Square" desc="Equal width and depth" ratio={[1, 1]}/>
                        <FootprintOption val="Rectangular" label="Standard Rect" desc="Classic proportions" ratio={[1.3, 1]}/>
                    </div>
                </div>
            );
            case 'frontFacing': return (
                <div key={field} className="space-y-2">
                    <Lbl>Street / Front Faces</Lbl>
                    <div className="flex items-center justify-center">
                        <div className="relative" style={{width:'210px',height:'210px'}}>
                            <svg viewBox="0 0 210 210" width="210" height="210" style={{position:'absolute',top:0,left:0,pointerEvents:'none'}}>
                                <circle cx="105" cy="105" r="100" fill="none" stroke="rgba(100,100,100,0.1)" strokeWidth="1"/>
                                <circle cx="105" cy="105" r="68" fill="none" stroke="rgba(100,100,100,0.07)" strokeWidth="1" strokeDasharray="3 4"/>
                                {[[105,6,105,20],[105,190,105,204],[6,105,20,105],[190,105,204,105]].map(([x1,y1,x2,y2],i)=><line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(100,100,100,0.22)" strokeWidth="1.5"/>)}
                                <path d="M 174 68 Q 200 105 174 142" fill="none" stroke="rgba(181,136,42,0.2)" strokeWidth="1.5" strokeDasharray="3 3"/>
                                <text x="188" y="109" textAnchor="middle" fontSize="8" fill="rgba(181,136,42,0.5)">sun</text>
                            </svg>
                            <div style={{position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-50%)',zIndex:2}}>
                                {['North','South','East','West'].includes(formData.frontFacing) && (() => {
                                    const dir = formData.frontFacing;
                                    const arrs = {North:[38,2,38,14],South:[38,66,38,54],East:[74,34,60,34],West:[2,34,16,34]};
                                    const lps  = {North:{x:38,y:24,a:'middle'},South:{x:38,y:48,a:'middle'},East:{x:50,y:34,a:'start'},West:{x:26,y:34,a:'end'}};
                                    const arr = arrs[dir]; const lp = lps[dir];
                                    return <svg viewBox="0 0 76 68" width="76" height="68">
                                        <rect x="14" y="26" width="48" height="36" rx="1" fill="#f3f2ee" stroke="#2c2c2e" strokeWidth="1.5"/>
                                        <polygon points="8,28 38,7 68,28" fill="#1a1a1a" opacity="0.85"/>
                                        <rect x="48" y="10" width="6" height="10" fill="#1a1a1a" opacity="0.5"/>
                                        {dir==='South'&&<><rect x="22" y="42" width="14" height="14" rx="1" fill="#ccc" stroke="#333" strokeWidth="0.8" opacity="0.8"/><rect x="42" y="48" width="7" height="14" rx="1" fill="#7a7060" stroke="#333" strokeWidth="0.8"/></>}
                                        {dir==='North'&&<><rect x="22" y="26" width="14" height="10" rx="1" fill="#ccc" stroke="#333" strokeWidth="0.8" opacity="0.8"/><rect x="42" y="26" width="7" height="10" fill="#7a7060" stroke="#333" strokeWidth="0.8"/></>}
                                        {dir==='East'&&<><rect x="50" y="34" width="12" height="16" rx="1" fill="#ccc" stroke="#333" strokeWidth="0.8" opacity="0.8"/><rect x="50" y="52" width="12" height="8" fill="#7a7060" stroke="#333" strokeWidth="0.8"/></>}
                                        {dir==='West'&&<><rect x="14" y="34" width="12" height="16" rx="1" fill="#ccc" stroke="#333" strokeWidth="0.8" opacity="0.8"/><rect x="14" y="52" width="12" height="8" fill="#7a7060" stroke="#333" strokeWidth="0.8"/></>}
                                        <line x1={arr[0]} y1={arr[1]} x2={arr[2]} y2={arr[3]} stroke="#1C5A8C" strokeWidth="1.5" strokeDasharray="2 2"/>
                                        <circle cx={arr[0]} cy={arr[1]} r="2.5" fill="#1C5A8C"/>
                                        <text x={lp.x} y={lp.y} textAnchor={lp.a} fontSize="5" fill="#1C5A8C" fontWeight="bold" fontFamily="sans-serif">STREET</text>
                                    </svg>;
                                })()}
                            </div>
                            {[{dir:'North',x:77,y:0,w:56,h:34},{dir:'South',x:77,y:176,w:56,h:34},{dir:'West',x:0,y:77,w:34,h:56},{dir:'East',x:176,y:77,w:34,h:56}].map(({dir,x,y,w,h})=>{
                                const sel = formData.frontFacing===dir;
                                return <button key={dir} type="button" aria-pressed={sel} onClick={()=>upd('frontFacing',dir)}
                                    style={{position:'absolute',left:x,top:y,width:w,height:h,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',border:sel?'1.5px solid #1C5A8C':'1px solid rgba(100,100,100,0.14)',borderRadius:'4px',background:sel?'#1C5A8C':'rgba(246,244,239,0.95)',color:sel?'#fff':'#0A0A0C',cursor:'pointer',zIndex:10,transition:'all 0.12s',boxShadow:sel?'0 2px 10px var(--accent)':'none'}}>
                                    <span style={{fontSize:'13px',fontWeight:'800',lineHeight:1}}>{dir[0]}</span>
                                    <span style={{fontSize:'6px',fontWeight:'600',opacity:0.65,marginTop:'1px'}}>{dir}</span>
                                </button>;
                            })}
                        </div>
                    </div>
                    <p className="mono text-[11px] text-mid/50 text-center">South = most winter sun - East = morning light</p>
                </div>
            );
            case 'lotContext': return (
                <div key={field} className="space-y-2">
                    <Lbl>Lot / Site Context</Lbl>
                    <div className="grid grid-cols-3 gap-2">
                        <LotOption val="Suburban standard lot" label="Suburban" svgContent={<>
                            <rect x="5" y="20" width="50" height="15" fill="#c8e6c9" stroke="#888" strokeWidth="0.5"/>
                            <rect x="15" y="8" width="30" height="14" fill="#e8e4dc" stroke="#555" strokeWidth="1"/>
                            <polygon points="15,8 30,2 45,8" fill="#555"/>
                            <rect x="10" y="32" width="40" height="3" fill="#aaa"/>
                            <line x1="0" y1="35" x2="60" y2="35" stroke="#aaa" strokeWidth="1"/>
                        </>}/>
                        <LotOption val="Suburban corner lot" label="Corner" svgContent={<>
                            <rect x="5" y="15" width="50" height="20" fill="#c8e6c9" stroke="#888" strokeWidth="0.5"/>
                            <rect x="8" y="8" width="25" height="14" fill="#e8e4dc" stroke="#555" strokeWidth="1"/>
                            <polygon points="8,8 20,2 33,8" fill="#555"/>
                            <line x1="5" y1="35" x2="55" y2="35" stroke="#aaa" strokeWidth="1.5"/>
                            <line x1="5" y1="35" x2="5" y2="5" stroke="#aaa" strokeWidth="1.5"/>
                        </>}/>
                        <LotOption val="Urban tight lot" label="Urban" svgContent={<>
                            <rect x="8" y="5" width="16" height="30" fill="#e8e4dc" stroke="#555" strokeWidth="1"/>
                            <rect x="26" y="2" width="12" height="33" fill="#ddd" stroke="#777" strokeWidth="0.7"/>
                            <rect x="40" y="8" width="14" height="27" fill="#d5cfc5" stroke="#666" strokeWidth="0.7"/>
                            <line x1="0" y1="35" x2="60" y2="35" stroke="#aaa" strokeWidth="1.5"/>
                        </>}/>
                        <LotOption val="Rural acreage" label="Rural" svgContent={<>
                            <rect x="0" y="25" width="60" height="15" fill="#a5d6a7" stroke="none"/>
                            <rect x="18" y="14" width="24" height="14" fill="#e8e4dc" stroke="#555" strokeWidth="1"/>
                            <polygon points="18,14 30,7 42,14" fill="#555"/>
                            <circle cx="8" cy="22" r="5" fill="#66bb6a"/>
                            <circle cx="52" cy="20" r="6" fill="#4caf50"/>
                            <circle cx="46" cy="23" r="4" fill="#81c784"/>
                        </>}/>
                        <LotOption val="View focused site" label="View Site" svgContent={<>
                            <rect x="0" y="22" width="60" height="18" fill="#b3e5fc" stroke="none"/>
                            <polyline points="0,22 10,16 20,20 32,12 44,18 60,14" fill="none" stroke="#8d6e63" strokeWidth="1.5"/>
                            <rect x="20" y="12" width="20" height="12" fill="#e8e4dc" stroke="#555" strokeWidth="1"/>
                            <polygon points="20,12 30,6 40,12" fill="#555"/>
                        </>}/>
                        <LotOption val="Waterfront lot" label="Waterfront" svgContent={<>
                            <rect x="0" y="24" width="60" height="16" fill="#81d4fa" stroke="none"/>
                            <rect x="0" y="24" width="60" height="4" fill="#4fc3f7" stroke="none"/>
                            <rect x="15" y="10" width="28" height="16" fill="#e8e4dc" stroke="#555" strokeWidth="1"/>
                            <polygon points="15,10 29,4 43,10" fill="#555"/>
                            <rect x="26" y="24" width="4" height="6" fill="#8d6e63"/>
                        </>}/>
                    </div>
                </div>
            );
            case 'openConcept': return <div key={field} className="space-y-1.5"><Lbl id="survey-openConcept-label">Kitchen / Living / Dining</Lbl><BtnGrid field="openConcept" cols={1} options={[{val:'Open Concept (Combined)',label:'Open Concept',desc:'Kitchen, dining, and living flow together as one great room'},{val:'Traditional (Separate Rooms)',label:'Traditional',desc:'Each room is enclosed and defined with walls'}]}/></div>;
            case 'masterLocation': return (
                <div key={field} className="space-y-1.5">
                    <Lbl id="survey-masterLocation-label">Primary Suite Location</Lbl>
                    <BtnGrid field="masterLocation" options={
                        formData.stories === '1 Story'
                            ? ['Level 1 (Main)']
                            : ['Level 1 (Main)','Level 2 (Upper)']
                    }/>
                </div>
            );
            case 'kitchenPlacement': return <div key={field} className="space-y-1.5"><Lbl id="survey-kitchenPlacement-label">Kitchen Location</Lbl><BtnGrid field="kitchenPlacement" options={['Rear of House','Front of House']}/></div>;
            case 'laundryLocation': return (
                <div key={field} className="space-y-1.5">
                    <Lbl id="survey-laundryLocation-label">Laundry Location</Lbl>
                    <BtnGrid field="laundryLocation" cols={1} options={
                        formData.stories === '1 Story'
                            ? ['Level 1 (near garage/mud)', 'No preference']
                            : ['Level 1 (near garage/mud)','Level 2 (near bedrooms)','No preference']
                    }/>
                </div>
            );
            case 'ceilingHeight': return <div key={field} className="space-y-1.5"><Lbl id="survey-ceilingHeight-label">Ceiling Height</Lbl><BtnGrid field="ceilingHeight" cols={3} options={['Standard (9 ft)','Tall (10 ft)','Cathedral / Vaulted']}/></div>;
            case 'materials': return (
                <div key={field} className="space-y-2">
                    <Lbl id="survey-materials-label">Exterior Style & Materials</Lbl>
                    <BtnGrid field="materials" cols={1} options={[
                        {val:'Craftsman (Wood & Stone)',          label:'Craftsman',              desc:'Natural wood trim, stone veneer, covered porch'},
                        {val:'Modern Farmhouse (Board & Batten)', label:'Modern Farmhouse',       desc:'Board-and-batten, black frames, metal roof'},
                        {val:'Traditional Colonial (Brick)',      label:'Traditional / Colonial', desc:'Brick facade, symmetrical windows, pitched roof'},
                        {val:'Contemporary Modern (Concrete)',    label:'Contemporary / Modern',  desc:'Flat roof, concrete, floor-to-ceiling glass'},
                        {val:'Mediterranean (Stucco & Tile)',     label:'Mediterranean',          desc:'Stucco exterior, terracotta tiles, arched details'},
                    ]}/>
                    <details className="p-3 border border-black/10 rounded-xs bg-white/80">
                        <summary className="cursor-pointer select-none text-[12px] font-semibold uppercase tracking-[0.14em]" style={{color:'var(--blue)'}}>
                            Customize Finishes (optional)
                        </summary>
                        <p className="text-[12px] text-mid/65 mt-2 mb-2">
                            Defaults come from the selected style. You can override only what you want.
                        </p>
                        <div className="grid md:grid-cols-2 gap-2.5">
                            <div className="space-y-1">
                                <Lbl htmlFor="survey-exteriorSiding">Exterior siding</Lbl>
                                <select id="survey-exteriorSiding" value={effectiveFinishValue('exteriorSiding')} onChange={e => updateFinishOverride('exteriorSiding', e.target.value)}>
                                    {FINISH_OVERRIDE_OPTIONS.exteriorSiding.map(option => <option key={option} value={option}>{option}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <Lbl htmlFor="survey-roofMaterial">Roof material</Lbl>
                                <select id="survey-roofMaterial" value={effectiveFinishValue('roofMaterial')} onChange={e => updateFinishOverride('roofMaterial', e.target.value)}>
                                    {FINISH_OVERRIDE_OPTIONS.roofMaterial.map(option => <option key={option} value={option}>{option}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <Lbl htmlFor="survey-countertop">Countertop</Lbl>
                                <select id="survey-countertop" value={effectiveFinishValue('countertop')} onChange={e => updateFinishOverride('countertop', e.target.value)}>
                                    {FINISH_OVERRIDE_OPTIONS.countertop.map(option => <option key={option} value={option}>{option}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <Lbl htmlFor="survey-flooringPublic">Flooring (public)</Lbl>
                                <select id="survey-flooringPublic" value={effectiveFinishValue('flooringPublic')} onChange={e => updateFinishOverride('flooringPublic', e.target.value)}>
                                    {FINISH_OVERRIDE_OPTIONS.flooringPublic.map(option => <option key={option} value={option}>{option}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <Lbl htmlFor="survey-cabinetGrade">Cabinet grade</Lbl>
                                <select id="survey-cabinetGrade" value={effectiveFinishValue('cabinetGrade')} onChange={e => updateFinishOverride('cabinetGrade', e.target.value)}>
                                    {FINISH_OVERRIDE_OPTIONS.cabinetGrade.map(option => <option key={option} value={option}>{option}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <Lbl htmlFor="survey-fixtureGrade">Fixture grade</Lbl>
                                <select id="survey-fixtureGrade" value={effectiveFinishValue('fixtureGrade')} onChange={e => updateFinishOverride('fixtureGrade', e.target.value)}>
                                    {FINISH_OVERRIDE_OPTIONS.fixtureGrade.map(option => <option key={option} value={option}>{option}</option>)}
                                </select>
                            </div>
                        </div>
                    </details>
                </div>
            );
            case 'indoorOutdoor': return <div key={field} className="space-y-1.5"><Lbl id="survey-indoorOutdoor-label">Indoor / Outdoor Flow</Lbl><BtnGrid field="indoorOutdoor" cols={1} options={['Minimal (enclosed feel)','Moderate (some connection)','Maximum (open to outdoors)']}/></div>;
            case 'naturalLight': return <div key={field} className="space-y-1.5"><Lbl id="survey-naturalLight-label">Natural Light Priority</Lbl><BtnGrid field="naturalLight" cols={1} options={['Balanced windows','Maximum glazing','Privacy first (fewer windows)']}/></div>;
            case 'features': return (
                <div key={field} className="space-y-2">
                    <Lbl>Special Rooms</Lbl>
                    <FeatureRoomControls survey={generationSurvey} onBusyChange={setFeaturePending}
                        onChange={(features, expectedKey) => setFormData(prev =>
                            JSON.stringify(surveyWithBedroomConfigurations(prev)) === expectedKey ? { ...prev, features } : prev)} />
                    {(formData.features||'').trim() && (
                        <div className="mt-1 p-2 bg-blue/5 border border-blue/15 rounded-xs">
                            <span className="mono text-[11px] uppercase text-blue">Selected: </span>
                            <span className="text-[12px] text-ink">{formData.features}</span>
                            <button onClick={() => upd('features', '')} className="ml-2 text-[12px] text-red/60 hover:text-red">clear</button>
                        </div>
                    )}
                </div>
            );
            case 'accessibilityNeeds': return (
                <div key={field} className="space-y-1.5">
                    <Lbl id="survey-accessibilityNeeds-label">Accessibility Needs</Lbl>
                    <BtnGrid field="accessibilityNeeds" options={
                        formData.stories === '2 Stories'
                            ? ['None','Wheelchair accessible','Wide doorways']
                            : ['None','Wheelchair accessible','Wide doorways','Single-level preferred']
                    }/>
                </div>
            );
            case 'budgetTier': return <div key={field} className="space-y-1.5"><Lbl id="survey-budgetTier-label">Budget Tier</Lbl><BtnGrid field="budgetTier" cols={1} options={[{val:'Entry ($120-180/sqft)',label:'Entry - $120-180/sqft',desc:'Efficient, value-optimized design'},{val:'Mid ($200-300/sqft)',label:'Mid - $200-300/sqft',desc:'Quality finishes, flexible layouts'},{val:'Luxury ($350+/sqft)',label:'Luxury - $350+/sqft',desc:'Premium materials, custom details'}]}/></div>;
            case 'foundationType': return (
                <div key={field} className="space-y-1.5">
                    <Lbl id="survey-foundationType-label">Foundation Type</Lbl>
                    <BtnGrid field="foundationType" cols={1} options={['Slab-on-grade','Crawl space','Full basement']}/>
                </div>
            );
            case 'hvacSystem': return (
                <div key={field} className="space-y-1.5">
                    <Lbl id="survey-hvacSystem-label">HVAC System</Lbl>
                    <BtnGrid field="hvacSystem" cols={1} options={['Forced air (gas)','Heat pump','Mini-split']}/>
                </div>
            );
            case 'outdoorLiving': return (
                <div key={field} className="space-y-1.5">
                    <Lbl id="survey-outdoorLiving-label">Outdoor Living</Lbl>
                    <BtnGrid field="outdoorLiving" cols={1} options={['None','Covered porch','Open deck','Screened porch','Patio']}/>
                </div>
            );
            case 'outdoorArea': {
                if ((formData.outdoorLiving || 'None') === 'None') return null;
                const outdoorArea = Math.max(0, Math.min(800, parseInt(formData.outdoorArea, 10) || 0));
                return (
                    <div key={field} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <Lbl htmlFor="survey-outdoorArea">Outdoor Area (sq ft)</Lbl>
                            <span className="mono text-[12px] text-mid">{outdoorArea} sqft</span>
                        </div>
                        <input
                            id="survey-outdoorArea"
                            type="range"
                            min="0"
                            max="800"
                            step="10"
                            value={outdoorArea}
                            onChange={e => upd('outdoorArea', e.target.value)}
                        />
                    </div>
                );
            }
            case 'lotWidth': return (
                <div key={field} className="space-y-1.5">
                    <Lbl htmlFor="survey-lotWidth">Lot Width (ft) — optional</Lbl>
                    <input id="survey-lotWidth" type="number" min="20" max="500" placeholder="e.g. 60" value={formData.lotWidth} onChange={e=>upd('lotWidth',e.target.value)} className="w-full"/>
                </div>
            );
            case 'lotDepth': return (
                <div key={field} className="space-y-1.5">
                    <Lbl htmlFor="survey-lotDepth">Lot Depth (ft) — optional</Lbl>
                    <input id="survey-lotDepth" type="number" min="20" max="500" placeholder="e.g. 120" value={formData.lotDepth} onChange={e=>upd('lotDepth',e.target.value)} className="w-full"/>
                </div>
            );
            case 'freeformWishes': return <div key={field} className="space-y-1.5"><Lbl htmlFor="survey-freeformWishes">Anything Else? (optional)</Lbl><textarea id="survey-freeformWishes" rows="3" placeholder="Specific wishes, must-haves, or notes..." value={formData.freeformWishes} onChange={e=>upd('freeformWishes',e.target.value)}/></div>;
            default: return null;
        }
    };

    const cur = SURVEY_STEPS[step];
    const isLast = step === SURVEY_STEPS.length - 1;

    return (
        <div>
            {/* Progress bar */}
            <div className="flex gap-1 mb-5">
                {SURVEY_STEPS.map((_,i) => <div key={i} className="flex-1 h-1 rounded-full transition-all duration-300" style={{background: i<=step ? 'var(--blue)' : 'rgba(0,0,0,0.07)'}}/>)}
            </div>
            <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                    <h3 className="studio-step-title">{cur.title}</h3>
                    <p className="text-[13px] mt-1" style={{color:'var(--ink-soft)'}}>{cur.subtitle} · step {step+1} of {SURVEY_STEPS.length}</p>
                </div>
                <button type="button" onClick={handleReset} className="cta-secondary px-4 py-3 text-[12px]">
                    Reset sample
                </button>
            </div>
            <div className="survey-step-row mb-5" aria-label="Survey steps">
                {SURVEY_STEPS.map((item, i) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => setStep(i)}
                        className={`survey-step-pill ${i === step ? 'active' : ''}`}
                        aria-current={i === step ? 'step' : undefined}
                    >
                        <span className="mono text-[11px] uppercase tracking-[0.22em] opacity-55">0{i + 1}</span>
                        <span>{item.title}</span>
                    </button>
                ))}
            </div>
            <p className="survey-quick-note">
                The sample residential brief is already filled in, so you can move quickly and adjust only what matters.
            </p>
            <div className="space-y-4 step-in" key={step}>
                {cur.fields.map(f => renderField(f))}
            </div>
            {currentPreflight && preflight?.blockers?.length > 0 && <div role="status" className="mt-4 border rounded-xs p-3 text-[13px]" style={{borderColor:'var(--control-edge)'}}>
                <p className="font-semibold">Review this combination</p>
                <ul className="mt-2 space-y-1">{preflight.blockers.map(item => <li key={item.code}>{item.message}</li>)}</ul>
                {preflight.blockers.some(item => String(item.code).startsWith('closet_area_ranges')) && (
                    <button type="button"
                        onClick={() => setFormData(prev => ({ ...prev, bedroomConfigs: generationSurvey.bedroomConfigs.map(c => ({ ...c, closet: 'Standard' })) }))}
                        className="mt-3 px-4 min-h-11 border text-[13px] font-semibold rounded-xs transition-colors hover:opacity-90 active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        style={actionStyle()}>
                        Use standard closets
                    </button>
                )}
                {!conflict && preflight.legacyFallbackEnabled && <p className="mt-2 text-mid">You can still generate: these choices use Keystone's simpler layout engine for now.</p>}
            </div>}
            {preflight?.unavailable && isLast && <p className="mt-3 text-[12px]">The advance check is unavailable. Your choices will be checked when you generate.</p>}
            <div className="flex gap-2.5 mt-5">
                {step > 0 && <button type="button" onClick={() => setStep(s=>s-1)} className="px-5 py-3 border border-black/10 text-[13px] font-semibold hover:border-ink transition-colors rounded-xs">Back</button>}
                {!isLast
                    ? <button type="button" onClick={() => setStep(s=>s+1)} className="flex-1 py-3 text-[13px] font-bold transition-colors rounded-xs border" style={actionStyle()}>Continue</button>
                    : <button type="button" onClick={onSubmit} disabled={isLoading || featurePending || !currentPreflight || conflict || preflight?.featureBlockers?.length > 0 || (preflight?.supported === false && preflight?.legacyFallbackEnabled === false)} className="flex-1 py-3 text-[13px] font-bold transition-colors disabled:opacity-50 rounded-xs border" style={actionStyle()}>
                        {isLoading ? 'Generating' : !currentPreflight ? 'Checking choices…' : 'Generate floor plan'}
                      </button>
                }
            </div>
        </div>
    );
};
