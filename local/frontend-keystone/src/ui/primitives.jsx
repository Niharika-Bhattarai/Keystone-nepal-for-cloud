import React from 'react';

export const DisclosureToggle = ({ expanded, hiddenCount, onToggle, label = 'items', ariaControls }) => {
    if (!hiddenCount && !expanded) return null;
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            {...(ariaControls ? { 'aria-controls': ariaControls } : {})}
            className="mono text-[12px] uppercase tracking-[0.18em]"
        >
            {expanded ? 'Show less' : `View all ${label}${hiddenCount ? ` (+${hiddenCount})` : ''}`}
        </button>
    );
};

export const SmartImage = ({ eager = false, ...props }) => (
    <img
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={eager ? 'high' : 'auto'}
        {...props}
    />
);
