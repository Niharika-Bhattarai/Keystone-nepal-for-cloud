import React, { useEffect, useRef, useState } from 'react';

// A menu button (WAI-ARIA menu-button pattern). C7 keyboard journeys found the old
// menu announced role="menu" but left focus on the trigger, ignored the arrow keys,
// stayed open after Tab moved on, and dropped focus to the page after a download.
// Now: Enter, Space or ArrowDown opens on the first item (ArrowUp on the last), the
// arrows, Home and End move between items, Escape closes, Tab closes and moves on,
// and choosing an item returns focus to the Download button.
export const DownloadMenu = ({ items, disabled }) => {
    const [open, setOpen] = useState(false);
    const [focusOn, setFocusOn] = useState(null); // 'first' | 'last' | null
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    const listRef = useRef(null);

    const usable = items.filter((i) => !i.hidden);
    const enabledItems = () => [...(listRef.current?.querySelectorAll('[role=menuitem]:not(:disabled)') || [])];

    const close = (returnFocus) => {
        setOpen(false);
        if (returnFocus) triggerRef.current?.focus();
    };

    useEffect(() => {
        if (!open) return;
        const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            close(true);
        };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open || !focusOn) return;
        const list = enabledItems();
        (focusOn === 'last' ? list[list.length - 1] : list[0])?.focus();
        setFocusOn(null);
    }, [open, focusOn]);

    const onTriggerKey = (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            setFocusOn(e.key === 'ArrowUp' ? 'last' : 'first');
        }
    };
    const onTriggerClick = (e) => {
        if (open) { setOpen(false); return; }
        setOpen(true);
        // A keyboard click (Enter or Space) reports detail 0: take focus into the menu.
        // A pointer click leaves focus where it is.
        if (e.detail === 0) setFocusOn('first');
    };
    const onListKey = (e) => {
        const list = enabledItems();
        const at = list.indexOf(document.activeElement);
        const move = (i) => { e.preventDefault(); list[(i + list.length) % list.length]?.focus(); };
        if (e.key === 'ArrowDown') move(at + 1);
        else if (e.key === 'ArrowUp') move(at - 1);
        else if (e.key === 'Home') move(0);
        else if (e.key === 'End') move(list.length - 1);
    };

    // Tab (or anything else) that takes focus out of the menu closes it, after the
    // browser has moved focus on.
    const onBlur = (e) => { if (open && !wrapRef.current?.contains(e.relatedTarget)) setOpen(false); };

    return (
        <div className="dl-menu" ref={wrapRef} onBlur={onBlur}>
            <button
                type="button"
                ref={triggerRef}
                className="studio-btn studio-btn-quiet"
                disabled={disabled}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={onTriggerClick}
                onKeyDown={onTriggerKey}
            >
                Download
                <span className="dl-caret" aria-hidden="true"/>
            </button>
            {open && (
                <div className="dl-menu-list" role="menu" aria-label="Downloads" ref={listRef} onKeyDown={onListKey}>
                    {usable.map((item) => (
                        <button
                            key={item.label}
                            type="button"
                            role="menuitem"
                            tabIndex={-1}
                            className="dl-menu-item"
                            disabled={item.disabled}
                            aria-label={item.aria}
                            onClick={() => { close(true); item.onClick(); }}
                        >
                            <span className="dl-menu-label">{item.label}</span>
                            {item.note && <span className="dl-menu-note">{item.note}</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
