import React, { useEffect, useRef, useState } from 'react';
import { Blueprint as BlueprintIcon, ArrowsOut as ArrowsOutIcon, Minus as MinusIcon, Plus as PlusIcon } from '@phosphor-icons/react';
import { clamp } from '../lib/elevations.js';

export const InteractiveCanvas = ({ children, viewKey = '' }) => {
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [blueprintMode, setBlueprintMode] = useState(false);
    const containerRef = useRef(null);
    const contentRef = useRef(null);
    const drag = useRef(null);
    const pointers = useRef(new Map());
    const pinch = useRef(null);

    const clamp = (s) => Math.min(5, Math.max(0.2, s));

    const fitToView = React.useCallback(() => {
        const container = containerRef.current;
        const content = contentRef.current;
        if (!container || !content) return;
        const rect = container.getBoundingClientRect();
        const cw = content.scrollWidth || content.offsetWidth || 0;
        const ch = content.scrollHeight || content.offsetHeight || 0;
        if (!rect.width || !rect.height || !cw || !ch) return;
        // A flat 40px gutter costs a phone ~20% of its usable width and left
        // a wide plan sheet fitting at 19%. Scale the gutter to the viewport.
        const pad = rect.width < 600 ? 12 : 40;
        // On a phone the whole sheet fits at about 20%, which is unreadable.
        // Open narrow screens at the plan's own width instead and let the
        // visitor pan; the fit button still shows the whole sheet.
        const fitAll = Math.min((rect.width - pad * 2) / cw, (rect.height - pad * 2) / ch, 1);
        const next = rect.width < 600 ? Math.min(1, Math.max(fitAll, (rect.width * 1.9) / cw)) : fitAll;
        setScale(Math.max(0.15, next));
        // When zoomed past fit on a phone, start at the sheet's left edge
        // (the title and Level 1) rather than its middle.
        const overflow = cw * next - rect.width;
        setOffset({ x: next > fitAll && overflow > 0 ? overflow / 2 + pad : 0, y: 0 });
    }, []);

    // Fit when the DRAWING changes, not when the element identity changes.
    //
    // This effect used to depend on `children`, which React re-creates on every
    // parent render. Toggling "Room details", finishing a refinement, or a
    // render-status update therefore threw away the zoom and pan the user had
    // set. `viewKey` changes only when the plan, option or view actually
    // changes, so their position now survives an unrelated rerender.
    useEffect(() => {
        const id = requestAnimationFrame(() => fitToView());
        return () => cancelAnimationFrame(id);
    }, [viewKey, fitToView]);

    // Refit on resize only. The observer must not depend on children either.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        let raf = 0;
        const obs = new ResizeObserver(() => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => fitToView());
        });
        obs.observe(container);
        return () => { cancelAnimationFrame(raf); obs.disconnect(); };
    }, [fitToView]);

    // Cursor-anchored wheel zoom. Previously the transform origin was the
    // panel centre and the pointer position was ignored, so zooming walked
    // away from whatever you were looking at.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onWheel = (e) => {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            const px = e.clientX - rect.left - rect.width / 2;
            const py = e.clientY - rect.top - rect.height / 2;
            setScale((s) => {
                const next = clamp(s * (e.deltaY > 0 ? 0.9 : 1.1));
                const k = next / s;
                setOffset((o) => ({ x: px - (px - o.x) * k, y: py - (py - o.y) * k }));
                return next;
            });
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    // Pointer events, so pan works with touch and pen. The canvas previously
    // bound mouse events only and could not be panned on a phone at all.
    const onPointerDown = (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        // Never start a pan from a control.
        //
        // The surface calls setPointerCapture below so a drag survives the
        // pointer leaving it. Capture also redirects the pointerup, so a
        // press that began on the toolbar never produced a click and all
        // four canvas buttons - zoom in, zoom out, fit, blueprint - were
        // silently dead. Excluding controls here is what makes them live.
        if (e.target.closest('button, input, select, a, [role="button"]')) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        e.currentTarget.setPointerCapture(e.pointerId);
        if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), scale };
            drag.current = null;
            setIsDragging(false);
        } else {
            drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
            setIsDragging(true);
        }
    };

    const onPointerMove = (e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2 && pinch.current) {
            const [a, b] = [...pointers.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            setScale(clamp(pinch.current.scale * (d / pinch.current.d)));
        } else if (drag.current) {
            setOffset({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
        }
    };

    const endPointer = (e) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        if (pointers.current.size === 0) { drag.current = null; setIsDragging(false); }
    };

    const gridColor = blueprintMode ? 'rgba(120,165,235,0.13)' : 'rgba(255,255,255,0.045)';
    const gridSz = Math.max(8, Math.round(40 * scale));

    const ToolBtn = ({ onClick, label, active, children: icon }) => (
        <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClick(e); }}
            className={'canvas-tool' + (active ? ' is-active' : '')}
            aria-label={label}
            aria-pressed={active === undefined ? undefined : !!active}
        >{icon}</button>
    );

    return (
        <div
            ref={containerRef}
            className={'canvas-surface' + (blueprintMode ? ' is-blueprint' : '')}
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
        >
            <div className="canvas-grid" aria-hidden="true" style={{
                backgroundImage: 'linear-gradient(' + gridColor + ' 1px, transparent 1px), linear-gradient(90deg, ' + gridColor + ' 1px, transparent 1px)',
                backgroundSize: gridSz + 'px ' + gridSz + 'px',
                backgroundPosition: (offset.x % gridSz) + 'px ' + (offset.y % gridSz) + 'px',
            }}/>

            <div className="canvas-transform" style={{
                transform: 'translate(' + offset.x + 'px,' + offset.y + 'px) scale(' + scale + ')',
                transition: isDragging ? 'none' : 'transform 90ms var(--ease)',
            }}>
                {/* The sheet is the light source: a lit drawing on a dark table. */}
                <div ref={contentRef} className="canvas-sheet">{children}</div>
            </div>

            <div className="canvas-toolbar">
                <ToolBtn onClick={() => setScale((s) => clamp(s * 0.8))} label="Zoom out">
                    <MinusIcon size={20} weight="bold" aria-hidden="true"/>
                </ToolBtn>
                <span className="mono canvas-zoom">{Math.round(scale * 100)}%</span>
                <ToolBtn onClick={() => setScale((s) => clamp(s * 1.25))} label="Zoom in">
                    <PlusIcon size={20} weight="bold" aria-hidden="true"/>
                </ToolBtn>
                <span className="canvas-tool-sep" aria-hidden="true"/>
                <ToolBtn onClick={fitToView} label="Fit drawing to view">
                    <ArrowsOutIcon size={20} weight="bold" aria-hidden="true"/>
                </ToolBtn>
                <ToolBtn onClick={() => setBlueprintMode((m) => !m)} label="Blueprint background" active={blueprintMode}>
                    <BlueprintIcon size={20} weight="bold" aria-hidden="true"/>
                </ToolBtn>
            </div>
        </div>
    );
};
