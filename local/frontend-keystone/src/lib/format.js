// PLAN SUMMARY Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬
export const svgMarkupToDataUri = (svgMarkup) => {
    if (!svgMarkup || typeof svgMarkup !== 'string') return null;
    const svg = svgMarkup.includes('xmlns=')
        ? svgMarkup
        : svgMarkup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
};

export const extractPrimaryNumber = (value, fallback = '') => {
    const match = String(value ?? '').match(/\d+/);
    return match?.[0] || fallback;
};

export const normalizeFilenameWords = (value) => String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const buildPlanExportFilename = (formData, label, extension, fallbackArea = '') => {
    const area = extractPrimaryNumber(formData?.totalArea, fallbackArea);
    const beds = normalizeFilenameWords(formData?.bedrooms);
    const baths = normalizeFilenameWords(formData?.bathrooms);
    const suffix = normalizeFilenameWords(label);
    const parts = [
        area ? `${area}sqft` : '',
        beds,
        baths,
        suffix,
    ].filter(Boolean);
    const stem = parts.join(' ') || 'keystone plan';
    return `${stem}.${extension}`;
};

export const profileLabel = (value) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '-';

// Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬ REFINEMENT PANEL Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬
export const formatUsd = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return `$${Math.round(n).toLocaleString()}`;
};

export const formatQuantity = (value, unit = '') => {
    const n = Number(value);
    const qty = Number.isFinite(n)
        ? (Math.abs(n % 1) < 0.001 ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 }))
        : String(value ?? '-');
    return unit ? `${qty} ${unit}` : qty;
};

export const csvEscape = (value) => {
    const str = value == null ? '' : String(value);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
};

export const estimateToCsv = (estimate) => {
    const rows = Array.isArray(estimate?.csvRows) ? estimate.csvRows : [];
    const headers = ['section', 'item', 'unit', 'quantity', 'low', 'target', 'high', 'notes'];
    const lines = [headers.join(',')];
    rows.forEach((row) => {
        lines.push(headers.map((header) => csvEscape(row?.[header] ?? '')).join(','));
    });
    return lines.join('\r\n');
};
