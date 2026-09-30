import { useEffect, useRef, useState } from 'react';
import { readSaveJournal, writeSaveJournal, clearSaveJournal } from './saveJournal.js';

// One save at a time. A failed request retains its exact id/body for safe retry.
// A changed draft after an uncertain write requires conflict recovery, not an
// implicit overwrite. Identity changes unmount the owning studio and abort work.
export function useProjectSave({ acct, payload, enabled, initialProjectId, initialRevision = 0, opening }) {
  const owner = acct.authUser?.uid || null;
  const [recovery] = useState(() => { try { return { record: owner ? readSaveJournal(owner) : null }; } catch (error) { return { error: error.message }; } });
  const recoveredProject = recovery.record?.project;
  const [project, setProject] = useState(recoveredProject || { id: initialProjectId || null, revision: initialRevision });
  const [state, setState] = useState({ status: recovery.error ? 'conflict' : 'idle', message: recovery.error || '' });
  const [attempt, setAttempt] = useState(0);
  const saved = useRef(recovery.record?.state === 'complete' ? recovery.record.request.serialized : null);
  const pending = useRef(recovery.record?.state === 'pending' ? recovery.record.request : null);
  const busy = useRef(false);
  const alive = useRef(true);
  const controller = useRef(null);
  const generation = useRef(0);
  const serialized = JSON.stringify(payload);
  const discardRecovery = () => {
    try { clearSaveJournal(owner); return true; }
    catch { setState({ status: 'error', message: 'Save recovery data could not be cleared. Keep this tab open and retry.' }); return false; }
  };

  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (!enabled || opening || busy.current || saved.current === serialized || ['error', 'conflict'].includes(state.status)) return;
    const timer = setTimeout(async () => {
      busy.current = true;
      setState({ status: 'saving', message: 'Saving house…' });
      const abort = new AbortController(); controller.current = abort;
      const current = generation.current;
      const data = JSON.parse(serialized);
      if (project.id) delete data.name;
      if (!pending.current) pending.current = {
        serialized, id: project.id,
        body: JSON.stringify({ ...data, mutationId: crypto.randomUUID(), ...(project.id ? { revision: project.revision } : {}) }),
      };
      const request = pending.current;
      try {
        writeSaveJournal(owner, 'pending', request, project);
        const response = await acct.authFetch(request.id ? `/api/projects/${encodeURIComponent(request.id)}` : '/api/projects', {
          method: request.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: request.body, signal: abort.signal,
        });
        const result = await response.json();
        if (!alive.current || current !== generation.current) return;
        if (!response.ok || !result.project) {
          setState({ status: response.status === 409 || response.status === 404 ? 'conflict' : 'error', message: result.message || 'The house was not saved. Your draft is still here.' });
          return;
        }
        const confirmed = { id: result.project.id, revision: result.project.revision };
        writeSaveJournal(owner, 'complete', request, confirmed);
        saved.current = request.serialized;
        pending.current = null;
        setProject(confirmed);
        setState({ status: 'saved', message: 'House saved' });
      } catch (error) {
        if (alive.current && current === generation.current && !abort.signal.aborted) setState({ status: 'error', message: error?.name === 'QuotaExceededError' ? 'This tab cannot keep save recovery data. Free browser storage and retry; keep this tab open.' : 'Could not save the house. Your draft is still here. Try again.' });
      } finally { if (current === generation.current) busy.current = false; }
    }, 800);
    return () => clearTimeout(timer);
  }, [serialized, enabled, opening, project.id, project.revision, acct.authFetch, state.status, attempt]);

  return {
    project, state: state.status === 'saved' && saved.current !== serialized ? { status: 'waiting', message: 'Changes waiting to save...' } : state,
    retry: () => { setState({ status: 'idle', message: '' }); setAttempt(n => n + 1); },
    copy: () => { if (!discardRecovery()) return; ++generation.current; controller.current?.abort(); busy.current = false; pending.current = null; saved.current = null; setProject({ id: null, revision: 0 }); setState({ status: 'idle', message: '' }); },
    opened: p => { if (!discardRecovery()) return; ++generation.current; controller.current?.abort(); busy.current = false; pending.current = null; saved.current = null; setProject({ id: p.id, revision: p.revision || 0 }); setState({ status: 'idle', message: '' }); },
  };
}
