import { planSpanForElevation } from './elevations.js';
import { BRAND_DISPLAY_NAME } from '../data/brand.js';
import { MARK } from '../data/keystoneMark.js';

export const svgAttrNumber = (value, fallback = 0) => {
    const n = parseFloat(String(value ?? '').replace(/[^\d.+-]/g, ''));
    return Number.isFinite(n) ? n : fallback;
};

export const parseSvgPathSubpaths = (d) => {
    const tokens = String(d || '').match(/[MmLlHhVvZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
    const subpaths = [];
    let i = 0;
    let x = 0, y = 0, startX = 0, startY = 0;
    let current = [];
    let command = null;

    const pushCurrent = (closed = false) => {
        if (current.length >= 2) {
            subpaths.push({ points: [...current], closed });
        }
        current = [];
    };

    const readNumber = () => {
        const value = parseFloat(tokens[i++]);
        return Number.isFinite(value) ? value : 0;
    };

    while (i < tokens.length) {
        if (/[A-Za-z]/.test(tokens[i])) {
            command = tokens[i++];
        } else if (!command) {
            break;
        }

        if (command === 'M' || command === 'm') {
            const relative = command === 'm';
            if (current.length) pushCurrent(false);
            x = relative ? x + readNumber() : readNumber();
            y = relative ? y + readNumber() : readNumber();
            startX = x; startY = y;
            current.push([x, y]);
            command = relative ? 'l' : 'L';
            while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
                x = command === 'l' ? x + readNumber() : readNumber();
                y = command === 'l' ? y + readNumber() : readNumber();
                current.push([x, y]);
            }
            continue;
        }

        if (command === 'L' || command === 'l') {
            const relative = command === 'l';
            while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
                x = relative ? x + readNumber() : readNumber();
                y = relative ? y + readNumber() : readNumber();
                current.push([x, y]);
            }
            continue;
        }

        if (command === 'H' || command === 'h') {
            const relative = command === 'h';
            while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
                x = relative ? x + readNumber() : readNumber();
                current.push([x, y]);
            }
            continue;
        }

        if (command === 'V' || command === 'v') {
            const relative = command === 'v';
            while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
                y = relative ? y + readNumber() : readNumber();
                current.push([x, y]);
            }
            continue;
        }

        if (command === 'Z' || command === 'z') {
            if (current.length && (current[0][0] !== x || current[0][1] !== y)) {
                current.push([startX, startY]);
            }
            pushCurrent(true);
            x = startX;
            y = startY;
            command = null;
            continue;
        }
    }

    if (current.length) pushCurrent(false);
    return subpaths;
};

