'use strict';

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function rect(x, y, w, h) {
  return {
    x: num(x),
    y: num(y),
    w: num(w),
    h: num(h),
  };
}

function takeTop(container, height) {
  const h = Math.min(num(height), num(container?.h));
  return [rect(container.x, container.y, container.w, h), rect(container.x, container.y + h, container.w, container.h - h)];
}

function takeBottom(container, height) {
  const h = Math.min(num(height), num(container?.h));
  return [rect(container.x, container.y + container.h - h, container.w, h), rect(container.x, container.y, container.w, container.h - h)];
}

function takeLeft(container, width) {
  const w = Math.min(num(width), num(container?.w));
  return [rect(container.x, container.y, w, container.h), rect(container.x + w, container.y, container.w - w, container.h)];
}

function takeRight(container, width) {
  const w = Math.min(num(width), num(container?.w));
  return [rect(container.x + container.w - w, container.y, w, container.h), rect(container.x, container.y, container.w - w, container.h)];
}

function splitColumns(container, widths) {
  let cursor = rect(container.x, container.y, container.w, container.h);
  return widths.map((width, index) => {
    if (index === widths.length - 1) return cursor;
    const [slice, remainder] = takeLeft(cursor, width);
    cursor = remainder;
    return slice;
  });
}

function splitRows(container, heights) {
  let cursor = rect(container.x, container.y, container.w, container.h);
  return heights.map((height, index) => {
    if (index === heights.length - 1) return cursor;
    const [slice, remainder] = takeTop(cursor, height);
    cursor = remainder;
    return slice;
  });
}

function placeRoom(roomSpec, roomRect, extras = {}) {
  return {
    id: roomSpec.id,
    ...(roomSpec.programId ? { programId: roomSpec.programId } : {}),
    type: roomSpec.type,
    level: roomSpec.level,
    x: roomRect.x,
    y: roomRect.y,
    w: roomRect.w,
    h: roomRect.h,
    zone: roomSpec.zone,
    label: roomSpec.label,
    bathroomUse: roomSpec.bathroomUse || null,
    attachedTo: roomSpec.attachedTo || null,
    roomContract: roomSpec.roomContract || null,
    targetAreaSqFt: roomSpec.targetAreaSqFt,
    requestedFeature: Boolean(roomSpec.requestedFeature),
    ...(roomSpec.requestedFeature ? { requestedFeatureKind: roomSpec.requestedFeatureKind,
      requestedFeatureLabel: roomSpec.requestedFeatureLabel, featureSource: roomSpec.featureSource } : {}),
    ...extras,
  };
}

module.exports = {
  rect,
  takeTop,
  takeBottom,
  takeLeft,
  takeRight,
  splitColumns,
  splitRows,
  placeRoom,
};
