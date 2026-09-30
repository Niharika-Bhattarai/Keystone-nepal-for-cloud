'use strict';

const { partListOf } = require('./planGeometry');
const { normalizeRoomType } = require('./tile/canonicalRoomTypes');
const EPS = 1e-6;
// Preserve solid wall at jambs and between independent openings (feet).
const JAMB = 0.5;
const GAP = 0.5;

function inside(room, x, y) {
  return partListOf(room).some(p => x > p.x && x < p.x2 && y > p.y && y < p.y2);
}

// Split at every part boundary before classifying each interval. This removes
// internal seams of composite rooms and respects re-entrant exterior walls.
function boundarySegments(room, rooms = [room], exteriorOnly = false) {
  const parts = partListOf(room);
  const allParts = rooms.flatMap(partListOf);
  const segments = [];
  for (const p of parts) {
    for (const [dir, fixed, lo, hi] of [
      ['horizontal', p.y, p.x, p.x2], ['horizontal', p.y2, p.x, p.x2],
      ['vertical', p.x, p.y, p.y2], ['vertical', p.x2, p.y, p.y2],
    ]) {
      const cuts = [...new Set([lo, hi, ...allParts.flatMap(q => dir === 'horizontal' ? [q.x, q.x2] : [q.y, q.y2])])]
        .filter(n => n >= lo && n <= hi).sort((a,b) => a-b);
      for (let i=1; i<cuts.length; i++) {
        const start=cuts[i-1], end=cuts[i], mid=(start+end)/2;
        if (end-start <= EPS) continue;
        const x=dir==='horizontal'?mid:fixed, y=dir==='horizontal'?fixed:mid;
        const dx=dir==='vertical'?EPS:0, dy=dir==='horizontal'?EPS:0;
        const minus=inside(room,x-dx,y-dy), plus=inside(room,x+dx,y+dy);
        if (minus===plus) continue;
        const side=plus?1:-1;
        if (exteriorOnly && rooms.some(other => other !== room && inside(other,x-side*dx,y-side*dy))) continue;
        segments.push({dir,fixed,start,end,side});
      }
    }
  }
  segments.sort((a,b)=>a.dir.localeCompare(b.dir)||a.fixed-b.fixed||a.side-b.side||a.start-b.start);
  const merged=[];
  for(const s of segments){
    const prev=merged.at(-1);
    if(prev && prev.dir===s.dir && Math.abs(prev.fixed-s.fixed)<EPS && prev.side===s.side && s.start<=prev.end+EPS) prev.end=Math.max(prev.end,s.end);
    else merged.push({...s});
  }
  return merged;
}

function geometryCache(level) {
  const boundary = new Map(), exterior = new Map();
  return { segments(room, external = false) {
    const cache = external ? exterior : boundary;
    if (!cache.has(room)) cache.set(room, boundarySegments(room, external ? level.rooms : [room], external));
    return cache.get(room);
  } };
}

function hostSegments(level, opening, kind = 'door', cache = geometryCache(level)) {
  const rooms=level.rooms||[];
  const a=rooms.find(r=>String(r.id)===String(opening.a || opening.roomId));
  if(kind==='window') return (a?[a]:rooms).flatMap(r=>cache.segments(r,true).map(s=>({...s,roomId:String(r.id)})));
  if(!a) return [];
  if(opening.b==='__exterior__') return cache.segments(a,true);
  const b=rooms.find(r=>String(r.id)===String(opening.b));
  if(!b) return [];
  const result=[];
  for(const sa of cache.segments(a)) for(const sb of cache.segments(b)) {
    if(sa.dir!==sb.dir || Math.abs(sa.fixed-sb.fixed)>EPS || sa.side===sb.side) continue;
    const start=Math.max(sa.start,sb.start), end=Math.min(sa.end,sb.end);
    if(end-start>EPS) result.push({...sa,start,end});
  }
  return result;
}

function openingSpan(o, kind='door') {
  const width=Number(o.width ?? (kind==='window' ? o.windowWidth : o.doorWidth) ?? (kind==='window'?4:3));
  const vertical=o.dir==='vertical';
  const center=Number(vertical?o.y:o.x);
  return {dir:o.dir,fixed:Number(vertical?o.x:o.y),start:center-width/2,end:center+width/2,width};
}

function overlaps(a,b,gap=0) {
  return a.dir===b.dir && Math.abs(a.fixed-b.fixed)<EPS && Math.min(a.end,b.end)-Math.max(a.start,b.start)>-gap+EPS;
}

