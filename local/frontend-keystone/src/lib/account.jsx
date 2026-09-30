import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createAuthFetch, ownerToken } from './authFetch.js';

/* Accounts: Firebase sign-in plus the server's view of the account (/api/me:
   tier, what it unlocks, photoreal credits, plan).

   Tiers (owner decision, 2026-09-26):
     anonymous  floor plans only, view only
     free       + saved projects and the quick 3D walkthrough (watermarked)
     pro        $49/month: everything, 3 photoreal houses a month

   Firebase config comes from VITE_FIREBASE_* at build time. Until it is set,
   VITE_DEV_AUTH=1 (development builds only) signs in with local test
   accounts that a backend started with ACCOUNTS_AUTH=insecure-dev accepts.
   Firebase itself is loaded on first use, so the marketing pages stay light. */

const CFG = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const FIREBASE_READY = Boolean(CFG.apiKey && CFG.authDomain && CFG.projectId && CFG.appId);
export const DEV_AUTH = !FIREBASE_READY && import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH === '1';
export const LOCAL_STUDIO = import.meta.env.VITE_LOCAL_STUDIO === '1';
const LOCAL_USER = { uid: 'nepal_local', email: 'local@nepal.invalid', name: 'Local studio' };
const DEV_KEY = 'keystone:devUser';
const LINK_EMAIL_KEY = 'keystone:signInEmail';

const ANON_ME = {
    tier: 'anonymous', user: null, credits: { monthly: 0, extra: 0, total: 0 }, plan: null, openTesting: null,
    features: { plan: true, saveProjects: false, quick3d: false, edit: false, elevations: false, render: false, refine: false, estimate: false, downloads: false, photoreal: false },
};

let fb = null; // { auth, mod }
async function firebase() {
    if (fb) return fb;
    const [{ initializeApp, getApps }, mod] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
    const app = getApps()[0] || initializeApp(CFG);
    fb = { auth: mod.getAuth(app), mod };
    return fb;
}

// Firebase error codes -> something a person can act on.
export function authMessage(e) {
    const code = String(e?.code || '');
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return 'That email and password do not match. Check them, or reset your password.';
    if (/email-already-in-use/.test(code)) return 'There is already an account with this email. Sign in instead.';
    if (/weak-password/.test(code)) return 'Use at least 8 characters for the password.';
    if (/invalid-email/.test(code)) return 'Enter a full email address, like jane@email.com.';
    if (/too-many-requests/.test(code)) return 'Too many attempts. Wait a few minutes and try again.';
    if (/popup-closed|cancelled-popup/.test(code)) return 'The Google window was closed before you finished.';
    if (/popup-blocked/.test(code)) return 'Your browser blocked the Google window. Allow pop-ups for this site and try again.';
    if (/network/.test(code)) return 'Could not reach the sign-in service. Check your connection.';
    if (/expired-action-code|invalid-action-code/.test(code)) return 'That sign-in link has expired or was already used. Ask for a new one.';
    return e?.message && !/^Firebase/.test(e.message) ? e.message : 'Sign-in did not work. Try again.';
}

const Ctx = createContext(null);

