import React from 'react';
import { REFINEMENT_SUGGESTIONS } from '../data/content.js';

export const RefinementPanel = ({ planSpec, formData, refinementsLeft, refinementHistory, onRefine, isLoading }) => {
    const [custom, setCustom] = React.useState('');
    const historyRef = React.useRef(null);

    // Auto-scroll history to bottom when new messages arrive
    React.useEffect(() => {
        if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }, [refinementHistory]);

    if (!planSpec) return null;

    const handleCustom = (e) => {
        e.preventDefault();
        if (!custom.trim() || isLoading || refinementsLeft <= 0) return;
        onRefine(custom.trim());
        setCustom('');
    };

    const disabled = isLoading || refinementsLeft <= 0;
    const countColor = refinementsLeft > 5 ? 'var(--blue)' : refinementsLeft > 2 ? 'var(--gold)' : 'var(--red)';

    return (
        <div className="border-t border-black/8">
            <div className="flex items-center justify-between px-4 md:px-5 pt-4 pb-2">
                <div className="flex items-center gap-2">
                    <span style={{width:'6px',height:'6px',borderRadius:'50%',background:'var(--accent)',display:'inline-block'}}/>
                    <p className="mono text-[11px] uppercase tracking-[0.24em] font-bold" style={{color:'var(--ink)'}}>Studio notes</p>
                </div>
                <span className="mono text-[12px] font-bold" style={{color: countColor}}>
                    {refinementsLeft}/10 edits left
                </span>
            </div>
            <div className="px-4 md:px-5 pb-3">
                <p className="text-[13px] leading-relaxed" style={{color:'var(--ink)'}}>
                    Use quick edits to explore the floor plan before you export it or move into the Exterior Render.
                </p>
            </div>

            {refinementHistory.length > 0 && (
                <div ref={historyRef} className="mx-4 md:mx-5 mb-3 max-h-40 overflow-y-auto rounded-[14px]"
                    style={{background:'rgba(255,255,255,0.86)',border:'1px solid var(--ink-soft)'}}>
                    {refinementHistory.map((msg, i) => (
                        <div key={i} className="px-3 py-2.5 border-b last:border-0" style={{borderColor:'var(--ink-soft)'}}>
                            {msg.role === 'user' && (
                                <div className="flex gap-2 items-start">
                                    <span className="mono text-[11px] uppercase pt-0.5 shrink-0 font-bold" style={{color:'var(--d-accent)'}}>You</span>
                                    <span className="text-[13px] leading-snug" style={{color:'var(--ink)'}}>{msg.content}</span>
                                </div>
                            )}
                            {msg.role === 'assistant' && (
                                <div className="flex gap-2 items-start">
                                    <span className="mono text-[11px] uppercase pt-0.5 shrink-0 font-bold" style={{color:'var(--ink-soft)'}}>Studio</span>
                                    <span className="text-[13px] leading-snug" style={{color:'var(--accent)'}}>Updated: {msg.content}</span>
                                </div>
                            )}
                            {msg.role === 'error' && (
                                <div className="flex gap-2 items-start">
                                    <span className="mono text-[11px] uppercase pt-0.5 shrink-0 font-bold" style={{color:'var(--d-err)'}}>Error</span>
                                    <span className="text-[13px] leading-snug" style={{color:'var(--d-err)'}}>{msg.content}</span>
                                </div>
                            )}
                        </div>
                    ))}
                    {isLoading && (
                        <div className="px-3 py-2 flex items-center gap-2">
                            <div className="w-3 h-3 border-2 border-blue border-t-transparent rounded-full animate-spin shrink-0"/>
                            <span className="mono text-[11px] uppercase tracking-widest animate-pulse" style={{color:'var(--ink-soft)'}}>Updating the plan...</span>
                        </div>
                    )}
                </div>
            )}
            {isLoading && refinementHistory.length === 0 && (
                <div className="mx-4 md:mx-5 mb-3 px-3 py-2 flex items-center gap-2 rounded-[14px]" style={{background:'rgba(255,255,255,0.82)', border:'1px solid var(--ink-soft)'}}>
                    <div className="w-3 h-3 border-2 border-blue border-t-transparent rounded-full animate-spin shrink-0"/>
                    <span className="mono text-[11px] uppercase tracking-widest animate-pulse" style={{color:'var(--ink-soft)'}}>Updating the plan...</span>
                </div>
            )}

            <div className="flex flex-wrap gap-1.5 px-4 md:px-5 mb-3">
                {REFINEMENT_SUGGESTIONS.map((s, i) => (
                    <button key={i} disabled={disabled} onClick={() => onRefine(s)}
                        className="text-[12px] px-2.5 py-1.5 border transition-colors disabled:opacity-30 rounded-full"
                        style={{borderColor:'var(--ink-soft)',background:'rgba(255,255,255,0.72)',color:'var(--ink)'}}>
                        {s}
                    </button>
                ))}
            </div>

            <form onSubmit={handleCustom} className="flex gap-2 px-4 md:px-5 pb-5">
                <input
                    type="text"
                    aria-label="Describe a change to the plan"
                    value={custom}
                    onChange={e => setCustom(e.target.value)}
                    placeholder={disabled ? 'No edits left' : 'e.g. Make the living room 6 feet wider'}
                    disabled={disabled}
                    className="flex-1 text-sm px-3 py-2 border rounded-[14px] focus:outline-hidden disabled:opacity-40"
                    style={{background:'rgba(255,255,255,0.92)',borderColor:'rgba(255,255,255,0.18)'}}
                />
                <button type="submit" disabled={disabled || !custom.trim()}
                    className="px-4 py-2 cta-hero text-[12px] disabled:opacity-30 whitespace-nowrap">
                    Apply
                </button>
            </form>

            {refinementsLeft === 0 && (
                <p className="mono text-[12px] font-bold uppercase px-4 md:px-5 pb-4" style={{color:'var(--d-err)'}}>
                    Included edits used. Request guided access if you need a deeper session.
                </p>
            )}
        </div>
    );
};
