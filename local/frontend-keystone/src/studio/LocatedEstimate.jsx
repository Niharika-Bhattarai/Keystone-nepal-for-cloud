import React, { useState } from 'react';
import { EstimatePanel } from './EstimatePanel.jsx';

export function LocatedEstimate({ location = {}, onLocation, estimate, onCalculate }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const id = React.useId();
    const change = (key, value) => onLocation({ ...location, [key]: value });
    return <section id="estimate-location" className="loc-est" tabIndex={-1} aria-label="Project cost estimate">
        <h3 className="studio-item-title">Where will you build?</h3>
        <p className="loc-est-lead">Enter your US project location to calculate a planning estimate. Local quotes are still needed to confirm costs.</p>
        <form onSubmit={async event => {
            event.preventDefault(); setBusy(true); setError('');
            try { await onCalculate(); } catch (err) { setError(err.message || 'Could not calculate the estimate.'); }
            finally { setBusy(false); }
        }}>
            <fieldset disabled={busy} className="loc-est-fields">
                <label className="loc-est-city" htmlFor={`${id}-city`}>City<input id={`${id}-city`} required minLength={2} maxLength={100} autoComplete="address-level2" value={location.city || ''} onChange={e => change('city', e.target.value)} /></label>
                <label className="loc-est-state" htmlFor={`${id}-state`}>State<input id={`${id}-state`} required pattern="[A-Za-z]{2}" maxLength={2} placeholder="TX" autoComplete="address-level1" value={location.state || ''} onChange={e => change('state', e.target.value.toUpperCase())} /></label>
                <label className="loc-est-zip" htmlFor={`${id}-zip`}>ZIP code<input id={`${id}-zip`} required pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10} autoComplete="postal-code" value={location.zipCode || ''} onChange={e => change('zipCode', e.target.value)} /></label>
                <button type="submit" className="studio-btn studio-btn-primary">{busy ? 'Calculating…' : 'Calculate estimate'}</button>
            </fieldset>
        </form>
        {error && <p className="loc-est-error" role="alert">{error}</p>}
        {estimate && <><p className="loc-est-note">{estimate.assumptions?.regionalNote}</p><EstimatePanel estimate={estimate} /></>}
    </section>;
}
