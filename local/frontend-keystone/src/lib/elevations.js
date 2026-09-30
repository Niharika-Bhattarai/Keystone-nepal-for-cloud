export const getElevationViews = (elevations) => [
    { key:'frontSvg', label:'Front' },
    { key:'rearSvg', label:'Rear' },
    { key:'leftSvg', label:'Left' },
    { key:'rightSvg', label:'Right' },
].filter(view => elevations?.[view.key]);

export const VIEW_KEY_TO_EDGE = {
    frontSvg: 'front',
    rearSvg: 'rear',
    leftSvg: 'left',
    rightSvg: 'right',
};

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const levelOneDimensions = (planSpec, footprintInfo = {}) => {
    const level1 = (planSpec?.levels || []).find(level => Number(level?.level || 1) === 1) || (planSpec?.levels || [])[0] || null;
    const widthFt = Number(level1?.width || footprintInfo?.widthFt || 0) || 0;
    const depthFt = Number(level1?.height || footprintInfo?.heightFt || 0) || 0;
    return { widthFt, depthFt };
};

export const resolveElevationSpanFt = ({ viewKey, planSpec, footprintInfo }) => {
    const orientation = VIEW_KEY_TO_EDGE[viewKey] || 'front';
    if (planSpec) {
        return Math.max(1, Number(planSpanForElevation(planSpec, orientation) || 0));
    }
    const dims = levelOneDimensions(planSpec, footprintInfo);
    return Math.max(1, Number((orientation === 'left' || orientation === 'right') ? dims.depthFt : dims.widthFt));
};

export const computeScaleBaseFt = ({ planSpec, footprintInfo, views }) => {
    const levelDims = levelOneDimensions(planSpec, footprintInfo);
    const viewSpans = (views || []).map((view) => resolveElevationSpanFt({
        viewKey: view?.key,
        planSpec,
        footprintInfo,
    }));
    return Math.max(levelDims.widthFt || 0, ...viewSpans, 1);
};

export const computeElevationCardScale = ({ spanFt, scaleBaseFt, availableWidthPx }) => {
    const safeSpanFt = Math.max(1, Number(spanFt || 0));
    const safeBaseFt = Math.max(1, Number(scaleBaseFt || 0));
    const widthPct = clamp((safeSpanFt / safeBaseFt) * 96, 44, 96);
    const safeAvailableW = Math.max(1, Number(availableWidthPx || 0));
    const widthPx = clamp(
        safeAvailableW * (widthPct / 100),
        Math.max(76, safeAvailableW * 0.42),
        safeAvailableW
    );
    return { widthPct, widthPx };
};

export const rotateEdgeForView = (frontEdge, viewKey) => {
    const order = ['top', 'right', 'bottom', 'left'];
    const idx = Math.max(0, order.indexOf(String(frontEdge || 'bottom')));
    const delta = viewKey === 'front' ? 0 : viewKey === 'right' ? 1 : viewKey === 'rear' ? 2 : -1;
    return order[(idx + delta + order.length) % order.length];
};

export const planSpanForElevation = (planSpec, viewKey) => {
    const level1 = (planSpec?.levels || []).find(level => Number(level?.level || 1) === 1) || (planSpec?.levels || [])[0];
    if (!level1) return 30;
    const frontEdge = planSpec?.elevations?.meta?.frontEdge || planSpec?.facade?.frontEdge || 'bottom';
    const edge = rotateEdgeForView(frontEdge, viewKey);
    return edge === 'top' || edge === 'bottom'
        ? Number(level1.width || 30)
        : Number(level1.height || 24);
};
