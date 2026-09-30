import React, { useEffect, useRef, useState } from 'react';
import { featureChoicesFor, featureCount, withFeatureCount } from '../lib/featureRooms.js';

export function FeatureRoomControls({ survey, onChange, onBusyChange }) {
    const key = JSON.stringify(survey);
    const currentKey = useRef(key);
    currentKey.current = key;
    const request = useRef(null);
    const [pending, setPending] = useState(null);
    const [notice, setNotice] = useState(null);
    useEffect(() => {
        setNotice(null);
        setPending(null);
        onBusyChange(false);
        return () => { request.current?.abort(); request.current = null; onBusyChange(false); };
    }, [key, onBusyChange]);

    async function changeCount(choice, nextCount) {
        request.current?.abort();
        const next = withFeatureCount(survey.features, choice.kind, nextCount);
        setNotice(null);
        if (nextCount < featureCount(survey.features, choice.kind)) {
            setPending(null); onBusyChange(false); onChange(next, key); return;
        }
        const controller = new AbortController();
        request.current = controller;
        setPending(choice.kind); onBusyChange(true);
        let timedOut = false;
        const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
        try {
            const response = await fetch('/api/plan/preflight', { method: 'POST', signal: controller.signal,
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ surveyData: { ...survey, features: next } }) });
            if (!response.ok) throw new Error('Preflight unavailable');
            const result = await response.json();
            if (controller.signal.aborted || currentKey.current !== key) return;
            if (result.supported === true) onChange(next, key);
            else setNotice({ kind: choice.kind, message: result.featureBlockers?.[0]?.message || result.blockers?.[0]?.message || 'This combination is not supported yet. Try fewer rooms or adjust the house size.' });
        } catch (error) {
            if (currentKey.current === key && (!controller.signal.aborted || timedOut)) {
                setNotice({ kind: choice.kind, message: 'Room availability could not be checked. Your selections are unchanged; try again.' });
            }
        } finally {
            clearTimeout(deadline);
            if (request.current === controller) { request.current = null; setPending(null); onBusyChange(false); }
        }
    }

    return <div className="space-y-2">
        <p className="text-[13px] text-mid">Choose how many of each room you need. Additions are checked against your house size and other selections.</p>
        <div>
            {featureChoicesFor(survey.features).map(choice => {
                const count = featureCount(survey.features, choice.kind);
                const messageId = `feature-message-${choice.kind}`;
                return <div key={choice.kind} className="py-2 border-b last:border-b-0" style={{ borderColor: 'var(--control-edge)' }}>
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-[13px] font-semibold">{choice.label}</span>
                        <div className="flex items-center gap-2 shrink-0" role="group" aria-label={`${choice.label} quantity`}>
                            <button type="button" className="border rounded-xs w-11 h-11 text-lg disabled:opacity-40"
                                style={{ borderColor: 'var(--control-edge)', background: 'var(--chip-bg)' }}
                                aria-label={`Remove one ${choice.value}`} disabled={count === 0}
                                onClick={() => changeCount(choice, count - 1)}>−</button>
                            <output className="mono text-[14px] text-center min-w-6" aria-label={`${choice.value} count`} aria-live="polite">{count}</output>
                            <button type="button" className="border rounded-xs w-11 h-11 text-lg disabled:opacity-40"
                                style={{ borderColor: 'var(--control-edge)', background: 'var(--chip-bg)' }}
                                aria-label={`Add ${choice.value}`} aria-describedby={notice?.kind === choice.kind ? messageId : undefined}
                                disabled={Boolean(pending) || count >= 32} onClick={() => changeCount(choice, count + 1)}>+</button>
                        </div>
                    </div>
                    {pending === choice.kind && <p role="status" className="text-[12px] mt-1 text-mid">Checking this room combination…</p>}
                    {notice?.kind === choice.kind && <p id={messageId} role="status" className="text-[13px] mt-2 leading-relaxed">{notice.message}</p>}
                </div>;
            })}
        </div>
    </div>;
}