function fitOpening(level, opening, kind, occupied, cache) {
  const original=openingSpan(opening,kind);
  const jamb=opening.openThreshold ? 0 : JAMB;
  if(!Number.isFinite(original.width)||original.width<=0) return null;
  const candidates=[];
  for(const host of hostSegments(level,opening,kind,cache)) {
    // A door may slide along its actual wall; it must never move to another side
    // of a stair or room without changing the circulation model upstream.
    if(host.dir!==original.dir || Math.abs(host.fixed-original.fixed)>EPS) continue;
    let intervals=[[host.start+jamb+original.width/2,host.end-jamb-original.width/2]];
    for(const used of occupied){
      if(used.dir!==host.dir || Math.abs(used.fixed-host.fixed)>EPS)continue;
      const low=used.start-GAP-original.width/2, high=used.end+GAP+original.width/2;
      intervals=intervals.flatMap(([lo,hi])=>high<=lo || low>=hi?[[lo,hi]]:[[lo,Math.min(hi,low)],[Math.max(lo,high),hi]])
        .filter(([lo,hi])=>hi>=lo-EPS);
    }
    for(const [lo,hi] of intervals){
      if(hi<lo-EPS)continue;
      const target=(original.start+original.end)/2;
      const center=Math.max(lo,Math.min(hi,target));
      candidates.push({host,center,distance:Math.abs(center-target)});
    }
  }
  candidates.sort((a,b)=>a.distance-b.distance);
  if(!candidates.length)return null;
  const {host,center}=candidates[0];
  return {...opening,width:original.width,x:host.dir==='vertical'?host.fixed:center,y:host.dir==='vertical'?center:host.fixed,...(kind==='window'?{roomId:host.roomId}:{})};
}

function finalizeOpenings(level, doors, windows) {
  const cache = geometryCache(level);
  const occupied=[], placedDoors=[], placedWindows=[];
  for(const d of doors){
    const fitted=fitOpening(level,d,'door',occupied,cache);
    if(fitted){placedDoors.push(fitted);occupied.push(openingSpan(fitted));}
  }
  for(const w of windows){
    const fitted=fitOpening(level,w,'window',occupied,cache);
    if(fitted){placedWindows.push(fitted);occupied.push(openingSpan(fitted,'window'));}
  }
  // Privacy may reduce glazing, but must not erase a bedroom's only exterior
  // opening. Product-specific clear opening/sill checks remain separate.
  for(const room of level.rooms||[]){
    if(!['bedroom','primary_bedroom','guest_bedroom'].includes(normalizeRoomType(room.type)))continue;
    if(placedWindows.some(w=>String(w.roomId)===String(room.id)))continue;
    for(const host of [...cache.segments(room,true)].sort((a,b)=>(b.end-b.start)-(a.end-a.start))){
      const center=(host.start+host.end)/2;
      const fitted=fitOpening(level,{roomId:String(room.id),dir:host.dir,x:host.dir==='vertical'?host.fixed:center,y:host.dir==='vertical'?center:host.fixed,width:4},'window',occupied,cache);
      if(fitted){placedWindows.push(fitted);occupied.push(openingSpan(fitted,'window'));break;}
    }
  }
  level.doors=placedDoors; level.windows=placedWindows;
  return level;
}

function validateOpeningGeometry(level) {
  const cache = geometryCache(level);
  const errors=[], occupied=[];
  for(const [kind,items] of [['door',level.doors||[]],['window',level.windows||[]]]){
    for(const [i,o] of items.entries()){
      const span=openingSpan(o,kind), label=`${kind} ${i+1} on level ${level.level}`;
      if(!['horizontal','vertical'].includes(o.dir)||![span.fixed,span.start,span.end,span.width].every(Number.isFinite)||span.width<=0){errors.push(`Invalid opening geometry: ${label}`);continue;}
      const hosts=hostSegments(level,o,kind,cache);
      const jamb=o.openThreshold ? 0 : JAMB;
      if(!hosts.some(h=>h.dir===span.dir && Math.abs(h.fixed-span.fixed)<EPS && span.start>=h.start+jamb-EPS && span.end<=h.end-jamb+EPS)) errors.push(`Opening exceeds its wall or jamb clearance: ${label}`);
      for(const prev of occupied)if(overlaps(span,prev.span))errors.push(`Opening overlap: ${prev.label} and ${label}`);
      occupied.push({span,label});
    }
  }
  return errors;
}

module.exports={boundarySegments,hostSegments,openingSpan,overlaps,fitOpening,finalizeOpenings,validateOpeningGeometry};
