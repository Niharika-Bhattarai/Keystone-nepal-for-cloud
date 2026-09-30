import React, { useEffect, useMemo } from 'react';
import { DEFAULT_VISIBLE_ASSEMBLIES, DEFAULT_VISIBLE_LINE_ITEMS, DEFAULT_VISIBLE_NOTES } from '../data/brand.js';
import { useClampedList } from '../hooks/useClampedList.js';
import { formatQuantity, formatUsd } from '../lib/format.js';
import { DisclosureToggle } from '../ui/primitives.jsx';

export const EstimatePanel = ({ estimate }) => {
    const estimateId = React.useId();
    const summary = estimate?.summary || {};
    const costRange = estimate?.costRange || {};
    const lineItems = Array.isArray(costRange.lineItems) ? costRange.lineItems : [];
    const assemblies = Array.isArray(estimate?.takeoff?.assemblies) ? estimate.takeoff.assemblies : [];
    const assumptions = Array.isArray(estimate?.assumptions?.notes) ? estimate.assumptions.notes : [];
    const lineItemDisclosure = useClampedList(lineItems, DEFAULT_VISIBLE_LINE_ITEMS);
    const assemblyDisclosure = useClampedList(assemblies, DEFAULT_VISIBLE_ASSEMBLIES);
    const noteDisclosure = useClampedList(assumptions, DEFAULT_VISIBLE_NOTES);
    const estimateDisclosureKey = useMemo(() => JSON.stringify({
        lineItems: lineItems.map((item) => [item.key, item.label, item.quantity, item.unit, item.target, item.notes]),
        assemblies: assemblies.map((item) => [item.key, item.label, item.quantity, item.unit, item.notes]),
        assumptions,
        total: [costRange?.total?.low, costRange?.total?.target, costRange?.total?.high],
        summary: [summary.rateFamily, summary.roofKind, summary.budgetTier],
    }), [lineItems, assemblies, assumptions, costRange?.total?.low, costRange?.total?.target, costRange?.total?.high, summary.rateFamily, summary.roofKind, summary.budgetTier]);
    const bathCount = Number(summary.bathCount || 0);

    useEffect(() => {
        lineItemDisclosure.setExpanded(false);
        assemblyDisclosure.setExpanded(false);
        noteDisclosure.setExpanded(false);
    }, [estimateDisclosureKey]);

    if (!estimate) return null;

    const showLineItemToggle = lineItemDisclosure.hiddenCount > 0 || lineItemDisclosure.expanded;
    const showAssemblyToggle = assemblyDisclosure.hiddenCount > 0 || assemblyDisclosure.expanded;
    const showNoteToggle = noteDisclosure.hiddenCount > 0 || noteDisclosure.expanded;
    const lineItemsId = `${estimateId}-line-items`;
    const assembliesId = `${estimateId}-assemblies`;
    const assumptionsId = `${estimateId}-assumptions`;

    return (
        <div className="paper-panel mt-4 overflow-hidden">
            <div className="p-4 md:p-5 border-b border-black/5 bg-white/40">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                    <div>
                        <p className="mono text-[11px] uppercase tracking-[0.24em]" style={{color:'var(--accent)'}}>Cost estimate</p>
                        <p className="text-[13px] leading-relaxed mt-2" style={{color:'var(--ink)'}}>
                            Concept-level quantity takeoff and cost range generated directly from the live plan geometry.
                        </p>
                    </div>
                    <span className="mono text-[11px] uppercase tracking-[0.22em]" style={{color:'var(--ink-soft)'}}>
                        USD • {summary.rateFamily || 'MID'} rates
                    </span>
                </div>
            </div>

            <div className="p-4 md:p-5">
                <div className="grid grid-cols-2 xl:grid-cols-5 gap-2 mb-4">
                    <div className="spec-panel" style={{gridColumn:'span 2'}}>
                        <div className="spec-label">Cost range</div>
                        <div className="spec-value" style={{fontSize:'1rem'}}>{formatUsd(costRange?.total?.low)} - {formatUsd(costRange?.total?.high)}</div>
                        <div className="mono text-[11px] uppercase mt-1" style={{color:'var(--ink-soft)'}}>Target {formatUsd(costRange?.total?.target)}</div>
                    </div>
                    <div className="spec-panel"><div className="spec-label">Conditioned area</div><div className="spec-value">{formatQuantity(summary.conditionedAreaSqFt, 'sqft')}</div></div>
                    <div className="spec-panel"><div className="spec-label">Roof area</div><div className="spec-value">{formatQuantity(summary.estimatedRoofSurfaceAreaSqFt, 'sqft')}</div></div>
                    <div className="spec-panel"><div className="spec-label">Windows</div><div className="spec-value">{formatQuantity(summary.windowCount, 'total')}</div><div className="mono text-[11px] uppercase mt-1" style={{color:'var(--ink-soft)'}}>{formatQuantity(summary.roughGlazingAreaSqFt, 'sqft glazing')}</div></div>
                    <div className="spec-panel"><div className="spec-label">Baths</div><div className="spec-value">{bathCount}</div></div>
                </div>

                <div className="grid lg:grid-cols-2 gap-4">
                    <div className="rounded-[18px] border border-black/8 overflow-hidden bg-white/72">
                        <div className="px-4 py-3 border-b border-black/6">
                            <p className="mono text-[11px] uppercase tracking-[0.22em]" style={{color:'var(--ink-soft)'}}>Cost line items</p>
                        </div>
                        <div id={lineItemsId} className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="mono text-[11px] uppercase tracking-[0.18em]" style={{color:'var(--ink-soft)'}}>
                                        <th className="px-4 py-2">Item</th>
                                        <th className="px-2 py-2">Qty</th>
                                        <th className="px-2 py-2">Target</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lineItemDisclosure.visible.map((item) => (
                                        <tr key={item.key} className="border-t border-black/5 text-[13px]" style={{color:'var(--ink)'}}>
                                            <td className="px-4 py-2.5">
                                                <div className="font-medium">{item.label}</div>
                                                {item.notes && <div className="text-[12px] mt-0.5" style={{color:'var(--ink-soft)'}}>{item.notes}</div>}
                                            </td>
                                            <td className="px-2 py-2.5">{formatQuantity(item.quantity, item.unit === 'percent' ? '%' : item.unit)}</td>
                                            <td className="px-2 py-2.5 font-medium">{formatUsd(item.target)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {showLineItemToggle && (
                            <div className="px-4 py-3 border-t border-black/6">
                                <DisclosureToggle
                                    expanded={lineItemDisclosure.expanded}
                                    hiddenCount={lineItemDisclosure.hiddenCount}
                                    onToggle={() => lineItemDisclosure.setExpanded((value) => !value)}
                                    label="line items"
                                    ariaControls={lineItemsId}
                                />
                            </div>
                        )}
                    </div>

                    <div className="rounded-[18px] border border-black/8 overflow-hidden bg-white/72">
                        <div className="px-4 py-3 border-b border-black/6">
                            <p className="mono text-[11px] uppercase tracking-[0.22em]" style={{color:'var(--ink-soft)'}}>Quantity takeoff</p>
                        </div>
                        <div id={assembliesId} className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="mono text-[11px] uppercase tracking-[0.18em]" style={{color:'var(--ink-soft)'}}>
                                        <th className="px-4 py-2">Item</th>
                                        <th className="px-2 py-2">Quantity</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {assemblyDisclosure.visible.map((item) => (
                                        <tr key={item.key} className="border-t border-black/5 text-[13px]" style={{color:'var(--ink)'}}>
                                            <td className="px-4 py-2.5">
                                                <div className="font-medium">{item.label}</div>
                                                {item.notes && <div className="text-[12px] mt-0.5" style={{color:'var(--ink-soft)'}}>{item.notes}</div>}
                                            </td>
                                            <td className="px-2 py-2.5">{formatQuantity(item.quantity, item.unit)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {showAssemblyToggle && (
                            <div className="px-4 py-3 border-t border-black/6">
                                <DisclosureToggle
                                    expanded={assemblyDisclosure.expanded}
                                    hiddenCount={assemblyDisclosure.hiddenCount}
                                    onToggle={() => assemblyDisclosure.setExpanded((value) => !value)}
                                    label="items"
                                    ariaControls={assembliesId}
                                />
                            </div>
                        )}
                    </div>
                </div>

                <div id={assumptionsId} className="rounded-[18px] border border-black/8 bg-white/64 p-4 mt-4">
                    <p className="mono text-[11px] uppercase tracking-[0.22em]" style={{color:'var(--ink-soft)'}}>Assumptions</p>
                    <div className="flex flex-wrap gap-2 mt-3">
                        <span className="room-badge active" style={{cursor:'default'}}>Concept / cost estimate</span>
                        <span className="room-badge active" style={{cursor:'default'}}>Roof: {String(summary.roofKind || 'gabled').replace(/_/g, ' ')}</span>
                        <span className="room-badge active" style={{cursor:'default'}}>Budget: {summary.budgetTier || 'MID'}</span>
                    </div>
                    <div className="mt-3 text-[13px] leading-relaxed" style={{color:'var(--ink)'}}>
                        {noteDisclosure.visible.map((note) => (
                            <p key={note} className="mt-1 first:mt-0">{note}</p>
                        ))}
                    </div>
                    {showNoteToggle && (
                        <div className="mt-3">
                            <DisclosureToggle
                                expanded={noteDisclosure.expanded}
                                hiddenCount={noteDisclosure.hiddenCount}
                                onToggle={() => noteDisclosure.setExpanded((value) => !value)}
                                label="notes"
                                ariaControls={assumptionsId}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
