// Plan requests from the studio (C7).

// The longest a plan request may take before the studio gives up. A plan
// normally takes seconds; generating is free, so abandoning a stalled request
// is safe and the brief stays as the user left it.
export const PLAN_DEADLINE_MS = 120_000;

export const PLAN_SLOW = 'This plan is taking much longer than usual. Your brief is unchanged: try again in a moment.';
export const PLAN_OFFLINE = 'Could not reach Keystone AI. Check your connection, then try again. Your brief is unchanged.';

// What to say when the server answered without a sentence of its own.
export function planFailureMessage(status) {
    if (status === 429) return 'Too many plans in a short time. Wait a minute, then try again.';
    if (status === 413) return 'This brief is too large to send. Shorten the notes, then try again.';
    if (status >= 500) return 'The server could not finish this plan. Your brief is unchanged: try again.';
    return 'The plan could not be generated from this brief. Adjust your answers, then try again.';
}