export const buildPresentationDxf = (planSpec) => {
    // Keep DXF in feet and prefer broad-reader compatibility.
    const SCALE = 1;
    // AC1015 + layer lineweights for modern CAD compatibility.
    const DXF_VERSION = 'AC1015';
    const DXF_INCLUDE_LINEWEIGHT_CODES = true;
    const DXF_INCLUDE_OBJECTS_SECTION = true;
    const entities = [];
    let handleSeed = 0x200;
    const nextHandle = () => (handleSeed++).toString(16).toUpperCase();
    const tableHandles = {
        LTYPE: nextHandle(),
        LAYER: nextHandle(),
        STYLE: nextHandle(),
        APPID: nextHandle(),
    };

    // Professional A-prefix layer table.
    const layerStyles = {
        'A-WALL':       { name: 'A-WALL',       color: 7, lineweight: 50 },
        'A-WALL-INT':   { name: 'A-WALL-INT',   color: 8, lineweight: 25 },
        'A-FLOR-PATT':  { name: 'A-FLOR-PATT',  color: 8, lineweight: 9 },
        'A-DOOR':       { name: 'A-DOOR',       color: 1, lineweight: 18 },
        'A-WINDOW':     { name: 'A-WINDOW',     color: 5, lineweight: 18 },
        'A-ROOM-LABEL': { name: 'A-ROOM-LABEL', color: 2, lineweight: 13 },
        'A-FURN':       { name: 'A-FURN',       color: 6, lineweight: 13 },
        'A-DIM':        { name: 'A-DIM',        color: 4, lineweight: 13 },
        'A-ELEV':       { name: 'A-ELEV',       color: 3, lineweight: 25 },
        'A-ELEV-TEXT':  { name: 'A-ELEV-TEXT',  color: 2, lineweight: 13 },
        'A-SHEET':      { name: 'A-SHEET',      color: 8, lineweight: 18 },
        'A-TITLE':      { name: 'A-TITLE',      color: 7, lineweight: 35 },
        'A-NORTH':      { name: 'A-NORTH',      color: 3, lineweight: 18 },
        'A-SCHEDULE':   { name: 'A-SCHEDULE',   color: 2, lineweight: 13 },
    };

    const push = (s) => entities.push(s);
    const finite = (...values) => values.every(v => Number.isFinite(v));
    const safeText = (value) => String(value || '').replace(/\n/g, ' ').replace(/[^\x20-\x7E]/g, '').trim();
    const styleForLayer = (layer) => layerStyles[layer] || { name: String(layer || '0'), color: 7, lineweight: 18 };

    // Layer attributes for entities (color only — lineweights live in LAYER table)
    const dxfLayerAttrs = (layer) => {
        const style = styleForLayer(layer);
        return `8\n${style.name}\n62\n${style.color}`;
    };

    const drawLine = (x1, y1, x2, y2, layer) => {
        if (!finite(x1, y1, x2, y2)) return;
        push(`0\nLINE\n${dxfLayerAttrs(layer)}\n10\n${x1*SCALE}\n20\n${y1*SCALE}\n30\n0\n11\n${x2*SCALE}\n21\n${y2*SCALE}\n31\n0`);
    };
    const drawRect = (x, y, w, h, layer) => {
        if (!finite(x, y, w, h) || w <= 0 || h <= 0) return;
        drawLine(x, y, x + w, y, layer);
        drawLine(x + w, y, x + w, y + h, layer);
        drawLine(x + w, y + h, x, y + h, layer);
        drawLine(x, y + h, x, y, layer);
    };
    const drawCircle = (cx, cy, r, layer) => {
        if (!finite(cx, cy, r) || r <= 0) return;
        push(`0\nCIRCLE\n${dxfLayerAttrs(layer)}\n10\n${cx*SCALE}\n20\n${cy*SCALE}\n30\n0\n40\n${r*SCALE}`);
    };
    const drawArc = (cx, cy, r, startAngle, endAngle, layer) => {
        if (!finite(cx, cy, r, startAngle, endAngle) || r <= 0) return;
        push(`0\nARC\n${dxfLayerAttrs(layer)}\n10\n${cx*SCALE}\n20\n${cy*SCALE}\n30\n0\n40\n${r*SCALE}\n50\n${startAngle}\n51\n${endAngle}`);
    };
    const drawPolyline = (points, layer, closed = false) => {
        if (!Array.isArray(points) || points.length < 2) return;
        const safe = points.filter(([x, y]) => finite(x, y));
        if (safe.length < 2) return;
        for (let i = 0; i < safe.length - 1; i++) {
            drawLine(safe[i][0], safe[i][1], safe[i + 1][0], safe[i + 1][1], layer);
        }
        if (closed) drawLine(safe[safe.length - 1][0], safe[safe.length - 1][1], safe[0][0], safe[0][1], layer);
    };
    const drawText = (x, y, h, text, layer, align = 'left') => {
        const safe = safeText(text);
        if (!safe || !finite(x, y, h) || h <= 0) return;
        const justification = align === 'center' ? 1 : align === 'right' ? 2 : 0;
        push(`0\nTEXT\n${dxfLayerAttrs(layer)}\n10\n${x*SCALE}\n20\n${y*SCALE}\n30\n0\n40\n${h*SCALE}\n1\n${safe}\n7\nSTANDARD\n72\n${justification}\n73\n0\n11\n${x*SCALE}\n21\n${y*SCALE}\n31\n0`);
    };

    // Double-line wall: draws two parallel lines offset ±thickness/2 from the centerline segment
    const drawDoubleLineWall = (x1, y1, x2, y2, thickness, layer) => {
        if (!finite(x1, y1, x2, y2, thickness) || thickness <= 0) return;
        const half = thickness / 2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.01) return;
        // Perpendicular offset unit vector
        const ox = (-dy / len) * half;
        const oy = (dx / len) * half;
        drawLine(x1 + ox, y1 + oy, x2 + ox, y2 + oy, layer);
        drawLine(x1 - ox, y1 - oy, x2 - ox, y2 - oy, layer);
    };

    const drawDimH = (x1, x2, baseY, offset, label) => {
        const y = baseY + offset;
        drawLine(x1, baseY, x1, y, 'A-DIM');
        drawLine(x2, baseY, x2, y, 'A-DIM');
        drawLine(x1, y, x2, y, 'A-DIM');
        drawLine(x1, y - 0.3, x1 + 0.35, y + 0.35, 'A-DIM');
        drawLine(x1, y + 0.3, x1 + 0.35, y - 0.35, 'A-DIM');
        drawLine(x2, y - 0.3, x2 - 0.35, y + 0.35, 'A-DIM');
        drawLine(x2, y + 0.3, x2 - 0.35, y - 0.35, 'A-DIM');
        drawText((x1 + x2) / 2, y + 0.55, 0.75, label, 'A-DIM', 'center');
    };
    const drawDimV = (y1, y2, baseX, offset, label) => {
        const x = baseX - offset;
        drawLine(baseX, y1, x, y1, 'A-DIM');
        drawLine(baseX, y2, x, y2, 'A-DIM');
        drawLine(x, y1, x, y2, 'A-DIM');
        drawLine(x - 0.3, y1, x + 0.3, y1 + 0.35, 'A-DIM');
        drawLine(x + 0.3, y1, x - 0.3, y1 + 0.35, 'A-DIM');
        drawLine(x - 0.3, y2, x + 0.3, y2 - 0.35, 'A-DIM');
        drawLine(x + 0.3, y2, x - 0.3, y2 - 0.35, 'A-DIM');
        drawText(x - 0.55, (y1 + y2) / 2, 0.75, label, 'A-DIM', 'right');
    };
    const drawSheetFrame = (x, y, w, h) => {
        drawRect(x, y, w, h, 'A-SHEET');
        drawRect(x + 0.8, y + 0.8, w - 1.6, h - 1.6, 'A-SHEET');
    };

    // North arrow: circle + N text + triangle pointing north
    const drawNorthArrow = (cx, cy, radius) => {
        drawCircle(cx, cy, radius, 'A-NORTH');
        // Triangle pointing up (north): tip at top, base at bottom of circle
        const tipX = cx, tipY = cy + radius * 0.85;
        const baseLeft = cx - radius * 0.4, baseRight = cx + radius * 0.4, baseY = cy - radius * 0.55;
        drawPolyline([[tipX, tipY], [baseLeft, baseY], [baseRight, baseY], [tipX, tipY]], 'A-NORTH', true);
        // Vertical stem
        drawLine(cx, cy + radius * 0.85, cx, cy - radius * 0.85, 'A-NORTH');
        // N label above circle
        drawText(cx - radius * 0.2, cy + radius + 0.3, radius * 0.7, 'N', 'A-NORTH', 'center');
    };

    // Brand mark: a stylised roof-peak chevron
    // Brand mark: the Keystone AI arch (src/data/keystoneMark.js), each stone as a
    // closed outline, about 2.9 x 2.9 drawing units from its lower-left corner.
    const drawBrandMark = (originX, originY) => {
        const k = 0.13, left = 5, bottom = 27.2;
        const at = ([px, py]) => [originX + (px - left) * k, originY + (bottom - py) * k];
        for (const pts of [...MARK.piers, ...MARK.voussoirs.map((v) => v.points), MARK.key]) drawPolyline(pts.map(at), 'A-TITLE', true);
    };

    // Enhanced title block with logo mark, project fields, scale, drawing number
    const drawTitleBlock = (x, y, w, h) => {
        // Outer border
        drawRect(x, y, w, h, 'A-TITLE');
        // Horizontal divider: top band for logo + title
        drawLine(x, y + h - 4.5, x + w, y + h - 4.5, 'A-SHEET');
        // Vertical divider separating left (brand) from right (project data)
        drawLine(x + w * 0.5, y, x + w * 0.5, y + h - 4.5, 'A-SHEET');

        // Logo mark in top-left of title band
        drawBrandMark(x + 1.0, y + h - 3.8);

        // Company name + subtitle
        drawText(x + 5.5, y + h - 3.2, 1.1,  BRAND_DISPLAY_NAME.toUpperCase(), 'A-TITLE',  'left');
        drawText(x + 5.5, y + h - 1.9, 0.65, 'RESIDENTIAL CONCEPT PLAN', 'A-ROOM-LABEL', 'left');
        drawText(x + 5.5, y + h - 0.9, 0.5,  `Generated ${new Date().toISOString().slice(0, 10)}`, 'A-ROOM-LABEL', 'left');

        // Right column: project metadata
        const rx = x + w * 0.5 + 0.8;
        const styleLabel = String(planSpec?.elevations?.meta?.styleLabel || 'Residential').toUpperCase();
        const frontFacing = String(planSpec?.surveyData?.frontFacing || 'South').toUpperCase();
        const totalArea = (planSpec?.levels || []).reduce((sum, lv) => {
            return sum + (lv.rooms || []).reduce((s, r) => {
                const parts = Array.isArray(r.parts) && r.parts.length ? r.parts : [r];
                return s + parts.reduce((ps, p) => ps + (Number(p.w || 0) * Number(p.h || 0)), 0);
            }, 0);
        }, 0);
        drawText(rx, y + h - 4.1, 0.65, `STYLE: ${styleLabel}`,            'A-ROOM-LABEL', 'left');
        drawText(rx, y + h - 3.2, 0.65, `FRONT: ${frontFacing}`,           'A-ROOM-LABEL', 'left');
        drawText(rx, y + h - 2.3, 0.65, `AREA:  ${Math.round(totalArea)} SQFT`, 'A-ROOM-LABEL', 'left');
        // Model space is drawn at true size in feet ($INSUNITS 2), not "not to scale".
        drawText(rx, y + h - 1.4, 0.55, 'SCALE: 1 UNIT = 1 FT',            'A-ROOM-LABEL', 'left');
        drawText(rx, y + h - 0.7, 0.55, 'DRG: A-101',                      'A-ROOM-LABEL', 'left');
    };

    // Finish class lookup for room schedule
    const finishClassForDxf = (type) => {
        const t = String(type || '').toLowerCase();
        if (/covered_porch|open_deck|screened_porch|patio/.test(t)) return 'COMPOSITE DECK';
        if (/bedroom|primary_bedroom|child|sleep/.test(t)) return 'CARPET';
        if (/living|dining|loft|library|study|gym|family|great_room/.test(t)) return 'HARDWOOD';
        if (/bathroom|kitchen|laundry|mudroom|powder/.test(t)) return 'TILE';
        if (/garage/.test(t)) return 'CONCRETE';
        return 'HARDWOOD';
    };

    // Room schedule table: header + one row per room + footer
    const drawRoomSchedule = (spec, x, y, w) => {
        const rowH = 0.9;
        const colWidths = [w * 0.07, w * 0.30, w * 0.13, w * 0.22, w * 0.28];
        const headers = ['NO.', 'ROOM', 'LEVEL', 'AREA (SQFT)', 'FINISH CLASS'];
        const tileSizeFt = spec?.tileSizeFt || 2;

        // Title
        drawText(x, y + 1.2, 0.7, 'ROOM SCHEDULE', 'A-SCHEDULE', 'left');

        let curY = y;
        // Draw a horizontal line above header
        drawLine(x, curY, x + w, curY, 'A-SCHEDULE');
        curY -= rowH;

        // Header row
        let colX = x;
        headers.forEach((h, i) => {
            drawText(colX + 0.15, curY + 0.25, 0.45, h, 'A-SCHEDULE', 'left');
            colX += colWidths[i];
        });
        drawLine(x, curY, x + w, curY, 'A-SCHEDULE');
        curY -= rowH;

        // Data rows
        let rowNum = 1;
        let totalConditioned = 0;
        let totalGarage = 0;
        (spec?.levels || []).forEach((lv) => {
            (lv.rooms || []).forEach((room) => {
                const parts = Array.isArray(room.parts) && room.parts.length ? room.parts : [room];
                const areaTiles = parts.reduce((s, p) => s + (Number(p.w || 0) * Number(p.h || 0)), 0);
                const areaSqft = Math.round(areaTiles * (tileSizeFt * tileSizeFt));
                const label = String(room.label || room.type || '').toUpperCase().replace(/_/g, ' ');
                const finish = finishClassForDxf(room.type);
                const isGarage = /garage/i.test(String(room.type || ''));
                if (isGarage) totalGarage += areaSqft;
                else totalConditioned += areaSqft;

                const cells = [String(rowNum), label, `L${lv.level || 1}`, `${areaSqft}`, finish];
                colX = x;
                cells.forEach((cell, i) => {
                    drawText(colX + 0.15, curY + 0.22, 0.4, cell, 'A-SCHEDULE', 'left');
                    colX += colWidths[i];
                });
                drawLine(x, curY, x + w, curY, 'A-SCHEDULE');
                curY -= rowH;
                rowNum++;
            });
        });

        // Footer totals
        drawLine(x, curY + rowH, x + w, curY + rowH, 'A-SCHEDULE');
        drawText(x + 0.15, curY - rowH + 0.6, 0.42, `TOTAL CONDITIONED: ${totalConditioned} SQFT`, 'A-SCHEDULE', 'left');
        drawText(x + 0.15, curY - rowH * 2 + 0.6, 0.42, `GARAGE: ${totalGarage} SQFT`, 'A-SCHEDULE', 'left');

        // Vertical column separators
        let sepX = x;
        for (let i = 0; i < colWidths.length - 1; i++) {
            sepX += colWidths[i];
            drawLine(sepX, y, sepX, curY - rowH * 2, 'A-SCHEDULE');
        }
        // Left + right borders
        drawLine(x, y, x, curY - rowH * 2, 'A-SCHEDULE');
        drawLine(x + w, y, x + w, curY - rowH * 2, 'A-SCHEDULE');
    };

    const roomParts = (room) => Array.isArray(room?.parts) && room.parts.length ? room.parts : [room];
    const largestPart = (room) => roomParts(room).reduce((best, part) => (
        ((part.w || 0) * (part.h || 0)) > ((best.w || 0) * (best.h || 0)) ? part : best
    ), roomParts(room)[0] || room || {});
    const roomArea = (room) => roomParts(room).reduce((sum, part) => sum + (Number(part.w || 0) * Number(part.h || 0)), 0);
    const roomRects = (level) => {
        const rects = [];
        (level?.rooms || []).forEach((room) => {
            roomParts(room).forEach((part) => {
                const x = Number(part.x || 0);
                const y = Number(part.y || 0);
                const w = Number(part.w || 0);
                const h = Number(part.h || 0);
                if (finite(x, y, w, h) && w > 0 && h > 0) rects.push({ x, y, w, h });
            });
        });
        return rects;
    };

    const mergeOutlineSegments = (segments) => {
        const EPS = 1e-6;
        const horizontal = segments
            .filter((segment) => Math.abs(Number(segment.y1 || 0) - Number(segment.y2 || 0)) < EPS)
            .map((segment) => ({
                x1: Number(segment.x1 || 0),
                y1: Number(segment.y1 || 0),
                x2: Number(segment.x2 || 0),
                y2: Number(segment.y2 || 0),
            }))
            .sort((a, b) => (a.y1 - b.y1) || (a.x1 - b.x1) || (a.x2 - b.x2));
        const vertical = segments
            .filter((segment) => Math.abs(Number(segment.x1 || 0) - Number(segment.x2 || 0)) < EPS)
            .map((segment) => ({
                x1: Number(segment.x1 || 0),
                y1: Number(segment.y1 || 0),
                x2: Number(segment.x2 || 0),
                y2: Number(segment.y2 || 0),
            }))
            .sort((a, b) => (a.x1 - b.x1) || (a.y1 - b.y1) || (a.y2 - b.y2));

        const mergeRuns = (sorted, axis) => {
            const merged = [];
            sorted.forEach((segment) => {
                const prev = merged[merged.length - 1];
                if (!prev) {
                    merged.push({ ...segment });
                    return;
                }
                if (axis === 'h') {
                    if (Math.abs(prev.y1 - segment.y1) < EPS && Math.abs(prev.x2 - segment.x1) < EPS) {
                        prev.x2 = segment.x2;
                        return;
                    }
                } else if (Math.abs(prev.x1 - segment.x1) < EPS && Math.abs(prev.y2 - segment.y1) < EPS) {
                    prev.y2 = segment.y2;
                    return;
                }
                merged.push({ ...segment });
            });
            return merged;
        };

        return [...mergeRuns(horizontal, 'h'), ...mergeRuns(vertical, 'v')];
    };

    const resolveLevelExteriorGeometry = (level) => {
        const lvlW = Number(level?.width || 0);
        const lvlH = Number(level?.height || 0);

        if (Array.isArray(level?.outlineSegments) && level.outlineSegments.length) {
            return {
                segments: mergeOutlineSegments(level.outlineSegments.map((segment) => ({
                    x1: Number(segment?.x1 || 0),
                    y1: Number(segment?.y1 || 0),
                    x2: Number(segment?.x2 || 0),
                    y2: Number(segment?.y2 || 0),
                }))),
                areaSqFt: Number.isFinite(Number(level?.envelopeAreaSqFt))
                    ? Number(level.envelopeAreaSqFt)
                    : lvlW * lvlH,
            };
        }

        const fallbackSegments = [
            { x1: 0, y1: 0, x2: lvlW, y2: 0 },
            { x1: lvlW, y1: 0, x2: lvlW, y2: lvlH },
            { x1: lvlW, y1: lvlH, x2: 0, y2: lvlH },
            { x1: 0, y1: lvlH, x2: 0, y2: 0 },
        ];
        const rects = roomRects(level);
        if (!rects.length) {
            return { segments: fallbackSegments, areaSqFt: lvlW * lvlH };
        }

        const xs = [...new Set(rects.flatMap((rect) => [rect.x, rect.x + rect.w]))].sort((a, b) => a - b);
        const ys = [...new Set(rects.flatMap((rect) => [rect.y, rect.y + rect.h]))].sort((a, b) => a - b);
        if (xs.length < 2 || ys.length < 2) {
            return { segments: fallbackSegments, areaSqFt: lvlW * lvlH };
        }

        const cells = [];
        let areaSqFt = 0;
        for (let ix = 0; ix < xs.length - 1; ix++) {
            cells[ix] = [];
            const x0 = xs[ix];
            const x1 = xs[ix + 1];
            const midX = (x0 + x1) / 2;
            for (let iy = 0; iy < ys.length - 1; iy++) {
                const y0 = ys[iy];
                const y1 = ys[iy + 1];
                const midY = (y0 + y1) / 2;
                const occupied = rects.some((rect) =>
                    midX >= rect.x && midX < rect.x + rect.w &&
                    midY >= rect.y && midY < rect.y + rect.h
                );
                cells[ix][iy] = occupied;
                if (occupied) areaSqFt += (x1 - x0) * (y1 - y0);
            }
        }

        const segments = [];
        for (let ix = 0; ix < xs.length - 1; ix++) {
            for (let iy = 0; iy < ys.length - 1; iy++) {
                if (!cells[ix][iy]) continue;
                const x0 = xs[ix];
                const x1 = xs[ix + 1];
                const y0 = ys[iy];
                const y1 = ys[iy + 1];
                if (ix === 0 || !cells[ix - 1][iy]) segments.push({ x1: x0, y1: y0, x2: x0, y2: y1 });
                if (ix === xs.length - 2 || !cells[ix + 1][iy]) segments.push({ x1, y1: y0, x2: x1, y2: y1 });
                if (iy === 0 || !cells[ix][iy - 1]) segments.push({ x1: x0, y1: y0, x2: x1, y2: y0 });
                if (iy === ys.length - 2 || !cells[ix][iy + 1]) segments.push({ x1: x0, y1, x2: x1, y2: y1 });
            }
        }

        return {
            segments: mergeOutlineSegments(segments),
            areaSqFt,
        };
    };

    const collectExteriorBreaks = (level, axis) => {
        const max = axis === 'x' ? Number(level.width || 0) : Number(level.height || 0);
        const values = new Set([0, max]);
        (level.rooms || []).forEach((room) => {
            roomParts(room).forEach((part) => {
                const x = Number(part.x || 0), y = Number(part.y || 0), w = Number(part.w || 0), h = Number(part.h || 0);
                if (axis === 'x') {
                    if (y === 0 || y + h === Number(level.height || 0)) {
                        values.add(x);
                        values.add(x + w);
                    }
                } else if (x === 0 || x + w === Number(level.width || 0)) {
                    values.add(y);
                    values.add(y + h);
                }
            });
        });
        return [...values].sort((a, b) => a - b).filter((value, index, arr) => index === 0 || Math.abs(value - arr[index - 1]) > 0.1);
    };

    const roundWallCoord = (value) => Math.round((Number(value) || 0) * 1000) / 1000;
    const wallSegmentKey = (axis, coord) => `${axis}:${roundWallCoord(coord)}`;

    const classifyWallSegments = (level, originX, originY) => {
        const lvlH = Number(level.height || 0);
        const mapY = (y, h = 0) => originY + (lvlH - y - h);
        const groups = new Map();

        const addSegment = (axis, coord, a, b, roomKey) => {
            const start = roundWallCoord(Math.min(a, b));
            const end = roundWallCoord(Math.max(a, b));
            if (!finite(start, end) || end - start < 0.05) return;
            const key = wallSegmentKey(axis, coord);
            let group = groups.get(key);
            if (!group) {
                group = {
                    axis,
                    coord: roundWallCoord(coord),
                    spans: [],
                    breaks: new Set(),
                };
                groups.set(key, group);
            }
            group.spans.push({ start, end, roomKey: String(roomKey || '') });
            group.breaks.add(start);
            group.breaks.add(end);
        };

        (level.rooms || []).forEach((room, roomIndex) => {
            const roomKey = String(room?.id || room?.label || room?.type || `room_${roomIndex}`);
            roomParts(room).forEach((part) => {
                const px = Number(part.x || 0);
                const py = Number(part.y || 0);
                const pw = Number(part.w || 0);
                const ph = Number(part.h || 0);
                if (!finite(px, py, pw, ph) || pw <= 0 || ph <= 0) return;

                const rx = originX + px;
                const ry = mapY(py, ph);
                const rx2 = rx + pw;
                const ry2 = ry + ph;

                addSegment('h', ry, rx, rx2, roomKey);
                addSegment('h', ry2, rx, rx2, roomKey);
                addSegment('v', rx, ry, ry2, roomKey);
                addSegment('v', rx2, ry, ry2, roomKey);
            });
        });

        const out = [];
        groups.forEach((group) => {
            const sortedBreaks = [...group.breaks].sort((a, b) => a - b);
            for (let i = 0; i < sortedBreaks.length - 1; i++) {
                const a = sortedBreaks[i];
                const b = sortedBreaks[i + 1];
                if (b - a < 0.05) continue;
                const mid = (a + b) / 2;
                const covering = group.spans.filter((span) => mid >= span.start - 0.001 && mid <= span.end + 0.001);
                if (!covering.length) continue;
                const roomKeys = new Set(covering.map((span) => span.roomKey).filter(Boolean));
                if (!roomKeys.size) continue;

                // Skip seams created by multi-part decomposition of a single room.
                if (roomKeys.size === 1 && covering.length > 1) continue;

                const type = roomKeys.size > 1 ? 'interior' : 'exterior';
                if (group.axis === 'h') {
                    out.push({ x1: a, y1: group.coord, x2: b, y2: group.coord, type });
                } else {
                    out.push({ x1: group.coord, y1: a, x2: group.coord, y2: b, type });
                }
            }
        });
        return out;
    };

    const drawHatchInRect = (x, y, w, h, pattern) => {
        if (!finite(x, y, w, h) || w <= 0.25 || h <= 0.25) return;
        const left = x;
        const right = x + w;
        const bottom = y;
        const top = y + h;
        const maxMarks = 240;

        if (pattern === 'TILE') {
            const spacing = 2.0;
            let marks = 0;
            for (let xx = left + spacing; xx < right && marks < maxMarks; xx += spacing, marks++) {
                drawLine(xx, bottom, xx, top, 'A-FLOR-PATT');
            }
            for (let yy = bottom + spacing; yy < top && marks < maxMarks * 2; yy += spacing, marks++) {
                drawLine(left, yy, right, yy, 'A-FLOR-PATT');
            }
            return;
        }

        if (pattern === 'CARPET' || pattern === 'CONCRETE') {
            const spacing = pattern === 'CARPET' ? 1.4 : 2.6;
            const radius = pattern === 'CARPET' ? 0.045 : 0.035;
            let marks = 0;
            for (let yy = bottom + spacing / 2; yy < top && marks < maxMarks; yy += spacing) {
                for (let xx = left + spacing / 2; xx < right && marks < maxMarks; xx += spacing, marks++) {
                    drawCircle(xx, yy, radius, 'A-FLOR-PATT');
                }
            }
            return;
        }

        // HARDWOOD default: diagonal plank-like strokes
        const spacing = 1.2;
        let marks = 0;
        for (let offset = -h; offset <= w && marks < maxMarks; offset += spacing, marks++) {
            const x1 = left + Math.max(0, offset);
            const y1 = bottom + Math.max(0, -offset);
            const x2 = left + Math.min(w, offset + h);
            const y2 = bottom + Math.min(h, h + offset);
            if (finite(x1, y1, x2, y2) && (Math.abs(x2 - x1) > 0.05 || Math.abs(y2 - y1) > 0.05)) {
                drawLine(x1, y1, x2, y2, 'A-FLOR-PATT');
            }
        }
    };

    const drawFurnitureItem = (item, level, originX, originY) => {
        const lvlH = Number(level.height || 0);
        const fx = originX + Number(item.x || 0);
        const fy = originY + (lvlH - Number(item.y || 0) - Number(item.h || 0));
        const fw = Number(item.w || 0);
        const fh = Number(item.h || 0);
        if (!fw || !fh) return;
        drawRect(fx, fy, fw, fh, 'A-FURN');
        const kind = String(item.kind || '').toLowerCase();
        if (kind.includes('bed')) {
            drawLine(fx, fy + fh - 0.8, fx + fw, fy + fh - 0.8, 'A-FURN');
            drawRect(fx + 0.35, fy + fh - 1.35, Math.min(1.35, fw / 2 - 0.45), 0.55, 'A-FURN');
            drawRect(fx + fw - Math.min(1.35, fw / 2 - 0.45) - 0.35, fy + fh - 1.35, Math.min(1.35, fw / 2 - 0.45), 0.55, 'A-FURN');
        } else if (kind === 'shower') {
            drawLine(fx, fy, fx + fw, fy + fh, 'A-FURN');
            drawLine(fx + fw, fy, fx, fy + fh, 'A-FURN');
        } else if (kind === 'washer' || kind === 'dryer') {
            drawCircle(fx + fw / 2, fy + fh / 2, Math.min(fw, fh) * 0.22, 'A-FURN');
        } else if (kind === 'dining_table') {
            drawCircle(fx + fw / 2, fy + fh / 2, Math.min(fw, fh) * 0.35, 'A-FURN');
        } else if (kind === 'sofa') {
            drawLine(fx + 0.4, fy + 0.55, fx + fw - 0.4, fy + 0.55, 'A-FURN');
            drawLine(fx + 0.4, fy + fh - 0.55, fx + fw - 0.4, fy + fh - 0.55, 'A-FURN');
        } else if (kind === 'coffee_table' || kind === 'console' || kind === 'dresser' || kind === 'laundry_counter' || kind === 'desk') {
            drawLine(fx, fy + fh / 2, fx + fw, fy + fh / 2, 'A-FURN');
        } else if (kind === 'bookcase' || kind === 'counter') {
            const step = Math.max(0.5, fw > fh ? fh / 4 : fw / 4);
            if (fw >= fh) {
                for (let y = fy + step; y < fy + fh; y += step) drawLine(fx, y, fx + fw, y, 'A-FURN');
            } else {
                for (let x = fx + step; x < fx + fw; x += step) drawLine(x, fy, x, fy + fh, 'A-FURN');
            }
        } else if (kind === 'vanity') {
            drawCircle(fx + fw * 0.28, fy + fh * 0.5, Math.min(fw, fh) * 0.12, 'A-FURN');
        } else if (kind === 'tub') {
            drawRect(fx + 0.25, fy + 0.25, Math.max(0.8, fw - 0.5), Math.max(0.8, fh - 0.5), 'A-FURN');
        }
    };

    const drawDoorSymbol = (door, level, originX, originY) => {
        const lvlH = Number(level.height || 0);
        const dw = Number(door.width || door.doorWidth || (door.garageDoor ? 9 : 3));
        const mapY = (y) => originY + (lvlH - y);
        const dx = originX + Number(door.x || 0);
        const dy = mapY(Number(door.y || 0));

        if (door.garageDoor) {
            if (door.dir === 'horizontal') {
                const left = dx - dw / 2;
                const top = dy + 0.35;
                drawLine(left, top, left + dw, top, 'A-DOOR');
                const panelWidth = dw / Math.max(3, Math.round(dw / 2.5));
                for (let px = left + panelWidth; px < left + dw - 0.1; px += panelWidth) {
                    drawLine(px, top, px, top - 0.9, 'A-DOOR');
                }
                drawLine(left, top, left + 0.9, top - 0.9, 'A-DOOR');
                drawLine(left + dw, top, left + dw - 0.9, top - 0.9, 'A-DOOR');
            } else {
                const bottom = dy - dw / 2;
                drawLine(dx + 0.35, bottom, dx + 0.35, bottom + dw, 'A-DOOR');
                const panelHeight = dw / Math.max(3, Math.round(dw / 2.5));
                for (let py = bottom + panelHeight; py < bottom + dw - 0.1; py += panelHeight) {
                    drawLine(dx + 0.35, py, dx - 0.55, py, 'A-DOOR');
                }
                drawLine(dx + 0.35, bottom, dx - 0.55, bottom + 0.9, 'A-DOOR');
                drawLine(dx + 0.35, bottom + dw, dx - 0.55, bottom + dw - 0.9, 'A-DOOR');
            }
            return;
        }

        if (door.openThreshold) {
            const gapHalf = dw / 2;
            if (door.dir === 'horizontal') {
                drawLine(dx - gapHalf, dy, dx + gapHalf, dy, 'A-DOOR');
            } else {
                drawLine(dx, dy - gapHalf, dx, dy + gapHalf, 'A-DOOR');
            }
            return;
        }

        const rooms = level.rooms || [];
        const roomA = rooms.find(room => String(room.id) === String(door.a));
        const roomB = rooms.find(room => String(room.id) === String(door.b));
        const isPrivate = (room) => /bedroom|bathroom|study|office|garage|library|gym/i.test(String(room?.type || ''));
        const preferIntoA = isPrivate(roomA) && !isPrivate(roomB);
        const preferIntoB = isPrivate(roomB) && !isPrivate(roomA);

        if (door.dir === 'vertical') {
            const yTop = dy + dw / 2;
            const yBottom = dy - dw / 2;
            const centerA = roomA ? Number(roomA.x || 0) + Number(roomA.w || 0) / 2 : 0;
            const centerB = roomB ? Number(roomB.x || 0) + Number(roomB.w || 0) / 2 : 0;
            const swingRight = preferIntoB ? centerB > Number(door.x || 0) : preferIntoA ? centerA > Number(door.x || 0) : centerB >= centerA;
            const hingeX = dx;
            const hingeY = yTop;
            const leafX = swingRight ? dx + dw : dx - dw;
            drawLine(hingeX, hingeY, leafX, hingeY, 'A-DOOR');
            if (swingRight) drawArc(hingeX, hingeY, dw, 270, 360, 'A-DOOR');
            else drawArc(hingeX, hingeY, dw, 180, 270, 'A-DOOR');
            drawLine(dx, yTop, dx, yBottom, 'A-DOOR');
            return;
        }

        const xLeft = dx - dw / 2;
        const centerA = roomA ? Number(roomA.y || 0) + Number(roomA.h || 0) / 2 : 0;
        const centerB = roomB ? Number(roomB.y || 0) + Number(roomB.h || 0) / 2 : 0;
        const swingDown = preferIntoB ? centerB < Number(door.y || 0) : preferIntoA ? centerA < Number(door.y || 0) : centerB <= centerA;
        const hingeX = xLeft;
        const hingeY = dy;
        const leafY = swingDown ? dy - dw : dy + dw;
        drawLine(hingeX, hingeY, hingeX, leafY, 'A-DOOR');
        if (swingDown) drawArc(hingeX, hingeY, dw, 270, 360, 'A-DOOR');
        else drawArc(hingeX, hingeY, dw, 0, 90, 'A-DOOR');
        drawLine(dx - dw / 2, dy, dx + dw / 2, dy, 'A-DOOR');
    };

    const drawWindowSymbol = (win, level, originX, originY) => {
        const lvlH = Number(level.height || 0);
        const ww = Number(win.width || win.windowWidth || 4);
        const mapY = (y) => originY + (lvlH - y);
        const wx = originX + Number(win.x || 0);
        const wy = mapY(Number(win.y || 0));
        if (win.dir === 'horizontal') {
            drawLine(wx - ww / 2, wy - 0.18, wx + ww / 2, wy - 0.18, 'A-WINDOW');
            drawLine(wx - ww / 2, wy + 0.18, wx + ww / 2, wy + 0.18, 'A-WINDOW');
        } else {
            drawLine(wx - 0.18, wy - ww / 2, wx - 0.18, wy + ww / 2, 'A-WINDOW');
            drawLine(wx + 0.18, wy - ww / 2, wx + 0.18, wy + ww / 2, 'A-WINDOW');
        }
    };

    const drawPlanLevel = (level, originX, originY) => {
        const lvlW = Number(level.width || 40);
        const lvlH = Number(level.height || 30);
        const mapY = (y, h = 0) => originY + (lvlH - y - h);
        const mapLineY = (y) => originY + (lvlH - y);
        const titleY = originY + lvlH + 7.5;
        const exteriorGeometry = resolveLevelExteriorGeometry(level);
        const levelAreaSqFt = Math.round(Number(exteriorGeometry?.areaSqFt || (lvlW * lvlH)));

        drawText(originX, titleY, 1.35, `LEVEL ${level.level}`, 'A-ROOM-LABEL');
        drawText(originX, titleY - 1.2, 0.8, `${levelAreaSqFt.toLocaleString()} SQ FT`, 'A-ROOM-LABEL');

        // Room hatches first so walls/symbols remain legible above them.
        (level.rooms || []).forEach((room) => {
            const finishClass = finishClassForDxf(room.type);
            roomParts(room).forEach((part) => {
                const px = Number(part.x || 0);
                const py = Number(part.y || 0);
                const pw = Number(part.w || 0);
                const ph = Number(part.h || 0);
                if (!finite(px, py, pw, ph) || pw <= 0 || ph <= 0) return;
                const rx = originX + px;
                const ry = mapY(py, ph);
                drawHatchInRect(rx, ry, pw, ph, finishClass);
            });
        });

        // Shared-wall extraction: draw each centerline segment once.
        const EXT_THICK = 0.5;
        const INT_THICK = 0.33;
        const wallSegments = classifyWallSegments(level, originX, originY);
        wallSegments.forEach((segment) => {
            const exterior = segment.type === 'exterior';
            if (exterior) return;
            drawDoubleLineWall(
                segment.x1,
                segment.y1,
                segment.x2,
                segment.y2,
                INT_THICK,
                'A-WALL-INT'
            );
        });

        (exteriorGeometry?.segments || []).forEach((segment) => {
            const x1 = originX + Number(segment.x1 || 0);
            const y1 = mapLineY(Number(segment.y1 || 0));
            const x2 = originX + Number(segment.x2 || 0);
            const y2 = mapLineY(Number(segment.y2 || 0));
            drawDoubleLineWall(x1, y1, x2, y2, EXT_THICK, 'A-WALL');
        });

        (level.rooms || []).forEach((room) => {
            const anchor = largestPart(room);
            const label = String(room.label || room.type || '').toUpperCase().replace(/_/g, ' ');
            drawText(originX + Number(anchor.x || 0) + Number(anchor.w || 0) / 2, mapY(Number(anchor.y || 0), Number(anchor.h || 0)) + Number(anchor.h || 0) / 2 + 0.4, 0.6, label, 'A-ROOM-LABEL', 'center');
            drawText(originX + Number(anchor.x || 0) + Number(anchor.w || 0) / 2, mapY(Number(anchor.y || 0), Number(anchor.h || 0)) + Number(anchor.h || 0) / 2 - 0.5, 0.45, `${Math.round(roomArea(room))} sqft`, 'A-ROOM-LABEL', 'center');
        });

        (level.doors || []).forEach((door) => drawDoorSymbol(door, level, originX, originY));
        (level.windows || []).forEach((win) => drawWindowSymbol(win, level, originX, originY));
        (level.furniture || []).forEach((item) => drawFurnitureItem(item, level, originX, originY));

        drawDimH(originX, originX + lvlW, originY + lvlH, 3.2, `${lvlW.toFixed(0)}'`);
        drawDimV(originY, originY + lvlH, originX, 3.2, `${lvlH.toFixed(0)}'`);

        const xBreaks = collectExteriorBreaks(level, 'x');
        const yBreaks = collectExteriorBreaks(level, 'y');
        if (xBreaks.length > 2 && xBreaks.length <= 9) {
            for (let i = 0; i < xBreaks.length - 1; i++) {
                const a = xBreaks[i], b = xBreaks[i + 1];
                if (b - a < 1) continue;
                drawDimH(originX + a, originX + b, originY + lvlH, 1.55, `${(b - a).toFixed(0)}'`);
            }
        }
        if (yBreaks.length > 2 && yBreaks.length <= 9) {
            for (let i = 0; i < yBreaks.length - 1; i++) {
                const a = yBreaks[i], b = yBreaks[i + 1];
                if (b - a < 1) continue;
                drawDimV(originY + lvlH - b, originY + lvlH - a, originX, 1.55, `${(b - a).toFixed(0)}'`);
            }
        }

        return { width: lvlW, height: lvlH };
    };

    const drawElevationSvg = (svgMarkup, label, originX, originY, targetWidthFt, dimensionLabel) => {
        if (!svgMarkup || typeof DOMParser === 'undefined') return { width: targetWidthFt, height: 0 };
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
        const root = doc.documentElement;
        const viewBox = String(root.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
        const vbX = viewBox.length === 4 ? viewBox[0] : 0;
        const vbY = viewBox.length === 4 ? viewBox[1] : 0;
        const vbW = viewBox.length === 4 ? viewBox[2] : svgAttrNumber(root.getAttribute('width'), 940);
        const vbH = viewBox.length === 4 ? viewBox[3] : svgAttrNumber(root.getAttribute('height'), 480);
        const scale = targetWidthFt / Math.max(1, vbW);
        const mapX = (x) => originX + (x - vbX) * scale;
        const mapY = (y, h = 0) => originY + (vbH - (y - vbY) - h) * scale;
        const elevationHeight = vbH * scale;

        drawText(originX, originY + elevationHeight + 3.2, 0.95, label, 'A-ELEV-TEXT');
        if (dimensionLabel) drawDimH(originX, originX + targetWidthFt, originY, -2.4, dimensionLabel);

        root.querySelectorAll('line,rect,circle,path,text,polygon,polyline').forEach((node) => {
            const tag = node.tagName.toLowerCase();
            const stroke = node.getAttribute('stroke');
            const fill = node.getAttribute('fill');

            if (tag === 'rect') {
                const x = svgAttrNumber(node.getAttribute('x'));
                const y = svgAttrNumber(node.getAttribute('y'));
                const w = svgAttrNumber(node.getAttribute('width'));
                const h = svgAttrNumber(node.getAttribute('height'));
                if (!w || !h) return;
                const fullBg = w >= vbW * 0.98 && h >= vbH * 0.98 && !stroke;
                if (fullBg) return;
                if (!stroke && (!fill || fill === 'none')) return;
                drawRect(mapX(x), mapY(y, h), w * scale, h * scale, 'A-ELEV');
                return;
            }

            if (tag === 'line') {
                const x1 = svgAttrNumber(node.getAttribute('x1'));
                const y1 = svgAttrNumber(node.getAttribute('y1'));
                const x2 = svgAttrNumber(node.getAttribute('x2'));
                const y2 = svgAttrNumber(node.getAttribute('y2'));
                drawLine(mapX(x1), mapY(y1), mapX(x2), mapY(y2), 'A-ELEV');
                return;
            }

            if (tag === 'circle') {
                const cx = svgAttrNumber(node.getAttribute('cx'));
                const cy = svgAttrNumber(node.getAttribute('cy'));
                const r = svgAttrNumber(node.getAttribute('r'));
                if (r > 0) drawCircle(mapX(cx), mapY(cy), r * scale, 'A-ELEV');
                return;
            }

            if (tag === 'polygon' || tag === 'polyline') {
                const raw = String(node.getAttribute('points') || '').trim();
                if (!raw) return;
                const points = raw
                    .split(/\s+/)
                    .map(pair => pair.split(',').map(Number))
                    .filter(pair => pair.length === 2 && pair.every(Number.isFinite))
                    .map(([x, y]) => [mapX(x), mapY(y)]);
                drawPolyline(points, 'A-ELEV', tag === 'polygon');
                return;
            }

            if (tag === 'path') {
                parseSvgPathSubpaths(node.getAttribute('d')).forEach((subpath) => {
                    const points = subpath.points.map(([x, y]) => [mapX(x), mapY(y)]);
                    drawPolyline(points, 'A-ELEV', subpath.closed);
                });
                return;
            }

            if (tag === 'text') {
                const x = svgAttrNumber(node.getAttribute('x'));
                const y = svgAttrNumber(node.getAttribute('y'));
                const size = Math.max(0.45, svgAttrNumber(node.getAttribute('font-size'), 10) * scale * 0.18);
                const text = node.textContent || '';
                if (text.trim()) drawText(mapX(x), mapY(y), size, text, 'A-ELEV-TEXT');
            }
        });

        return { width: targetWidthFt, height: elevationHeight };
    };

    const level1 = (planSpec.levels || [])[0];
    const level2 = (planSpec.levels || [])[1];
    const leftMargin = 8;
    const planGap = 14;
    const elevationGap = 10;
    const planBaseY = 62;

    const level1Origin = { x: leftMargin, y: planBaseY };
    const level1Size = drawPlanLevel(level1, level1Origin.x, level1Origin.y);
    const level2Origin = { x: leftMargin + level1Size.width + planGap, y: planBaseY };
    const level2Size = level2 ? drawPlanLevel(level2, level2Origin.x, level2Origin.y) : { width: 0, height: 0 };

    const elevations = planSpec?.elevations || {};
    const frontWidth = Math.max(26, planSpanForElevation(planSpec, 'front'));
    const rearWidth = Math.max(26, planSpanForElevation(planSpec, 'rear'));
    const leftWidth = Math.max(18, planSpanForElevation(planSpec, 'left'));
    const rightWidth = Math.max(18, planSpanForElevation(planSpec, 'right'));

    const elevationRow1Y = 0;
    const elevationRow2Y = 26;
    drawElevationSvg(elevations.frontSvg, 'FRONT ELEVATION', leftMargin, elevationRow1Y, frontWidth, `${frontWidth.toFixed(0)}'`);
    drawElevationSvg(elevations.rearSvg, 'REAR ELEVATION', leftMargin + frontWidth + elevationGap, elevationRow1Y, rearWidth, `${rearWidth.toFixed(0)}'`);
    drawElevationSvg(elevations.leftSvg, 'LEFT ELEVATION', leftMargin, elevationRow2Y, leftWidth, `${leftWidth.toFixed(0)}'`);
    drawElevationSvg(elevations.rightSvg, 'RIGHT ELEVATION', leftMargin + leftWidth + elevationGap, elevationRow2Y, rightWidth, `${rightWidth.toFixed(0)}'`);

    const sheet = { x: 0, y: 0, w: 140, h: 108 };
    drawSheetFrame(sheet.x, sheet.y, sheet.w, sheet.h);

    // Title block: right side of sheet, upper portion
    const tbX = sheet.x + sheet.w - 42;
    const tbY = sheet.y + 2;
    const tbW = 40;
    const tbH = 14;
    drawTitleBlock(tbX, tbY, tbW, tbH);

    // North arrow: inside title block area, lower-right
    drawNorthArrow(tbX + tbW - 4, tbY + 4, 2);

    // Room schedule: below title block
    const schedW = tbW;
    const schedY = tbY + tbH + 1;
    drawRoomSchedule(planSpec, tbX, schedY + 16, schedW);

    // Assemble DXF output.
    const lines = [];
    // HEADER
    lines.push('0\nSECTION\n2\nHEADER');
    lines.push(`9\n$ACADVER\n1\n${DXF_VERSION}`);
    lines.push('9\n$DWGCODEPAGE\n3\nANSI_1252');
    lines.push('9\n$INSUNITS\n70\n2');      // 2 = feet
    lines.push('9\n$MEASUREMENT\n70\n0');   // 0 = imperial
    lines.push('9\n$LTSCALE\n40\n1.0');
    lines.push('9\n$LIMMIN\n10\n0.0\n20\n0.0');
    lines.push(`9\n$LIMMAX\n10\n${(sheet.w * SCALE).toFixed(1)}\n20\n${(sheet.h * SCALE).toFixed(1)}`);
    lines.push('0\nENDSEC');
    const tableHeader = (name, count, handle) => {
        if (DXF_VERSION === 'AC1015') {
            return `0\nTABLE\n2\n${name}\n5\n${handle}\n330\n0\n100\nAcDbSymbolTable\n70\n${count}`;
        }
        return `0\nTABLE\n2\n${name}\n70\n${count}`;
    };

    const tableRecordPrefix = (dxftype, ownerHandle, className) => {
        if (DXF_VERSION !== 'AC1015') return `0\n${dxftype}\n`;
        return `0\n${dxftype}\n5\n${nextHandle()}\n330\n${ownerHandle}\n100\nAcDbSymbolTableRecord\n100\n${className}\n`;
    };

    // TABLES
    lines.push('0\nSECTION\n2\nTABLES');
    // LTYPE table
    lines.push(tableHeader('LTYPE', 1, tableHandles.LTYPE));
    lines.push(`${tableRecordPrefix('LTYPE', tableHandles.LTYPE, 'AcDbLinetypeTableRecord')}2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0`);
    lines.push('0\nENDTAB');
    // LAYER table
    lines.push(tableHeader('LAYER', Object.keys(layerStyles).length + 1, tableHandles.LAYER));
    lines.push(`${tableRecordPrefix('LAYER', tableHandles.LAYER, 'AcDbLayerTableRecord')}2\n0\n70\n0\n62\n7\n6\nCONTINUOUS`);
    Object.values(layerStyles).forEach((style) => {
        const lineweight = DXF_INCLUDE_LINEWEIGHT_CODES ? `\n370\n${style.lineweight}` : '';
        lines.push(`${tableRecordPrefix('LAYER', tableHandles.LAYER, 'AcDbLayerTableRecord')}2\n${style.name}\n70\n0\n62\n${style.color}\n6\nCONTINUOUS${lineweight}`);
    });
    lines.push('0\nENDTAB');
    // STYLE table
    lines.push(tableHeader('STYLE', 1, tableHandles.STYLE));
    lines.push(`${tableRecordPrefix('STYLE', tableHandles.STYLE, 'AcDbTextStyleTableRecord')}2\nSTANDARD\n70\n0\n40\n0\n41\n1\n50\n0\n71\n0\n42\n0.2\n3\ntxt\n4\n`);
    lines.push('0\nENDTAB');
    // APPID table
    lines.push(tableHeader('APPID', 1, tableHandles.APPID));
    lines.push(`${tableRecordPrefix('APPID', tableHandles.APPID, 'AcDbRegAppTableRecord')}2\nACAD\n70\n0`);
    lines.push('0\nENDTAB');
    lines.push('0\nENDSEC');
    // BLOCKS — required MODEL_SPACE and PAPER_SPACE stubs
    lines.push('0\nSECTION\n2\nBLOCKS');
    lines.push('0\nBLOCK\n8\n0\n2\n*MODEL_SPACE\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n3\n*MODEL_SPACE\n1\n');
    lines.push('0\nENDBLK\n8\n0');
    lines.push('0\nBLOCK\n8\n0\n2\n*PAPER_SPACE\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n3\n*PAPER_SPACE\n1\n');
    lines.push('0\nENDBLK\n8\n0');
    lines.push('0\nENDSEC');
    // ENTITIES
    lines.push('0\nSECTION\n2\nENTITIES');
    lines.push(...entities);
    lines.push('0\nENDSEC');
    if (DXF_INCLUDE_OBJECTS_SECTION) {
        const rootDictionaryHandle = nextHandle();
        const childDictionaryHandles = {
            ACAD_VISUALSTYLE: nextHandle(),
        };
        const buildDictionary = (handle, ownerHandle, entries = []) => {
            const entryLines = entries.map(([name, childHandle]) => `3\n${name}\n350\n${childHandle}`).join('\n');
            return `0\nDICTIONARY\n5\n${handle}\n330\n${ownerHandle}\n100\nAcDbDictionary\n281\n1${entryLines ? `\n${entryLines}` : ''}`;
        };

        lines.push('0\nSECTION\n2\nOBJECTS');
        lines.push(buildDictionary(rootDictionaryHandle, '0', Object.entries(childDictionaryHandles)));
        Object.values(childDictionaryHandles).forEach((childHandle) => {
            lines.push(buildDictionary(childHandle, rootDictionaryHandle));
        });
        lines.push('0\nENDSEC');
    }
    lines.push('0\nEOF');
    return lines.join('\r\n');
};

// Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬ 3D RENDER PANEL Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬
