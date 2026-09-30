import React, { useEffect, useId, useState } from 'react';
import { GRID, MARK, toPath } from '../data/keystoneMark.js';

/* The Keystone AI mark: an arch of voussoirs on coursed piers, locked by a brass
   keystone (geometry in src/data/keystoneMark.js; see brand/README.md).

   motion:
   - "intro": the arch is set pair by pair from its piers up, the keystone drops
     into the crown and settles, and one light glints across. Plays once per visit.
   - "loop":  the same building, repeated, as the working indicator.
   - "none":  still.
   Hover or focus on a lockup lifts the keystone and lets it settle again (CSS).
   Reduced motion shows the finished mark. */

export const KEYSTONE_BRASS = '#B0843A';
const INTRO_KEY = 'keystone:mark-intro';

const introPlayed = () => {
    try { return sessionStorage.getItem(INTRO_KEY) === '1'; } catch { return false; }
};

export const Mark = ({ size = 26, tile = null, ink = 'currentColor', keystone = KEYSTONE_BRASS, sheen = '#FFFFFF', title, motion = 'none' }) => {
    const clip = `ks-clip-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
    const [mode] = useState(() => (motion === 'intro' && introPlayed() ? 'none' : motion));
    useEffect(() => {
        if (mode !== 'intro') return;
        try { sessionStorage.setItem(INTRO_KEY, '1'); } catch { /* private mode: it plays again */ }
    }, [mode]);
    const stones = [
        ...MARK.piers.map((points, i) => ({ key: `p${i}`, d: toPath(points), order: 0 })),
        ...MARK.voussoirs.map((v, i) => ({ key: `v${i}`, d: toPath(v.points), order: v.order })),
    ];
    const keyPath = toPath(MARK.key);
    return (
        <svg className={`ks-mark${mode !== 'none' ? ` is-${mode}` : ''}`} width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`}
            role={title ? 'img' : undefined} aria-hidden={title ? undefined : 'true'} aria-label={title || undefined} focusable="false">
            <defs>
                <clipPath id={clip}>{stones.map((s) => <path key={s.key} d={s.d}/>)}<path d={keyPath}/></clipPath>
                <linearGradient id={`${clip}-g`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor={sheen} stopOpacity="0"/>
                    <stop offset="0.5" stopColor={sheen} stopOpacity="0.7"/>
                    <stop offset="1" stopColor={sheen} stopOpacity="0"/>
                </linearGradient>
            </defs>
            {tile && <rect x="0" y="0" width={GRID} height={GRID} rx="8" fill={tile}/>}
            <g fill={ink}>
                {stones.map((s) => <path key={s.key} className="ks-stone" style={{ '--o': s.order }} d={s.d}/>)}
            </g>
            <path className="ks-key" fill={keystone} d={keyPath}/>
            {mode !== 'none' && (
                <g clipPath={`url(#${clip})`} aria-hidden="true">
                    <rect className="ks-sheen" x="-14" y="0" width="12" height={GRID} fill={`url(#${clip}-g)`} transform="skewX(-18)"/>
                </g>
            )}
        </svg>
    );
};

/* The lockup: mark plus "Keystone AI". */
export const Wordmark = ({ motion = 'none', size }) => (
    <><Mark motion={motion} size={size}/><b>Keystone</b><span>AI</span></>
);
