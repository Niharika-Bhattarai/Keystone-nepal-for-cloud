import React from 'react';
import { profileLabel } from '../lib/format.js';

export const PlanSummaryPanel = ({ planSpec, openingDiagnostics }) => {
    if (!planSpec) return null;
    const allRooms = (planSpec.levels||[]).flatMap(l => l.rooms||[]);
    const diag = openingDiagnostics || planSpec?.openingDiagnostics || null;
    const totals = diag?.totals || null;
    const profiles = diag?.profiles || null;
    const roomCounts = {};
    allRooms.forEach(r => { const t = r.label||r.type; roomCounts[t] = (roomCounts[t]||0)+1; });
    return (
        <div className="paper-panel p-4 md:p-5 mt-4">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div>
                    <p className="mono text-[11px] uppercase tracking-[0.24em]" style={{color:'var(--accent)'}}>Generated plan summary</p>
                    <p className="text-[13px] leading-relaxed mt-2" style={{color:'var(--ink)'}}>This is the live floor plan output currently available in Keystone AI today.</p>
                </div>
                <div className="mono text-[11px] uppercase tracking-[0.22em]" style={{color:'var(--ink-soft)'}}>
                    Download-ready PNG
                </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4 mt-4">
                <div className="spec-panel"><div className="spec-label">Area</div><div className="spec-value">{(planSpec.totalAreaSqFt||0).toLocaleString()} sqft</div></div>
                <div className="spec-panel"><div className="spec-label">Stories</div><div className="spec-value">{planSpec.stories}</div></div>
                <div className="spec-panel"><div className="spec-label">Levels</div><div className="spec-value">{(planSpec.levels||[]).length}</div></div>
            </div>
            {planSpec.surveyFulfillment?.freeformWishes?.status === 'not_applied' && (
                <p role="status" className="text-sm leading-relaxed border border-amber-300 bg-amber-50 rounded-lg p-3 mb-4">
                    Your additional request could not be included in this option. {planSpec.surveyFulfillment.freeformWishes.reason}
                </p>
            )}
            <div className="flex flex-wrap gap-1.5">
                {Object.entries(roomCounts).map(([label, count]) => (
                    <span key={label} className="room-badge active" style={{cursor:'default'}}>{label}{count > 1 ? ` x${count}` : ''}</span>
                ))}
            </div>
            {diag && (
                <div className="rounded-[14px] border border-black/8 bg-white/70 p-3 mt-4">
                    <p className="mono text-[11px] uppercase tracking-[0.2em]" style={{color:'var(--ink-soft)'}}>Opening diagnostics</p>
                    <div className="grid grid-cols-3 gap-2 mt-3">
                        <div className="spec-panel"><div className="spec-label">Openings</div><div className="spec-value">{profileLabel(profiles?.openingProfile)}</div></div>
                        <div className="spec-panel"><div className="spec-label">Indoor/Outdoor</div><div className="spec-value">{profileLabel(profiles?.indoorOutdoorProfile)}</div></div>
                        <div className="spec-panel"><div className="spec-label">Doorways</div><div className="spec-value">{profileLabel(profiles?.doorwayProfile)}</div></div>
                    </div>
                    {totals && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                            <span className="room-badge active" style={{cursor:'default'}}>Windows {Number(totals.windowCount || 0)}</span>
                            <span className="room-badge active" style={{cursor:'default'}}>Exterior doors {Number(totals.exteriorDoorCount || 0)}</span>
                            <span className="room-badge active" style={{cursor:'default'}}>Wide doors {Number(totals.wideDoorCount || 0)}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
