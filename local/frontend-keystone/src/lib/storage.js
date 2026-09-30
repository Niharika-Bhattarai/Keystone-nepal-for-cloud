import { STUDIO_SESSION_KEY } from '../data/brand.js';

export const createEmptyRenderState = () => ({
    status: 'idle',
    image: null,
    imageClean: null,
    surveyData: null,
    activeRefinement: null,
    errorMsg: '',
});

export const normalizeRenderState = (state) => {
    const base = { ...createEmptyRenderState(), ...(state || {}) };
    if (!base.image) {
        return {
            ...createEmptyRenderState(),
            surveyData: base.surveyData || null,
        };
    }
    return {
        ...base,
        status: base.status && base.status !== 'loading' && base.status !== 'survey' ? base.status : 'ready',
    };
};

export const getStoredJson = (key) => {
    if (typeof window === 'undefined') return null;
    try {
        return JSON.parse(window.localStorage.getItem(key) || 'null');
    } catch {
        return null;
    }
};

export const studioSessionKey = owner => `${STUDIO_SESSION_KEY}:v2:${owner ? `user:${encodeURIComponent(owner)}` : 'anonymous'}`;

export function clearAccountDraft(owner) {
    if (!owner) return;
    localStorage.removeItem(studioSessionKey(owner));
    sessionStorage.removeItem(`keystone:save-journal:v1:${encodeURIComponent(owner)}`);
}

export const getInitialStudioSession = (owner = null) => {
    // Never auto-import the old shared key: it has no trustworthy owner.
    const stored = getStoredJson(studioSessionKey(owner));
    if (!stored || typeof stored !== 'object') return null;
    if (stored.version !== 2 || stored.ownerUid !== owner) return null;
    return stored;
};
