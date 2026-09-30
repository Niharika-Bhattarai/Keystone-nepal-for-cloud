import { PLAN_DEADLINE_MS, PLAN_OFFLINE, PLAN_SLOW, planFailureMessage } from '../lib/planRequest.js';
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X as XIcon } from '@phosphor-icons/react';
import { useProjectSave } from '../lib/useProjectSave.js';
import { DEFAULT_FORM_DATA, normalizeSurveyFeatures } from '../data/survey.js';
import { surveyWithBedroomConfigurations } from '../lib/bedroomConfigurations.js';
import { buildPlanExportFilename, profileLabel } from '../lib/format.js';
import { composeElevationReferenceSheet, svgToPngDataUrl } from '../lib/raster.js';
import { createEmptyRenderState, getInitialStudioSession, normalizeRenderState, studioSessionKey } from '../lib/storage.js';
import { BlueprintPresentationSheet } from './BlueprintPresentationSheet.jsx';
import { DownloadMenu } from './DownloadMenu.jsx';
import { ElevationsPanel } from './ElevationsPanel.jsx';
import { LocatedEstimate } from './LocatedEstimate.jsx';
import { InteractiveCanvas } from './InteractiveCanvas.jsx';
import { PlanSummaryPanel } from './PlanSummaryPanel.jsx';
import { RefinementPanel } from './RefinementPanel.jsx';
import { Render3DPanel } from './Render3DPanel.jsx';
import { SurveyForm } from './SurveyForm.jsx';
import { CloseIcon } from '../ui/icons.jsx';
import { safeSvg } from '../lib/safeSvg.js';
import { gateFor, LOCAL_STUDIO, useAccount } from '../lib/account.jsx';
import { NepalBrief } from './NepalBrief.jsx';
import { useSite } from '../site/SiteShell.jsx';
import { Mark } from '../site/Mark.jsx';
const Model3D = lazy(() => import('./Model3D.jsx'));
const PlanEditor = lazy(() => import('./PlanEditor.jsx'));

// â"€â"€â"€ DESIGN GENERATOR â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export const DesignGenerator = props => {
    const acct = useAccount();
    const previous = useRef(undefined);
    const boot = useRef(null);
    const owner = acct.authUser?.uid || null;
    if (!acct.ready) return <p className="studio-empty-note" role="status">Opening your studio...</p>;
    if (acct.me.deletion) return <div className="studio-save-status" role="status"><p>Account deletion is {acct.me.deletion.state === 'complete' ? 'complete' : 'pending'}. Saving and generation for this account are closed.</p><a href="/account">View deletion status</a></div>;
    if (previous.current !== owner) {
        let draft = getInitialStudioSession(owner);
        // Adopt only the anonymous work from this open studio's sign-in journey.
        // Never transfer a signed-in owner's draft to a different account.
        if (!draft && owner && previous.current === null) {
            const anonymous = getInitialStudioSession(null);
            if (anonymous) draft = { ...anonymous, ownerUid: owner, projectId: null, projectRevision: 0 };
            try { localStorage.removeItem(studioSessionKey(null)); } catch { /* browser storage unavailable */ }
        }
        boot.current = draft;
        previous.current = owner;
    }
    return <OwnedDesignGenerator key={owner || 'anonymous'} {...props} ownerUid={owner} restoredSession={boot.current}/>;
};