export function AccountProvider({ children }) {
    const [authUser, setAuthUser] = useState(null);   // { uid, email, name }
    const [ready, setReady] = useState(false);
    const [me, setMe] = useState(ANON_ME);
    const tokenFn = useRef(async () => null);
    const ownerRef = useRef(null);
    const refreshSequence = useRef(0);

    const refresh = useCallback(async () => {
        const sequence = ++refreshSequence.current;
        const owner = ownerRef.current;
        try {
            const token = await tokenFn.current();
            if (sequence !== refreshSequence.current || owner !== ownerRef.current) return;
            const res = await fetch('/api/me', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
            const data = await res.json();
            if (sequence !== refreshSequence.current || owner !== ownerRef.current) return;
            if (res.ok && data?.success) setMe({ ...ANON_ME, ...data });
            else setMe(ANON_ME);
        } catch {
            setMe((m) => m); // keep what we had; the page shows a retry where it matters
        }
    }, []);

    useEffect(() => {
        let off = () => {};
        let alive = true;
        if (FIREBASE_READY) {
            firebase().then(({ auth, mod }) => {
                if (!alive) return;
                // finish an email-link sign-in if this page is the link's landing page
                if (mod.isSignInWithEmailLink(auth, window.location.href)) {
                    let email = '';
                    try { email = localStorage.getItem(LINK_EMAIL_KEY) || ''; } catch { /* ignore */ }
                    if (!email) email = window.prompt?.('Confirm the email you used for the sign-in link') || '';
                    if (email) mod.signInWithEmailLink(auth, email, window.location.href)
                        .then(() => { try { localStorage.removeItem(LINK_EMAIL_KEY); } catch { /* ignore */ } window.history.replaceState({}, '', window.location.pathname); })
                        .catch(() => {});
                }
                off = mod.onIdTokenChanged(auth, async (u) => {
                    const owner = u?.uid || null;
                    if (ownerRef.current !== owner) { setMe(ANON_ME); setReady(false); }
                    ownerRef.current = owner;
                    tokenFn.current = async () => (u ? u.getIdToken() : null);
                    setAuthUser(u ? { uid: u.uid, email: u.email || '', name: u.displayName || '' } : null);
                    await refresh();
                    if (alive && ownerRef.current === owner) setReady(true);
                });
            }).catch(() => setReady(true));
        } else {
            const load = () => {
                let u = null;
                if (LOCAL_STUDIO) u = LOCAL_USER;
                else if (DEV_AUTH) { try { u = JSON.parse(localStorage.getItem(DEV_KEY) || 'null'); } catch { /* ignore */ } }
                const owner = u?.uid || null;
                if (ownerRef.current !== owner) { setMe(ANON_ME); setReady(false); }
                ownerRef.current = owner;
                tokenFn.current = async () => (LOCAL_STUDIO ? null : u ? `dev:${u.uid}:${u.email}` : null);
                setAuthUser(u);
                refresh().finally(() => { if (alive && ownerRef.current === owner) setReady(true); });
            };
            load();
            const storageChanged = e => { if (e.key === DEV_KEY || e.key === null) load(); };
            window.addEventListener('keystone:dev-auth', load);
            window.addEventListener('storage', storageChanged);
            off = () => { window.removeEventListener('keystone:dev-auth', load); window.removeEventListener('storage', storageChanged); };
        }
        return () => { alive = false; ++refreshSequence.current; off(); };
    }, [refresh]);

    const devSignIn = (email, name = '') => {
        const uid = 'dev_' + email.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
        localStorage.setItem(DEV_KEY, JSON.stringify({ uid, email, name }));
        window.dispatchEvent(new Event('keystone:dev-auth'));
    };

    const actions = useMemo(() => ({
        async signIn(email, password) {
            if (DEV_AUTH) return devSignIn(email);
            const { auth, mod } = await firebase();
            await mod.signInWithEmailAndPassword(auth, email, password);
        },
        async signUp(email, password, name) {
            if (DEV_AUTH) return devSignIn(email, name);
            const { auth, mod } = await firebase();
            const cred = await mod.createUserWithEmailAndPassword(auth, email, password);
            if (name) await mod.updateProfile(cred.user, { displayName: name });
            try { await mod.sendEmailVerification(cred.user); } catch { /* not fatal */ }
        },
        async signInWithGoogle() {
            if (DEV_AUTH) return devSignIn('google.tester@example.com', 'Google Tester');
            const { auth, mod } = await firebase();
            await mod.signInWithPopup(auth, new mod.GoogleAuthProvider());
        },
        async sendSignInLink(email) {
            if (DEV_AUTH) return devSignIn(email);
            const { auth, mod } = await firebase();
            await mod.sendSignInLinkToEmail(auth, email, { url: `${window.location.origin}/account`, handleCodeInApp: true });
            try { localStorage.setItem(LINK_EMAIL_KEY, email); } catch { /* ignore */ }
        },
        async resetPassword(email) {
            if (DEV_AUTH) return;
            const { auth, mod } = await firebase();
            await mod.sendPasswordResetEmail(auth, email, { url: `${window.location.origin}/signin` });
        },
        async signOut() {
            if (LOCAL_STUDIO) return;
            if (DEV_AUTH || !FIREBASE_READY) { try { localStorage.removeItem(DEV_KEY); } catch { /* ignore */ } window.dispatchEvent(new Event('keystone:dev-auth')); return; }
            const { auth, mod } = await firebase();
            await mod.signOut(auth);
        },
    }), []);

    // fetch with the signed-in user's token
    const authFetch = useMemo(() => createAuthFetch(ownerToken(() => tokenFn.current(), () => ownerRef.current, authUser?.uid || null)), [authUser?.uid]);

    const value = useMemo(() => ({
        ready, authUser, me, tier: me.tier, features: me.features, credits: me.credits, plan: me.plan, openTesting: me.openTesting || null,
        signedIn: Boolean(authUser), configured: FIREBASE_READY || DEV_AUTH || LOCAL_STUDIO, devAuth: DEV_AUTH, localStudio: LOCAL_STUDIO,
        refresh, authFetch, getToken: () => tokenFn.current(), ...actions,
    }), [ready, authUser, me, refresh, authFetch, actions]);

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount() {
    const v = useContext(Ctx);
    if (!v) throw new Error('useAccount outside AccountProvider');
    return v;
}

/* What a locked feature needs next: 'signin' (make a free account) or
   'upgrade' (Pro). Null when it is already unlocked. */
export function gateFor(features, tier, feature) {
    if (features?.[feature]) return null;
    return tier === 'anonymous' ? 'signin' : 'upgrade';
}

// What a free account includes, mirroring FEATURES in backend-keystone/lib/accounts/entitlements.js
// (test/free-tier.test.mjs keeps the two in step). Everything else is Pro.
export const FREE_FEATURES = new Set(['plan', 'saveProjects', 'quick3d', 'edit']);

export const FEATURE_LABEL = {
    saveProjects: 'saving projects',
    quick3d: 'the 3D walkthrough',
    edit: 'editing the plan by hand',
    elevations: 'elevation drawings',
    render: 'exterior renders',
    refine: 'refinements',
    estimate: 'the cost estimate',
    downloads: 'downloads',
    photoreal: 'photoreal models',
};
