// A photoreal render request ID is written to storage before the POST is sent.
// If the response is lost (network drop, closed tab, reload), the same ID is
// sent again and the server returns the same render instead of charging a
// second credit. Once the server has acknowledged the render, the record is
// removed; the render itself is then found through GET /api/renders.
const PREFIX = 'keystone:render-request:v1:';

export const renderRequestKey = (owner, projectId) => `${PREFIX}${encodeURIComponent(owner)}:${encodeURIComponent(projectId)}`;

export function pendingRenderRequest(owner, projectId, storage = globalThis.localStorage) {
    try {
        const record = JSON.parse(storage.getItem(renderRequestKey(owner, projectId)) || 'null');
        return record && record.version === 1 && typeof record.requestId === 'string' && Number.isInteger(record.revision) ? record : null;
    } catch { return null; }
}

// Reuses an unacknowledged request for the same saved revision and options;
// anything else starts a new request. Throws if storage refuses the write,
// because an unrecorded request could not be recovered safely.
export function beginRenderRequest(owner, projectId, revision, options, storage = globalThis.localStorage, uuid = () => crypto.randomUUID()) {
    const previous = pendingRenderRequest(owner, projectId, storage);
    const same = previous && previous.revision === revision && JSON.stringify(previous.options) === JSON.stringify(options);
    const record = same ? previous : { version: 1, requestId: uuid(), revision, options, createdAt: Date.now() };
    storage.setItem(renderRequestKey(owner, projectId), JSON.stringify(record));
    return record;
}

export function settleRenderRequest(owner, projectId, requestId, storage = globalThis.localStorage) {
    try { if (pendingRenderRequest(owner, projectId, storage)?.requestId === requestId) storage.removeItem(renderRequestKey(owner, projectId)); } catch { /* nothing to recover */ }
}
