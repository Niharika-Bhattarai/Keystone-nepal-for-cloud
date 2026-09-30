import { computeElevationCardScale, computeScaleBaseFt, getElevationViews, resolveElevationSpanFt } from './elevations.js';
import { extractPrimaryNumber } from './format.js';
import { BRAND_DISPLAY_NAME } from '../data/brand.js';

// The paper colour of exported images (the light --surface-1 token). A canvas
// cannot read CSS variables: fillStyle = 'var(--surface-1)' is ignored and the
// sheet painted black under near-black text (C7).
export const EXPORT_PAPER = '#FAFAF8';

export const svgToPngDataUrl = (svgMarkup, options = {}) => new Promise((resolve, reject) => {
    try {
        if (!svgMarkup || typeof svgMarkup !== 'string') {
            reject(new Error('svgToPngDataUrl: missing SVG markup'));
            return;
        }

        const {
            background = EXPORT_PAPER,
            pixelRatio = window.devicePixelRatio && window.devicePixelRatio > 1 ? Math.min(window.devicePixelRatio, 2) : 1,
            longEdge = null,
        } = options;

        let svg = svgMarkup.trim();
        if (!svg.includes('xmlns=')) {
            svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
        }

        const widthMatch = svg.match(/width=["']([\d.]+)(px)?["']/i);
        const heightMatch = svg.match(/height=["']([\d.]+)(px)?["']/i);
        const viewBoxMatch = svg.match(/viewBox=["']([\d.\s-]+)["']/i);

        let width = widthMatch ? parseFloat(widthMatch[1]) : null;
        let height = heightMatch ? parseFloat(heightMatch[1]) : null;

        if ((!width || !height) && viewBoxMatch) {
            const vb = viewBoxMatch[1].trim().split(/\s+/).map(Number);
            if (vb.length === 4) {
                if (!width) width = vb[2];
                if (!height) height = vb[3];
            }
        }

        if (!width) width = 1600;
        if (!height) height = 1000;

        // Export from vectors at a fixed resolution, independent of display/DPR.
        // Limit peak canvas allocation to 36 MP and 8192 pixels per side.
        const requestedScale = longEdge ? longEdge / Math.max(width, height) : pixelRatio;
        const scale = Math.min(requestedScale, 8192 / Math.max(width, height), Math.sqrt(36000000 / (width * height)));

        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = Math.max(1, Math.round(width * scale));
                canvas.height = Math.max(1, Math.round(height * scale));
                ctx.setTransform(scale, 0, 0, scale, 0, 0);
                if (background) {
                    ctx.fillStyle = background;
                    ctx.fillRect(0, 0, width, height);
                } else {
                    ctx.clearRect(0, 0, width, height);
                }
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/png'));
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = () => reject(new Error('svgToPngDataUrl: unable to rasterize SVG'));
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } catch (err) {
        reject(err);
    }
});

export const loadImageElement = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to load reference image'));
    img.src = src;
});

export const composeElevationReferenceSheet = async (elevations, { exportQuality = false } = {}) => {
    const views = getElevationViews(elevations).map((view) => ({
        ...view,
        label: `${view.label.toUpperCase()} ELEVATION`,
    }));

    if (!views.length) return null;

    const rasterized = await Promise.all(
        views.map(async (view) => ({
            ...view,
            src: await svgToPngDataUrl(elevations[view.key], { background: EXPORT_PAPER, ...(exportQuality ? { longEdge: 3000 } : { longEdge: 1400 }) }),
        }))
    );
    const images = await Promise.all(
        rasterized.map(async (entry) => ({
            ...entry,
            image: await loadImageElement(entry.src),
        }))
    );

    const cols = 2;
    const rows = Math.ceil(images.length / cols);
    const cellW = 720;
    const cellH = 280;
    const gutter = 28;
    const pad = 30;
    const headerH = 54;
    const canvas = document.createElement('canvas');
    canvas.width = pad * 2 + cols * cellW + (cols - 1) * gutter;
    canvas.height = pad * 2 + headerH + rows * cellH + (rows - 1) * gutter;

    const ctx = canvas.getContext('2d');
    const logicalWidth = canvas.width, logicalHeight = canvas.height;
    if (exportQuality) {
        const scale = 6000 / Math.max(logicalWidth, logicalHeight);
        canvas.width = Math.round(logicalWidth * scale);
        canvas.height = Math.round(logicalHeight * scale);
        ctx.scale(scale, scale);
    }
    ctx.fillStyle = EXPORT_PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#d8cfbf';
    ctx.lineWidth = 2;
    ctx.strokeRect(12, 12, logicalWidth - 24, logicalHeight - 24);

    ctx.fillStyle = '#111';
    ctx.font = '700 24px Georgia, serif';
    ctx.fillText(`${BRAND_DISPLAY_NAME} elevation set`, pad, pad + 22);
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#6f6558';
    ctx.fillText(`Style: ${elevations?.meta?.styleLabel || 'Residential'} | Roof: ${String(elevations?.meta?.roofKind || 'gabled').replace(/_/g, ' ')}`, pad, pad + 42);

    images.forEach((entry, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const x = pad + col * (cellW + gutter);
        const y = pad + headerH + row * (cellH + gutter);
        ctx.fillStyle = EXPORT_PAPER;
        ctx.fillRect(x, y, cellW, cellH);
        ctx.strokeStyle = '#d3c9b8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, cellW, cellH);
        ctx.fillStyle = '#534b40';
        ctx.font = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(entry.label, x + 14, y + 20);

        const availableW = cellW - 28;
        const availableH = cellH - 44;
        const scale = Math.min(availableW / entry.image.width, availableH / entry.image.height);
        const drawW = entry.image.width * scale;
        const drawH = entry.image.height * scale;
        const drawX = x + (cellW - drawW) / 2;
        const drawY = y + 30 + (availableH - drawH) / 2;
        ctx.drawImage(entry.image, drawX, drawY, drawW, drawH);
    });

    return canvas.toDataURL('image/png');
};

export const composeBlueprintPresentationSheet = async ({ planSvg, elevations, formData, footprintInfo, renderImage, planSpec }) => {
    if (!planSvg) return null;

    const planSrc = await svgToPngDataUrl(planSvg, { background: EXPORT_PAPER, pixelRatio: 2.5 });
    const planImage = await loadImageElement(planSrc);
    const views = getElevationViews(elevations);
    const renderAsset = renderImage ? await loadImageElement(renderImage) : null;
    const elevationImages = await Promise.all(
        views.map(async (view) => ({
            ...view,
            image: await loadImageElement(await svgToPngDataUrl(elevations[view.key], { background: EXPORT_PAPER, pixelRatio: 2 })),
        }))
    );

    const pad = 30;
    const headerH = 86;
    const gap = 22;
    const planBoxW = 1120;
    const planBoxH = 720;
    const sideW = (views.length || renderAsset) ? 392 : 0;
    const cardGap = 14;
    const cardW = sideW ? (sideW - cardGap) / 2 : 0;
    const cardH = 168;
    const renderCardH = renderAsset ? 248 : 0;
    const elevationRows = views.length ? Math.ceil(views.length / 2) : 0;
    const elevationGridH = views.length ? (elevationRows * cardH) + ((elevationRows - 1) * cardGap) : 0;
    const sideH = (renderAsset ? renderCardH : 0) + (renderAsset && views.length ? cardGap : 0) + elevationGridH;
    const contentH = Math.max(planBoxH, sideH);

    const canvas = document.createElement('canvas');
    canvas.width = pad * 2 + planBoxW + (sideW ? gap + sideW : 0);
    canvas.height = pad * 2 + headerH + contentH;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = EXPORT_PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#d8cfbf';
    ctx.lineWidth = 2;
    ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

    const area = extractPrimaryNumber(formData?.totalArea, footprintInfo?.widthFt && footprintInfo?.heightFt ? String(footprintInfo.widthFt * footprintInfo.heightFt) : '');
    const summaryBits = [
        area ? `${area} SQ FT` : null,
        formData?.bedrooms ? String(formData.bedrooms).toUpperCase() : null,
        formData?.bathrooms ? String(formData.bathrooms).toUpperCase() : null,
        formData?.frontFacing ? `${String(formData.frontFacing).toUpperCase()} FACING` : null,
    ].filter(Boolean);

    ctx.fillStyle = '#ad3300';
    ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(BRAND_DISPLAY_NAME.toUpperCase(), pad, pad + 14);
    ctx.fillStyle = '#111';
    ctx.font = '700 28px Georgia, serif';
    ctx.fillText('Plan, Elevations + Exterior Render', pad, pad + 46);
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#6f6558';
    ctx.fillText(summaryBits.join(' | ') || 'Residential concept set', pad, pad + 70);
    ctx.textAlign = 'right';
    ctx.fillText(`${elevations?.meta?.styleLabel || formData?.materials || 'Residential'} | ${String(elevations?.meta?.roofKind || 'gabled').replace(/_/g, ' ')}`, canvas.width - pad, pad + 70);
    ctx.textAlign = 'left';

    const planX = pad;
    const planY = pad + headerH;
    ctx.fillStyle = EXPORT_PAPER;
    ctx.fillRect(planX, planY, planBoxW, planBoxH);
    ctx.strokeStyle = '#d3c9b8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(planX, planY, planBoxW, planBoxH);
    const planScale = Math.min((planBoxW - 36) / planImage.width, (planBoxH - 36) / planImage.height);
    const drawPlanW = planImage.width * planScale;
    const drawPlanH = planImage.height * planScale;
    const drawPlanX = planX + (planBoxW - drawPlanW) / 2;
    const drawPlanY = planY + (planBoxH - drawPlanH) / 2;
    ctx.drawImage(planImage, drawPlanX, drawPlanY, drawPlanW, drawPlanH);
    const scaleBaseFt = computeScaleBaseFt({ planSpec, footprintInfo, views });

    if (renderAsset) {
        const renderX = pad + planBoxW + gap;
        const renderY = pad + headerH;
        ctx.fillStyle = EXPORT_PAPER;
        ctx.fillRect(renderX, renderY, sideW, renderCardH);
        ctx.strokeStyle = '#d3c9b8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(renderX, renderY, sideW, renderCardH);
        ctx.fillStyle = '#534b40';
        ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText('EXTERIOR RENDER', renderX + 10, renderY + 16);
        const availableW = sideW - 18;
        const availableH = renderCardH - 30;
        const scale = Math.min(availableW / renderAsset.width, availableH / renderAsset.height);
        const drawW = renderAsset.width * scale;
        const drawH = renderAsset.height * scale;
        const drawX = renderX + (sideW - drawW) / 2;
        const drawY = renderY + 22 + (availableH - drawH) / 2;
        ctx.drawImage(renderAsset, drawX, drawY, drawW, drawH);
    }

    const elevationsTop = pad + headerH + (renderAsset ? renderCardH + cardGap : 0);
    elevationImages.forEach((entry, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = pad + planBoxW + gap + col * (cardW + cardGap);
        const y = elevationsTop + row * (cardH + cardGap);
        ctx.fillStyle = EXPORT_PAPER;
        ctx.fillRect(x, y, cardW, cardH);
        ctx.strokeStyle = '#d3c9b8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, cardW, cardH);
        ctx.fillStyle = '#534b40';
        ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(`${entry.label.toUpperCase()} ELEVATION`, x + 10, y + 16);
        const availableW = cardW - 16;
        const availableH = cardH - 30;
        const spanFt = resolveElevationSpanFt({ viewKey: entry.key, planSpec, footprintInfo });
        const targetScale = computeElevationCardScale({
            spanFt,
            scaleBaseFt,
            availableWidthPx: availableW,
        });
        const scale = Math.min(targetScale.widthPx / entry.image.width, availableH / entry.image.height);
        const drawW = entry.image.width * scale;
        const drawH = entry.image.height * scale;
        const drawX = x + (cardW - drawW) / 2;
        const drawY = y + 22 + (availableH - drawH) / 2;
        ctx.drawImage(entry.image, drawX, drawY, drawW, drawH);
    });

    return canvas.toDataURL('image/png');
};
