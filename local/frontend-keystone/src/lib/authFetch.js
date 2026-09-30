// Shared authenticated transport. Resolve the token at request time, never cache
// it in a render closure or send it to an external origin supplied by a caller.
export function createAuthFetch(getToken, transport = globalThis.fetch, origin = globalThis.location?.origin) {
  return async (url, options = {}) => {
    const target = new URL(url, origin);
    if (target.origin !== origin || !target.pathname.startsWith('/api/')) {
      throw new Error('Authenticated requests must use the same-origin API.');
    }
    const token = await getToken();
    const headers = new Headers(options.headers);
    headers.delete('Authorization');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return transport(target.href, { ...options, headers, redirect: 'error' });
  };
}

export function ownerToken(getToken, getOwner, owner) {
  return async () => {
    const check = () => { if (getOwner() !== owner) throw new Error('The signed-in account changed. Reopen the house before saving.'); };
    check();
    const token = await getToken();
    check();
    return token;
  };
}