const OwnedDesignGenerator = ({ onOpenModal, initialBrief = null, ownerUid, restoredSession }) => {
    const initialSessionRef = useRef(restoredSession);
    const initialSession = initialSessionRef.current;
    const acct = useAccount();
    const site = useSite();
    const isUnlocked = acct.tier === 'pro';
    const [accessToken, setAccessToken] = useState(null);
    useEffect(() => {
        let alive = true;
        const pull = () => acct.getToken().then((t) => { if (alive) setAccessToken(t); }).catch(() => {});
        pull();
        const id = window.setInterval(pull, 10 * 60 * 1000); // ID tokens last an hour
        return () => { alive = false; window.clearInterval(id); };
    }, [acct.authUser]); // eslint-disable-line react-hooks/exhaustive-deps
    const authHeader = async () => { const t = await acct.getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; };

    const [formData, setFormData] = useState(() => {
        const saved = { ...DEFAULT_FORM_DATA, ...(initialSession?.formData || {}) };
        if (Array.isArray(saved.bedroomConfigs)) saved.privateBaths = String(saved.bedroomConfigs.filter(c=>c.privateBath === 'Yes').length);
        return { ...saved, features: normalizeSurveyFeatures(saved.features, saved.surveyVersion) };
    });
    const [surveyMode, setSurveyMode] = useState(() => initialSession?.planSpec ? 'baseline' : 'nepal');

    // A brief typed in the hero arrives here as {patch, read}. Merge it into the
    // survey and surface what was understood, so the reading is visible and
    // correctable rather than silently applied.
    // Replaces twelve blocking alert() dialogs. A notice never steals focus,
    // never costs the user their place in the studio, and is announced.
    const [notices, setNotices] = useState([]);
    const noticeSeq = useRef(0);
    const notify = React.useCallback((kind, message, detail) => {
        const id = ++noticeSeq.current;
        setNotices((list) => [...list.slice(-2), { id, kind, message, detail }]);
        if (kind !== 'error') {
            window.setTimeout(() => setNotices((l) => l.filter((n) => n.id !== id)), 6000);
        }
    }, []);
    const dismissNotice = (id) => setNotices((l) => l.filter((n) => n.id !== id));

    // A 422 carries diagnostics worth reading. They were being discarded.
    const [layoutFailure, setLayoutFailure] = useState(null);


    const [briefReading, setBriefReading] = useState(null);
    useEffect(() => {
        if (!initialBrief || !initialBrief.patch) return;
        setFormData((prev) => ({ ...prev, ...initialBrief.patch }));
        setBriefReading(initialBrief.read || []);
    }, [initialBrief]);

    const [status, setStatus] = useState(() => initialSession?.status || 'idle');
    const [planSvg, setPlanSvg] = useState(() => initialSession?.planSvg || null);
    const [locatedEstimate, setLocatedEstimate] = useState(null);
    const [planSpec, setPlanSpec] = useState(() => initialSession?.planSpec || null);
    const [generationSurvey, setGenerationSurvey] = useState(() => initialSession?.generationSurvey || null);
    const [refinementHistory, setRefinementHistory] = useState(() => initialSession?.refinementHistory || []);
    const [refinementsLeft, setRefinementsLeft] = useState(() => Number.isFinite(initialSession?.refinementsLeft) ? initialSession.refinementsLeft : 10);
    const [zoomImage, setZoomImage] = useState(null);
    // Index of the ranked option shown in the option dialog, or null.
    const [openOption, setOpenOption] = useState(null);
    useEffect(() => {
        if (openOption === null) return;
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpenOption(null); } };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [openOption]);
    const [galleryId, setGalleryId] = useState(() => initialSession?.galleryId || null);
    const [planScore, setPlanScore] = useState(() => initialSession?.planScore ?? null);
    const [footprintInfo, setFootprintInfo] = useState(() => initialSession?.footprintInfo ?? null);
    const [openingDiagnostics, setOpeningDiagnostics] = useState(() => initialSession?.openingDiagnostics ?? null);
    const [alternatives, setAlternatives] = useState(() => initialSession?.alternatives || []);
    const [optionSequence, setOptionSequence] = useState(() => initialSession?.optionSequence || []);
    const [currentOptionIndex, setCurrentOptionIndex] = useState(() => initialSession?.currentOptionIndex || 0);
    const [isExportingEstimateXlsx, setIsExportingEstimateXlsx] = useState(false);
    const [renderLaunchSignal, setRenderLaunchSignal] = useState(0);
    const [renderResetKey, setRenderResetKey] = useState(0);
    const [renderPanelStatus, setRenderPanelStatus] = useState(() => normalizeRenderState(initialSession?.renderState).status);
    const [renderState, setRenderState] = useState(() => normalizeRenderState(initialSession?.renderState));
    const [planView, setPlanView] = useState(() => initialSession?.planView || 'rendered');
    const [renderedPlan, setRenderedPlan] = useState(null);
    const [presentationStatus, setPresentationStatus] = useState('idle');
    const [presentationError, setPresentationError] = useState('');
    const [showRenderedLabels, setShowRenderedLabels] = useState(true);
    const [isExportingPng, setIsExportingPng] = useState(false);
    const presentationRequest = useRef(0);
    const presentationSource = useRef(planSpec);
    const renderedReady = renderedPlan?.source === planSvg && renderedPlan?.spec === planSpec && renderedPlan?.tier === acct.tier;
    const activeRenderedSvg = renderedReady ? renderedPlan.svg : null;
    const displayPlanSvg = planView === 'rendered' && activeRenderedSvg
        ? (showRenderedLabels ? activeRenderedSvg : activeRenderedSvg.replace('</style>', '.rendered-labels { display:none; }</style>'))
        : planSvg;
    const displayElevations = planView === 'rendered' && renderedReady ? renderedPlan.elevations : planSpec?.elevations;
    const presentationPending = planView === 'rendered' && !renderedReady && !!planSvg && presentationStatus !== 'error';
    const preparePresentation = async () => {
        const requestId = ++presentationRequest.current;
        setPresentationStatus('loading'); setPresentationError('');
        try {
            const response = await acct.authFetch('/api/plan/presentation', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ planSpec, surveyData: formData }),
            });
            const result = await response.json();
            if (!response.ok || !result.success || !result.svg || (!result.elevations && !result.elevationsLocked)) throw new Error(result.message || 'Unable to prepare rendered views.');
            if (requestId !== presentationRequest.current) return;
            setRenderedPlan({ source: planSvg, spec: planSpec, tier: acct.tier, svg: result.svg, elevations: result.elevations });
            setPresentationStatus('ready');
        } catch (error) {
            if (requestId !== presentationRequest.current) return;
            setPresentationError(`${error.message} Showing normal views. Select Rendered to retry.`);
            setPresentationStatus('error'); setPlanView('normal');
        }
    };
    useEffect(() => {
        // A hand edit keeps the studio in edit mode; the rendered presentation
        // is prepared again when the visitor goes back to it.
        const editing = planView === 'edit';
        if (presentationSource.current !== planSpec && !editing) setPlanView('rendered');
        presentationSource.current = planSpec;
        setRenderedPlan(null); setPresentationError('');
        if (planSvg && planSpec && !editing) preparePresentation();
        else setPresentationStatus('idle');
        return () => { presentationRequest.current += 1; };
    }, [planSvg, planSpec, acct.tier]);
    const selectPlanView = view => {
        setPlanView(view);
        if (view === 'rendered' && !renderedReady && presentationStatus !== 'loading') preparePresentation();
    };


    // An owner change remounts the studio; pending requests cannot carry this
    // owner's draft into another account. A requested project blocks autosave.
    const [openingProject, setOpeningProject] = useState(() => new URLSearchParams(window.location.search).get('project'));
    const [openError, setOpenError] = useState('');
    const [openAttempt, setOpenAttempt] = useState(0);
    const [draftError, setDraftError] = useState('');
    const [projectThumbnail, setProjectThumbnail] = useState(null);
    useEffect(() => {
        let alive = true;
        setProjectThumbnail(null);
        if (planSvg) svgToPngDataUrl(planSvg, { background: '#FFFFFF', longEdge: 520 })
            .then(image => { if (alive && image.length <= 290000) setProjectThumbnail(image); })
            .catch(() => {}); // a thumbnail failure must not prevent saving geometry
        return () => { alive = false; };
    }, [planSvg]);
    const persistence = useProjectSave({ acct,
        initialProjectId: initialSession?.projectId, initialRevision: initialSession?.projectRevision || 0,
        opening: Boolean(openingProject),
        enabled: acct.ready && acct.features.saveProjects && !!planSpec && !!planSvg && !['loading-plan', 'refining'].includes(status),
        payload: {
            // The persistence hook sends the generated name only on create.
            name: [String(formData.materials || '').split(' (')[0], formData.bedrooms].filter(Boolean).join(', ') || 'Untitled house',
            summary: [formData.stories, formData.bedrooms, formData.totalArea && `${Number(formData.totalArea).toLocaleString()} sq ft`].filter(Boolean).join(' · '), // was a corrupted '?'
            survey: formData, planSpec, svg: planSvg, thumbnail: projectThumbnail,
            studioState: { refinementHistory, refinementsLeft, renderSurveyData: renderState?.surveyData || null, currentOptionIndex,
                generationSurvey, optionSequence: optionSequence.slice(0, 3), planScore },
        },
    });
    const projectId = persistence.project.id;
    const projectRevision = persistence.project.revision;
    useEffect(() => {
        if (!openingProject || !acct.ready || !acct.features.saveProjects) return;
        const abort = new AbortController();
        setOpenError('');
        acct.authFetch(`/api/projects/${encodeURIComponent(openingProject)}`, { signal: abort.signal }).then(async response => {
            const data = await response.json();
            if (!response.ok || !data.project) throw new Error(data.message || 'This house could not be opened.');
            if (abort.signal.aborted) return;
            const pj = data.project;
            setFormData({ ...DEFAULT_FORM_DATA, ...(pj.survey || {}) });
            setPlanSpec(pj.planSpec || null); setPlanSvg(pj.svg || null);
            setGenerationSurvey(pj.studioState?.generationSurvey || null);
            setRefinementHistory(pj.studioState?.refinementHistory || []);
            setRefinementsLeft(pj.studioState?.refinementsLeft ?? 10);
            setRenderState({ ...createEmptyRenderState(), surveyData: pj.studioState?.renderSurveyData || null });
            const options = pj.studioState?.optionSequence || [];
            setAlternatives(options.slice(1)); setOptionSequence(options); setPlanScore(pj.studioState?.planScore ?? null);
            setCurrentOptionIndex(pj.studioState?.currentOptionIndex || 0);
            const l0 = pj.planSpec?.levels?.[0];
            setFootprintInfo(l0 ? { widthFt: l0.width, heightFt: l0.height } : null);
            persistence.opened(pj);
            setStatus(pj.svg ? 'plan-ready' : 'idle');
            setOpeningProject(null);
            const url = new URL(window.location.href); url.searchParams.delete('project'); window.history.replaceState({}, '', url);
        }).catch(error => { if (!abort.signal.aborted) setOpenError(error.message || 'This house could not be opened.'); });
        return () => abort.abort();
    }, [openingProject, openAttempt, acct.ready, acct.features.saveProjects, acct.authFetch]);

    useEffect(() => {
        const snapshot = {
            version: 2, ownerUid, projectRevision, planView,
            savedAt: new Date().toISOString(),
            formData,
            status: status === 'loading-plan' || status === 'refining'
                ? (planSvg ? 'plan-ready' : 'idle')
                : status,
            planSvg,
            planSpec,
            generationSurvey,
            refinementHistory,
            refinementsLeft,
            galleryId,
            projectId,
            planScore,
            footprintInfo,
            openingDiagnostics,
            alternatives: Array.isArray(alternatives) ? alternatives.slice(0, 6) : [],
            optionSequence: Array.isArray(optionSequence) ? optionSequence.slice(0, 6) : [],
            currentOptionIndex,
            renderState: renderState?.image
                ? {
                    ...renderState,
                    image: null,
                    imageClean: null,
                    status: 'ready',
                    errorMsg: '',
                  }
                : {
                    ...createEmptyRenderState(),
                    surveyData: renderState?.surveyData || null,
                  },
        };
        try {
            localStorage.setItem(studioSessionKey(ownerUid), JSON.stringify(snapshot));
            setDraftError('');
        } catch { setDraftError('This browser could not keep a local draft. Keep this tab open until the house is saved to your account.'); }
    }, [formData, status, planSvg, planSpec, generationSurvey, refinementHistory, refinementsLeft, galleryId, projectId, projectRevision, planView, ownerUid, planScore, footprintInfo, openingDiagnostics, alternatives, optionSequence, currentOptionIndex, renderState]);

    // A locked action opens "create a free account" or "upgrade to Pro",
    // whichever this visitor needs next.
    const FEATURE_OF = { refinements: 'refine', 'CAD export (DXF)': 'downloads', 'Exterior Render': 'render', 'Cost Estimate XLSX': 'estimate', 'Cost Estimate': 'estimate', 'the photoreal 3D model': 'photoreal' };
    const requireAdvancedAccess = (label) => {
        const feature = FEATURE_OF[label] || label;
        const need = gateFor(acct.features, acct.tier, feature);
        if (!need) return true;
        if (acct.localStudio) {
            notify('error', 'Local feature unavailable',
                feature === 'photoreal' || feature === 'render'
                    ? 'Photoreal rendering needs a local Blender setup; the quick 3D model is available now.'
                    : 'This tool is not available in the local copy yet.');
            return false;
        }
        if (need === 'signin') site.openAccount('signup', feature);
        else site.openUpgrade(feature);
        return false;
    };
    const promptUnlock = requireAdvancedAccess;
    const guard = (feature, fn) => () => { if (requireAdvancedAccess(feature)) fn(); };

    // A new plan takes focus and comes into view. Without this, focus fell to the
    // page when the brief's Generate button re-rendered, and on a tablet the plan
    // and its Download/Render actions were far above where the user tapped (C7).
    const resultRef = useRef(null);
    const [resultArrived, setResultArrived] = useState(0);
    // Generate disables itself while the plan loads, so the browser forgets the user
    // was on the keyboard; remember it to show the panel's focus ring (and not after a click).
    const lastInputKeyboard = useRef(false);
    useEffect(() => {
        const onKey = () => { lastInputKeyboard.current = true; };
        const onPointer = () => { lastInputKeyboard.current = false; };
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', onPointer, true);
        return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onPointer, true); };
    }, []);
    useEffect(() => {
        if (!resultArrived) return undefined;
        const id = requestAnimationFrame(() => {
            const panel = resultRef.current;
            if (!panel) return;
            panel.classList.toggle('is-keyboard-focus', lastInputKeyboard.current);
            panel.addEventListener('blur', () => panel.classList.remove('is-keyboard-focus'), { once: true });
            panel.focus({ preventScroll: true });
            const actions = document.querySelector('.studio-actions') || panel;
            const top = actions.getBoundingClientRect().top;
            if (top < 0 || top > window.innerHeight * 0.6) {
                const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                actions.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
            }
        });
        return () => cancelAnimationFrame(id);
    }, [resultArrived]);

    const handleGeneratePlan = async () => {
        const generationSurvey = surveyWithBedroomConfigurations(formData);
        setLayoutFailure(null);
        setStatus('loading-plan');
        // A plan normally takes seconds. Without a deadline a stalled request left
        // the spinner running forever (C7); generating is free, so giving up is safe.
        const deadline = new AbortController();
        const deadlineTimer = setTimeout(() => deadline.abort(), PLAN_DEADLINE_MS);
        try {
            let res;
            try {
                res = await acct.authFetch('/api/plan', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ surveyData:generationSurvey, chatHistory:[] }), signal: deadline.signal });
            } catch (networkError) {
                throw Object.assign(new Error(deadline.signal.aborted ? PLAN_SLOW : PLAN_OFFLINE), { code: 'PLAN_UNREACHED' });
            }
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                // res.ok was never checked, so a 422 NO_VALID_LAYOUT arrived
                // with a full diagnostics object and was reduced to
                // alert('Error: ' + message) with the detail thrown away.
                const err = new Error(data.message || planFailureMessage(res.status));
                err.code = data.code;
                err.diagnostics = data.diagnostics;
                throw err;
            }
            setLayoutFailure(null);
            setFormData(generationSurvey);
            setGenerationSurvey(generationSurvey);
            setPlanSvg(data.svg);
            setPlanSpec(data.planSpec ? { ...data.planSpec, estimate: data.estimate || data.planSpec?.estimate || null } : null);
            setRefinementHistory([]);
            setRefinementsLeft(10);
            setGalleryId(data.galleryId || null);
            setPlanScore(data.score ?? null);
            setFootprintInfo(data.footprintInfo ?? null);
            setOpeningDiagnostics(data.openingDiagnostics || data.planSpec?.openingDiagnostics || null);
            setAlternatives(data.alternatives || []);
            // Build immutable option sequence: best plan as option 0, then alternatives
            const bestOption = {
                svg: data.svg,
                planSpec: data.planSpec ? { ...data.planSpec, estimate: data.estimate || data.planSpec?.estimate || null } : null,
                score: data.score,
                footprintInfo: data.footprintInfo,
                openingDiagnostics: data.openingDiagnostics || data.planSpec?.openingDiagnostics || null,
                functionalId: data.footprintInfo?.functionalId || data.planSpec?.functionalId || 'front_core_compact',
                functionalLabel: data.footprintInfo?.functionalLabel || data.planSpec?.functionalLabel || 'Option 1',
            };
            const altOptions = (data.alternatives || []).map((alt, i) => ({
                svg: alt.svg,
                planSpec: alt.planSpec,
                score: alt.score,
                footprintInfo: alt.footprintInfo,
                openingDiagnostics: alt.openingDiagnostics || alt.planSpec?.openingDiagnostics || null,
                functionalId: alt.footprintInfo?.functionalId || alt.planSpec?.functionalId || `option_${i + 2}`,
                functionalLabel: alt.footprintInfo?.functionalLabel || alt.planSpec?.functionalLabel || `Option ${i + 2}`,
            }));
            setOptionSequence([bestOption, ...altOptions].slice(0, 3));
            setCurrentOptionIndex(0);
            setRenderState(createEmptyRenderState());
            setRenderResetKey(k => k + 1);
            setRenderPanelStatus('idle');
            setStatus('plan-ready');
            setResultArrived(n => n + 1);
        } catch (err) {
            if (err.code === 'NO_VALID_LAYOUT' || err.code === 'V2_FALLBACK_DISABLED') {
                const rejected = err.diagnostics?.rejectedCandidates || [];
                const reasons = [...new Set([
                    ...(err.diagnostics?.blockers || []).map(item => item.message),
                    ...rejected.map((r) => r.reason).filter(Boolean),
                ])].slice(0, 4);
                setLayoutFailure({
                    message: err.message,
                    tried: err.diagnostics?.triedCandidateCount ?? rejected.length,
                    reasons,
                });
            } else {
                notify('error', 'The plan was not generated.', err.message);
            }
            // The brief stays exactly as the user left it, and any plan they
            // already had is untouched.
            setStatus(planSvg ? 'plan-ready' : 'idle');
        } finally {
            clearTimeout(deadlineTimer);
        }
    };

    // A hand edit from edit mode (PlanEditor): the edited plan replaces the
    // current option, as a refinement does, and the exterior render starts over.
    const handlePlanEdited = React.useCallback((nextSpec, nextSvg) => {
        setPlanSpec(nextSpec);
        setPlanSvg(nextSvg);
        setRenderState(createEmptyRenderState());
        setRenderResetKey(k => k + 1);
        setRenderPanelStatus('idle');
        setOptionSequence(prev => prev.map((opt, i) => i === currentOptionIndex ? { ...opt, svg: nextSvg, planSpec: nextSpec } : opt));
    }, [currentOptionIndex]);

    const handleRefine = async (instruction) => {
        if (!requireAdvancedAccess('refinements')) return;
        if (refinementsLeft <= 0) return;
        setStatus('refining');
        // Optimistically add user message to history
        setRefinementHistory(prev => [...prev, { role:'user', content: instruction }]);
        try {
            const res = await acct.authFetch('/api/plan/refine', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(await authHeader()),
                },
                body: JSON.stringify({
                    surveyData: formData,
                    currentPlanSpec: planSpec,
                    refinementInstruction: instruction,
                }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);

            // Build a human-readable summary of what changed
            const changes = data.appliedChanges || [];
            const summary = changes.length > 0
                ? changes.map(c => {
                    const room = planSpec.levels?.flatMap(l => l.rooms || []).find(r => r.id === c.id);
                    const name = room?.label || c.id;
                    if (c.action === 'resize') return `Resized ${name} to ${c.w} x ${c.h} ft`;
                    if (c.action === 'move') return `Moved ${name} to (${c.x}, ${c.y})`;
                    if (c.action === 'resize_and_move') return `Resized & moved ${name} to ${c.w} x ${c.h} ft`;
                    return `Updated ${name}`;
                }).join(', ')
                : `Applied: ${instruction}`;

            const updatedSpec = data.planSpec ? { ...data.planSpec, estimate: data.estimate || data.planSpec?.estimate || null } : null;
            setPlanSvg(data.svg);
            setPlanSpec(updatedSpec);
            setOpeningDiagnostics(data.openingDiagnostics || data.planSpec?.openingDiagnostics || null);
            if (data.galleryId) setGalleryId(data.galleryId);
            setRenderState(createEmptyRenderState());
            setRenderResetKey(k => k + 1);
            setRenderPanelStatus('idle');
            setRefinementHistory(prev => [...prev, { role:'assistant', content: summary }]);
            setRefinementsLeft(prev => prev - 1);
            // Update the current option in optionSequence so alternatives stay in sync
            setOptionSequence(prev => prev.map((opt, i) =>
                i === currentOptionIndex
                    ? { ...opt, svg: data.svg, planSpec: updatedSpec, score: data.diagnostics?.refined?.score ?? opt.score, openingDiagnostics: data.openingDiagnostics || null }
                    : opt
            ));
            setStatus('plan-ready');
        } catch(err) {
            console.error('[refine]', err);
            setRefinementHistory(prev => [...prev, { role:'error', content: err.message }]);
            setStatus('plan-ready');
        }
    };

    const applyOptionChoice = React.useCallback((opt, index = 0) => {
        if (!opt?.svg || !opt?.planSpec) return;
        setPlanSvg(opt.svg);
        setPlanSpec(opt.planSpec);
        setPlanScore(opt.score);
        setFootprintInfo(opt.footprintInfo);
        setOpeningDiagnostics(opt.openingDiagnostics || opt.planSpec?.openingDiagnostics || null);
        setCurrentOptionIndex(index);
        setRenderState(createEmptyRenderState());
        setRenderResetKey(k => k + 1);
        setRenderPanelStatus('idle');
    }, []);

    const downloadBlueprint = async () => {
    if (presentationPending) return;
    try {
        setIsExportingPng(true);
        // A dedicated full-resolution plan keeps every floor and room readable.
        const pngUrl = await svgToPngDataUrl(displayPlanSvg, {
            background: planView === 'rendered' ? '#535f64' : '#F9F8F4',
            longEdge: 6000,
        });

        const l = document.createElement('a');
        l.href = pngUrl;
        l.download = buildPlanExportFilename(formData, planView === 'rendered' ? 'rendered floor plan 6k' : 'floor plan 6k', 'png');
        document.body.appendChild(l);
        l.click();
        l.remove();
    } catch (err) {
        console.error('[downloadBlueprint]', err);
        notify('error', 'The plan image was not created.', 'It is 6,000 pixels wide, which some phones cannot draw. Try again, or download it on a computer.');
        } finally { setIsExportingPng(false); }
    };

    const downloadElevations = async () => {
        if (presentationPending) return;
        if (!planSpec?.elevations) { notify('info', 'No elevations to export yet.'); return; }
        try {
            const pngUrl = await composeElevationReferenceSheet(displayElevations, { exportQuality: true });
            if (!pngUrl) throw new Error('Unable to build elevation sheet');
            const link = document.createElement('a');
            link.href = pngUrl;
            link.download = buildPlanExportFilename(formData, planView === 'rendered' ? 'rendered elevation set' : 'elevation set', 'png');
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            console.error('[downloadElevations]', err);
            notify('error', 'The elevation sheet was not created.', 'Try again. If it fails again, download it on a computer.');
        }
    };

    const downloadDxf = async () => {
        if (!planSpec || !planSpec.levels) { notify('info', 'Generate a plan before exporting.'); return; }
        if (!requireAdvancedAccess('CAD export (DXF)')) return;
        try {
            const response = await fetch('/api/plan/dxf', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) }, body: JSON.stringify({ planSpec }) });
            if (!response.ok) throw new Error('CAD export failed');
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = buildPlanExportFilename(formData, 'floor plan cad', 'dxf');
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('[downloadDxf]', err);
            notify('error', 'The CAD file (DXF) was not created.', 'Your plan is unchanged. Try again.');
        }
    };

    const downloadRenderImage = () => {
        if (!requireAdvancedAccess('Exterior Render')) return;
        if (!renderState?.image) { notify('info', 'Generate an exterior render first.'); return; }
        const link = document.createElement('a');
        link.href = renderState.image;
        link.download = buildPlanExportFilename(formData, 'exterior render', 'png');
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const estimateInputKey = JSON.stringify(formData);
    const currentEstimate = locatedEstimate?.plan === planSpec && locatedEstimate?.estimateInputKey === estimateInputKey ? locatedEstimate.estimate : null;
    const calculateLocatedEstimate = async () => {
        if (!requireAdvancedAccess('Cost Estimate')) return;
        const response = await fetch('/api/estimate', {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
            body: JSON.stringify({ planSpec, surveyData: formData }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.estimate) throw new Error(result?.message || 'Could not calculate the estimate.');
        setLocatedEstimate({ plan: planSpec, estimateInputKey, estimate: result.estimate });
    };

    const downloadEstimateXlsx = async () => {
        const estimate = currentEstimate;
        if (!planSpec) return;
        if (!estimate) {
            const section = document.getElementById('estimate-location');
            section?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            section?.focus();
            notify('info', 'Enter your project location and calculate an estimate first.');
            return;
        }
        if (!requireAdvancedAccess('Cost Estimate XLSX')) return;
        setIsExportingEstimateXlsx(true);
        try {
            const res = await fetch('/api/estimate/xlsx', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(await authHeader()),
                },
                body: JSON.stringify({
                    surveyData: formData,
                    planSpec,
                    estimate,
                    exportMeta: {
                        projectName: 'Keystone AI Cost Estimate',
                        generatedAt: new Date().toISOString(),
                    },
                }),
            });

            if (!res.ok) {
                // Only the server's own sentence is shown; a raw body (an HTML error
                // page, a stack) was previously put in front of the user verbatim.
                let message = 'Try again in a moment.';
                const data = await res.json().catch(() => null);
                if (typeof data?.message === 'string' && data.message.length < 300) message = data.message;
                throw new Error(message);
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = buildPlanExportFilename(formData, 'cost estimate', 'xlsx');
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('[downloadEstimateXlsx]', err);
            notify('error', 'The cost estimate spreadsheet was not created.', err instanceof TypeError ? 'Could not reach Keystone AI. Check your connection, then try again.' : err.message);
        } finally {
            setIsExportingEstimateXlsx(false);
        }
    };

    const launchRenderSurvey = () => {
        if (!planSpec || !planSvg) {
            notify('info', 'Generate a plan first.');
            return;
        }
        if (!requireAdvancedAccess('Exterior Render')) return;
        if (renderPanelStatus === 'loading') return;
        setRenderLaunchSignal((value) => value + 1);
    };

    const renderActionLabel =
        renderPanelStatus === 'loading'
            ? 'Rendering 3D...'
            : renderPanelStatus === 'ready'
                ? 'Exterior Render Options'
                : 'Generate Exterior Render';

    const isLoading = status === 'loading-plan' || status === 'refining';
    const resetSampleBrief = () => {
        persistence.copy();
        setFormData({ ...DEFAULT_FORM_DATA });
        setStatus('idle');
        setPlanSvg(null);
        setPlanSpec(null);
        setGenerationSurvey(null);
        setRefinementHistory([]);
        setRefinementsLeft(10);
        setGalleryId(null);
        setPlanScore(null);
        setFootprintInfo(null);
        setAlternatives([]);
        setRenderState(createEmptyRenderState());
        setRenderResetKey(k => k + 1);
        setRenderPanelStatus('idle');
        try { localStorage.removeItem(studioSessionKey(ownerUid)); } catch {}
    };

    return (
        <section id="generator" className="studio-section px-4 md:px-6 py-5">
            <div className="site-shell">
                {draftError && <p className="studio-save-status" role="alert">{draftError}</p>}
                {openingProject && <div className="studio-save-status" role={openError ? 'alert' : 'status'}>
                    <p>{openError || (acct.signedIn ? 'Opening saved house...' : 'Sign in to open this saved house.')}</p>
                    {openError && <button type="button" className="studio-btn" onClick={() => setOpenAttempt(n => n + 1)}>Retry opening house</button>}
                </div>}
                {acct.features.saveProjects && persistence.state.status !== 'idle' && <div className="studio-save-status" role={['error', 'conflict'].includes(persistence.state.status) ? 'alert' : 'status'}>
                    <p>{persistence.state.message}</p>
                    {persistence.state.status === 'error' && <button type="button" className="studio-btn" onClick={persistence.retry}>Retry saving</button>}
                    {persistence.state.status === 'conflict' && <>
                        <button type="button" className="studio-btn" onClick={persistence.copy}>Save as a new house</button>
                        <button type="button" className="studio-btn" onClick={() => { if (window.confirm('Replace this local draft with the saved house?')) setOpeningProject(projectId); }}>Reopen saved house</button>
                    </>}
                </div>}
                {/* Lightbox */}
                {/* Option preview. Escape and the close button both return
                    you to the studio with nothing changed; keeping an option
                    is a separate, explicit action. */}
                <AnimatePresence>
                    {openOption !== null && optionSequence[openOption] && (
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.16 }}
                            className="option-dialog-backdrop"
                            onClick={() => setOpenOption(null)}
                        >
                            <motion.div
                                initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 18 }}
                                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                                className="option-dialog"
                                role="dialog"
                                aria-modal="true"
                                aria-label={`Option ${openOption + 1}`}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="option-dialog-bar">
                                    <div>
                                        <h3>Option {openOption + 1}</h3>
                                        <p>{optionSequence[openOption]?.functionalLabel || 'Ranked layout'}</p>
                                    </div>
                                    <div className="option-dialog-actions">
                                        {planSvg === optionSequence[openOption]?.svg ? (
                                            <span className="option-chip-current">In the studio now</span>
                                        ) : (
                                            <button
                                                type="button"
                                                className="studio-btn studio-btn-primary"
                                                onClick={() => {
                                                    applyOptionChoice(optionSequence[openOption], openOption);
                                                    setOpenOption(null);
                                                }}
                                            >Use this option</button>
                                        )}
                                        <button
                                            type="button"
                                            className="studio-btn studio-btn-quiet"
                                            onClick={() => setOpenOption(null)}
                                        >Close</button>
                                    </div>
                                </div>
                                <div
                                    className="option-dialog-sheet"
                                    dangerouslySetInnerHTML={{ __html: safeSvg(optionSequence[openOption]?.svg, `option-${openOption}`) }}
                                />
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence>
                    {zoomImage && (
                        <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setZoomImage(null)}
                            className="fixed inset-0 z-200 bg-ink/93 backdrop-blur-lg flex items-center justify-center p-4 cursor-zoom-out">
                            {typeof zoomImage === 'string' && zoomImage.startsWith('<svg')
                                ? <div className="bg-white p-4 md:p-8 max-w-5xl w-full max-h-[90vh] overflow-auto shadow-2xl rounded-xs" dangerouslySetInnerHTML={{__html: safeSvg(zoomImage, 'studio-zoom')}}/>
                                : <img src={zoomImage} className="max-h-[90vh] max-w-full object-contain rounded-xs" alt="Zoom"/>}
                            <button type="button" onClick={() => setZoomImage(null)} aria-label="Close zoomed plan" className="absolute top-4 right-4 text-white/40 hover:text-white">
                                <CloseIcon className="w-6 h-6"/>
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>


                <div className="transition-opacity">
                    {/* Only rendered once there is something to act on. The
                        access rules that used to be explained in a paragraph
                        here are now shown inline at each gated control. */}
                    {planSvg && (
                        <div className="studio-actions">
                            <button
                                type="button"
                                className="studio-btn studio-btn-primary"
                                onClick={launchRenderSurvey}
                                disabled={!planSpec || !planSvg || isLoading || renderPanelStatus === 'loading'}
                            >
                                {renderActionLabel}
                            </button>
                            <DownloadMenu
                                disabled={isLoading}
                                items={[
                                    { label: isExportingPng ? 'Preparing PNG...' : 'Floor plan',
                                      aria: 'Download floor plan PNG',
                                      note: 'PNG, 6000px long edge',
                                      disabled: !planSvg || isLoading || isExportingPng || presentationPending,
                                      onClick: guard('downloads', downloadBlueprint) },
                                    { label: 'Elevations',
                                      aria: 'Download elevations PNG',
                                      note: 'PNG, all four sides',
                                      disabled: !displayElevations || isLoading || presentationPending,
                                      onClick: guard('downloads', downloadElevations) },
                                    { label: 'Exterior render',
                                      aria: 'Download exterior render PNG',
                                      note: renderState?.image ? 'PNG' : 'Generate a render first',
                                      disabled: !renderState?.image || isLoading,
                                      onClick: guard('downloads', downloadRenderImage) },
                                    { label: 'CAD export',
                                      aria: 'Download CAD export DXF',
                                      note: 'DXF, opens in any CAD tool',
                                      disabled: !planSpec || isLoading,
                                      onClick: guard('downloads', downloadDxf) },
                                    { label: isExportingEstimateXlsx ? 'Building XLSX...' : 'Cost estimate',
                                      aria: 'Download cost estimate XLSX',
                                      note: planSpec?.estimate ? 'XLSX workbook' : 'Not available for this plan',
                                      disabled: !planSpec?.estimate || isLoading || isExportingEstimateXlsx,
                                      onClick: downloadEstimateXlsx },
                                ]}
                            />
                        </div>
                    )}

                {/* Two columns, not three. The tools rail used to hold a fixed
                    300px beside the drawing at every width, leaving the drawing
                    about 54% of the workspace; it now sits below, full width. */}
                <div className="studio-grid">
                    {/* LEFT — The Brief */}
                    <div className="cad-panel-brief">
                        <div className="cad-panel-brief-header">
                            <div>
                                <div className="studio-item-title">What you're building</div>
                            </div>
                            {isLoading
                                ? <div className="w-3 h-3 border-2 border-blue border-t-transparent rounded-full animate-spin"/>
                                : planSvg
                                    ? <span style={{display:'inline-flex',alignItems:'center',gap:4,background:'var(--accent)',color:'var(--d-on-fill)',padding:'3px 8px',borderRadius:99,fontSize:8,fontFamily:'IBM Plex Mono,monospace',letterSpacing:'0.14em',textTransform:'uppercase'}}>
                                        <span style={{width:5,height:5,borderRadius:'50%',background:'var(--d-on-fill)',display:'inline-block'}}/>Ready
                                      </span>
                                    : null}
                        </div>
                        <div className="cad-panel-brief-body">
                            {briefReading && briefReading.length > 0 && (
                                <div className="brief-reading" role="status">
                                    <p>From your sentence, Keystone AI read:</p>
                                    <ul>{briefReading.map((r) => <li key={r}>{r}</li>)}</ul>
                                    <p className="brief-reading-note">Change anything below before generating.</p>
                                </div>
                            )}
                            <div style={{padding:'8px 12px 12px'}}>
                                {LOCAL_STUDIO && <div role="group" aria-label="Design mode" className="studio-seg" style={{ margin: '10px 14px' }}>
                                    <button type="button" aria-pressed={surveyMode === 'nepal'} onClick={() => { setSurveyMode('nepal'); setPlanSvg(null); setPlanSpec(null); setStatus('idle'); }}>Nepal brief</button>
                                    <button type="button" aria-pressed={surveyMode === 'baseline'} onClick={() => { setSurveyMode('baseline'); setPlanSvg(null); setPlanSpec(null); setStatus('idle'); }}>Existing engine</button>
                                </div>}
                                {LOCAL_STUDIO && surveyMode === 'nepal'
                                    ? <NepalBrief/>
                                    : <SurveyForm formData={formData} setFormData={setFormData} onSubmit={handleGeneratePlan} isLoading={isLoading} onReset={resetSampleBrief}/>}
                            </div>
                        </div>
                    </div>

                    {/* CENTER — Blueprint Canvas */}
                    <div className="cad-canvas-panel" ref={resultRef} tabIndex={-1} role="region" aria-label="Plan">
                        {/* Title block */}
                        <div className="cad-canvas-titleblock">
                            {/* This strip was the last place a colour from the
                                old identity survived: a terminal green on
                                three labels at 7 and 8px, the only hue in the
                                studio outside the ember. It reads on the
                                studio's own muted token now, at a size the
                                title block of a drawing is meant to be read
                                at. The score keeps its traffic light - the
                                number carries the same information, so the
                                colour is reinforcement rather than the only
                                signal. */}
                            <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
                                <svg width="13" height="13" fill="none" stroke="var(--d-muted)" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
                                <span className="studio-meta" style={{fontSize:11,color:'var(--d-muted)',letterSpacing:'0.12em',textTransform:'uppercase',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                                    {planSvg && footprintInfo
                                        ? `${footprintInfo.widthFt}' x ${footprintInfo.heightFt}' | ${formData.stories || ''} | ${formData.bedrooms || ''}${planSpec?.elevations ? ' | elevation set' : ''}`
                                        : 'Blueprint viewport'}
                                </span>
                            </div>
                            {planSvg && planScore != null
                                ? <div style={{display:'flex',alignItems:'center',gap:6}}>
                                    <span className="studio-meta" style={{fontSize:11,color:'var(--d-muted)',letterSpacing:'0.1em',textTransform:'uppercase'}}>Score</span>
                                    <span className="mono" style={{fontSize:12,fontWeight:700,color:planScore>=70?'#1F7A4C':planScore>=40?'#8A5A00':'#B42318'}}>{planScore}/100</span>
                                  </div>
                                : <span className="studio-meta" style={{fontSize:11,color:'var(--d-muted)',letterSpacing:'0.1em',textTransform:'uppercase',whiteSpace:'nowrap'}}>Keystone AI</span>}
                        </div>
                        {planSvg && planSpec?.generatorId === 'architect_v2' && optionSequence.length > 0 && optionSequence.length < 3 && (
                            <p role="status" className="p-3 text-[13px]" style={{color:'var(--ink-soft)'}}>
                                {optionSequence.length} distinct {optionSequence.length === 1 ? 'layout passes' : 'layouts pass'} the current checks for this brief. The generator could not yet produce three distinct options.
                            </p>
                        )}
                        {planSvg && planSpec?.surveyFulfillment?.freeformWishes?.status === 'not_applied' && (
                            <p role="status" className="p-3 text-[13px]" style={{color:'var(--ink-soft)'}}>
                                Your additional written request was not applied. {planSpec.surveyFulfillment.freeformWishes.reason || 'It did not pass the layout checks.'}
                            </p>
                        )}
                        {planSvg && <div className="studio-viewbar">
                            <div role="group" aria-label="Plan view" className="studio-seg">
                                {[['rendered', 'Rendered'], ['normal', 'Normal'], ['3d', '3D'], ['edit', 'Edit']].map(([view, label]) => <button key={view} type="button"
                                    aria-pressed={planView === view} disabled={view === 'rendered' && (isLoading || presentationStatus === 'loading')}
                                    onClick={() => selectPlanView(view)}>
                                    {label}
                                </button>)}
                            </div>
                            {planView === 'rendered' && renderedReady && <label className="studio-toggle flex items-center gap-2 text-[13px]"><input type="checkbox" checked={showRenderedLabels} onChange={e => setShowRenderedLabels(e.target.checked)} style={{width:'auto'}}/>Room details</label>}
                            {presentationPending && <span role="status" className="text-[13px]">Preparing rendered plan and elevations...</span>}
                            {presentationError && <p role="alert" className="text-[13px] text-red">{presentationError}</p>}
                        </div>}
                        {/* Canvas body */}
                        <div className="cad-canvas-body">
                            {layoutFailure && (
                                <div className="flex-1 flex items-center justify-center">
                                    <div className="layout-failure" role="alert">
                                        <h4>No layout met the checks</h4>
                                        <p>{layoutFailure.message}</p>
                                        {layoutFailure.tried > 0 && (
                                            <p style={{marginTop:'0.5rem'}}>
                                                Keystone AI tried {layoutFailure.tried} {layoutFailure.tried === 1 ? 'layout' : 'layouts'}.
                                            </p>
                                        )}
                                        {layoutFailure.reasons.length > 0 && (
                                            <ul>
                                                {layoutFailure.reasons.map((r) => (
                                                    <li key={r}>{String(r).replace(/_/g, ' ')}</li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            )}
                            {status === 'idle' && !layoutFailure && (
                                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center" style={{color:'var(--ink-soft)'}} role="status" aria-live="polite">
                                    <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
                                    {/* An empty state is an invitation, not a status
                                        light. This one used to shout AWAITING YOUR
                                        BRIEF in uppercase display type and then
                                        restate it in uppercase mono, without saying
                                        what to press. */}
                                    <p className="studio-empty-title">Your plan will appear here.</p>
                                    <p className="studio-empty-note">
                                        Answer the five short steps in the brief, then press
                                        Generate floor plan. The sample brief is already filled in,
                                        so you can go straight there.
                                    </p>
                                </div>
                            )}
                            {isLoading && (
                                <div className="flex-1 flex flex-col items-center justify-center p-12" role="status" aria-live="polite">
                                    {/* The keystone mark's working loop: the arch is set, locked, set again. */}
                                    <span className="mb-5" style={{color:'var(--d-text)'}}><Mark size={64} motion="loop"/></span>
                                    <p className="text-[14px] font-semibold" style={{color:'var(--d-text)'}}>{status==='refining' ? 'Applying your change…' : 'Generating the floor plan…'}</p>
                                    <p className="text-[12px] mt-2" style={{color:'var(--ink-soft)'}}>Usually under 5 seconds</p>
                                </div>
                            )}
                            {(status === 'plan-ready' || status === 'refining') && planSvg && planView === '3d' && (acct.features.quick3d ? (
                                <Suspense fallback={<p className="studio-empty-note" style={{padding:24}}>Loading the 3D view…</p>}>
                                    <Model3D planSpec={planSpec} project={projectId ? { id: projectId, revision: projectRevision, saved: persistence.state.status === 'saved' } : null} requireAccess={requireAdvancedAccess} watermark={!isUnlocked}/>
                                </Suspense>
                            ) : (
                                <div className="studio-locked">
                                    <h3>Walk through this house in 3D</h3>
                                    <p>Create a free account to see every room in 3D, and to keep this house so you can come back to it.</p>
                                    <button type="button" className="studio-btn studio-btn-primary" onClick={() => site.openAccount('signup', 'quick3d')}>Create a free account</button>
                                </div>
                            ))}
                            {(status === 'plan-ready' || status === 'refining') && planSvg && planView === 'edit' && (acct.features.edit ? (
                                <Suspense fallback={<p className="studio-empty-note" style={{padding:24}}>Loading edit mode…</p>}>
                                    <PlanEditor planSpec={planSpec} authFetch={acct.authFetch} onPlanChange={handlePlanEdited}/>
                                </Suspense>
                            ) : (
                                <div className="studio-locked">
                                    <h3>Edit this plan by hand</h3>
                                    <p>Create a free account to drag walls, resize and swap rooms, and keep your changes with the house.</p>
                                    <button type="button" className="studio-btn studio-btn-primary" onClick={() => site.openAccount('signup', 'edit')}>Create a free account</button>
                                </div>
                            ))}
                            {(status === 'plan-ready' || status === 'refining') && planSvg && planView !== '3d' && planView !== 'edit' && (
                                <InteractiveCanvas viewKey={[galleryId, currentOptionIndex, planView, renderedReady].join('|')}>
                                    <BlueprintPresentationSheet
                                        planSvg={displayPlanSvg}
                                        elevations={displayElevations}
                                        formData={formData}
                                        footprintInfo={footprintInfo}
                                        renderImage={renderState?.image || null}
                                        planSpec={planSpec}
                                    />
                                </InteractiveCanvas>
                            )}
                        </div>

                        {notices.length > 0 && (
                            <div className="studio-notices" role="status" aria-live="polite">
                                {notices.map((n) => (
                                    <div key={n.id} className={'studio-notice is-' + n.kind}>
                                        <div>
                                            <p>{n.message}</p>
                                            {n.detail && <p className="studio-notice-detail">{n.detail}</p>}
                                        </div>
                                        <button type="button" onClick={() => dismissNotice(n.id)} aria-label="Dismiss">
                                            <XIcon size={16} weight="bold" aria-hidden="true"/>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* RIGHT — Actions & Tools */}
                    <div className="cad-panel-actions" hidden={!((status === 'plan-ready' || status === 'refining') && planSvg)}>
                        {(status === 'plan-ready' || status === 'refining') && planSvg ? (
                            <>
                                <div className="paper-panel p-5">
                                    <div className="flex flex-col gap-3">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="badge" style={{background: status === 'refining' ? '#fff6ed' : 'var(--paper)', borderColor: status === 'refining' ? 'var(--accent)' : 'var(--blue)'}}>{status === 'refining' ? 'Refining...' : 'Plan ready'}</span>
                                            <span className="mono text-[11px] uppercase tracking-[0.22em] text-mid font-bold">{refinementsLeft} refinements left</span>
                                        </div>
                                        {footprintInfo && (
                                            <div style={{display:'flex',flexDirection:'column',gap:6}}>
                                                <div className="cad-metric-chip">
                                                    <span className="label">Footprint</span>
                                                    <span className="value">{footprintInfo.widthFt}' x {footprintInfo.heightFt}'</span>
                                                </div>
                                                {planScore != null && (
                                                    <div className="cad-metric-chip" style={{flexDirection:'column',alignItems:'flex-start',gap:4}}>
                                                        <div style={{display:'flex',justifyContent:'space-between',width:'100%'}}>
                                                            <span className="label">Layout score</span>
                                                            <span className="value">{planScore} / 100</span>
                                                        </div>
                                                        <div className="cad-score-bar" style={{width:'100%'}}>
                                                            <div className="cad-score-fill" style={{transform:`scaleX(${Math.min(100,planScore)/100})`}}/>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {/* This panel used to carry a release note -
                                            "main exports and the 3D render action now
                                            live in the orange command bar above the
                                            studio columns" - which describes a change
                                            to somebody who saw the previous version.
                                            Nobody arriving today knows where things
                                            used to be, so it said nothing. */}
                                        {optionSequence.length > 1 && (
                                            <button
                                                onClick={() => document.getElementById('keystone-option-stack')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                                                className="w-full cta-secondary py-3 text-[12px]"
                                            >
                                                See the other {Math.min(3, optionSequence.length)} layouts
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {isUnlocked ? (
                                    <div className="paper-panel">
                                        <RefinementPanel planSpec={planSpec} formData={formData} refinementsLeft={refinementsLeft} refinementHistory={refinementHistory} onRefine={handleRefine} isLoading={isLoading}/>
                                    </div>
                                ) : (
                                    <div className="paper-panel p-5">
                                        <p className="mono text-[11px] uppercase tracking-[0.2em]" style={{color:'var(--ink-soft)'}}>Refinements</p>
                                        <p className="text-[13px] leading-relaxed mt-2" style={{color:'var(--ink)'}}>
                                            Change the plan in plain language, like "make the kitchen bigger".
                                            Part of Pro, with the elevations, renders, cost estimate and downloads.
                                        </p>
                                        <button type="button" className="studio-btn studio-btn-primary" style={{marginTop:12}} onClick={() => requireAdvancedAccess('refine')}>
                                            {acct.tier === 'anonymous' ? 'Create a free account' : 'Upgrade for $49 a month'}
                                        </button>
                                    </div>
                                )}
                                {/* Behind a disclosure. The four elevations are a
                                    reference set you consult, not something you
                                    read on the way past, and expanded they pushed
                                    the estimate and the exports far below the
                                    fold. */}
                                <details className="studio-drawer">
                                    <summary>
                                        <span>Elevations</span>
                                        <span className="studio-drawer-meta">All four facades</span>
                                    </summary>
                                    <div className="studio-drawer-body">
                                        {acct.features.elevations
                                            ? <ElevationsPanel elevations={displayElevations} formData={formData} onOpenPreview={img=>setZoomImage(img)}/>
                                            : (
                                                <div className="studio-locked is-inline">
                                                    <p>All four exterior elevations are part of Pro.</p>
                                                    <button type="button" className="studio-btn studio-btn-primary" onClick={() => requireAdvancedAccess('elevations')}>
                                                        {acct.tier === 'anonymous' ? 'Create a free account' : 'Upgrade for $49 a month'}
                                                    </button>
                                                </div>
                                            )}
                                    </div>
                                </details>
                                <div className="paper-panel">
                                    <Render3DPanel
                                        planSpec={planSpec}
                                        formData={formData}
                                        planSvg={planSvg}
                                        elevations={planSpec?.elevations}
                                        galleryId={galleryId}
                                        onRenderReady={img=>setZoomImage(img)}
                                        onRenderStateSnapshot={setRenderState}
                                        launchSignal={renderLaunchSignal}
                                        showLaunchButton={false}
                                        onRenderStatusChange={setRenderPanelStatus}
                                        accessToken={accessToken}
                                        initialState={renderState}
                                        resetKey={renderResetKey}
                                        isLocked={!isUnlocked}
                                        onLockedAction={promptUnlock}
                                    />
                                </div>
                            </>
                        ) : (
                            <div className="paper-panel p-6 text-center text-mid flex flex-col items-center justify-center h-full">
                                <svg className="w-8 h-8 mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"/></svg>
                                <p className="text-[13px] leading-relaxed">Once you generate a plan, this side shows the summary, refinements, elevations, render controls, and the cost estimate.</p>
                            </div>
                        )}
                    </div>
                </div>

                {(status === 'plan-ready' || status === 'refining') && optionSequence.length > 1 && (
                    <div id="keystone-option-stack" className="option-picker">
                        <div className="option-picker-head">
                            <span className="section-label">Other options</span>
                            <p>
                                Keystone AI ranked every layout it drew. Open one to see it full size,
                                then keep it or close and stay where you are.
                            </p>
                        </div>
                        {/* Buttons, not a stacked column of live previews. The
                            previous version rendered all three plan SVGs inline
                            underneath the drawing, which pushed the summary and
                            estimate off-screen and made comparing them a scroll
                            exercise. */}
                        <div className="option-picker-row">
                            {optionSequence.slice(0, 3).map((opt, index) => {
                                const isActive = planSvg === opt?.svg;
                                return (
                                    <button
                                        key={`${opt?.functionalId || 'option'}_${index}`}
                                        type="button"
                                        className={'option-chip' + (isActive ? ' is-current' : '')}
                                        onClick={() => setOpenOption(index)}
                                    >
                                        <span className="option-chip-n">Option {index + 1}</span>
                                        <span className="option-chip-label">
                                            {opt?.functionalLabel || 'Ranked layout'}
                                        </span>
                                        <span className="option-chip-meta">
                                            {opt?.footprintInfo
                                                ? `${opt.footprintInfo.widthFt} x ${opt.footprintInfo.heightFt} ft`
                                                : 'Open to view'}
                                        </span>
                                        {isActive && <span className="option-chip-current">In the studio now</span>}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {(status === 'plan-ready' || status === 'refining') && planSvg && (
                    <details className="studio-drawer">
                        <summary>
                            <span>Generated plan summary</span>
                            <span className="studio-drawer-meta">Details, openings and cost estimate</span>
                        </summary>
                        <div className="studio-drawer-body">
                        <div className="grid xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] gap-0">
                            <div className="border-r border-black/5">
                                <PlanSummaryPanel planSpec={planSpec} openingDiagnostics={openingDiagnostics}/>
                            </div>
                            {isUnlocked ? (
                                <LocatedEstimate location={formData.estimateLocation} onLocation={estimateLocation => setFormData(previous => ({ ...previous, estimateLocation }))} estimate={currentEstimate} onCalculate={calculateLocatedEstimate} />
                            ) : (
                                <div className="paper-panel mt-4 overflow-hidden">
                                    <div className="p-4 md:p-5 border-b border-black/5 bg-white/40">
                                        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                                            <div>
                                                <p className="mono text-[11px] uppercase tracking-[0.24em]" style={{color:'var(--accent)'}}>Cost estimate</p>
                                                <p className="text-[13px] leading-relaxed mt-2" style={{color:'var(--ink)'}}>
                                                    A concept-level cost estimate for this plan, part of Pro.
                                                </p>
                                            </div>
                                            <button type="button" onClick={() => requireAdvancedAccess('estimate')} className="cta-hero">
                                                {acct.tier === 'anonymous' ? 'Create a free account' : 'Upgrade for $49 a month'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        </div>
                    </details>
                )}
                </div>
            </div>
        </section>
    );
};
