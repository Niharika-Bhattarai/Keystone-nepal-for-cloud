'use strict';

// Conservative IRC 2021 residential planning baseline, not jurisdiction approval.
// R311.7: <=7.75 in risers, >=10 in treads, >=36 in clear width/landings.
// Flights use a single exact riser height and an explicit intermediate landing.
const {getStairCodeProfile,ruleFeet,PRODUCT_DEFAULTS}=require('./stairs/codeProfiles');
function limitsFor(profile) {
  return {maxRiserFt:ruleFeet('maxRiser',profile),minTreadFt:ruleFeet('minGoing',profile),
    minWidthFt:ruleFeet('minWidthAboveRails',profile),minHeadroomFt:ruleFeet('minHeadroom',profile),
    maxFlightRiseFt:ruleFeet('maxFlightRise',profile)};
}
const LIMITS = Object.freeze(limitsFor(getStairCodeProfile()));
const EPS = 1e-6;
const rect = (x,y,w,h) => ({x,y,w,h});
const center = r => ({x:r.x+r.w/2,y:r.y+r.h/2});

function sideOf(core, hall) {
  if (!hall) return null;
  if (Math.abs(core.y - hall.y - hall.h) < EPS) return 'top';
  if (Math.abs(core.y + core.h - hall.y) < EPS) return 'bottom';
  if (Math.abs(core.x - hall.x - hall.w) < EPS) return 'left';
  if (Math.abs(core.x + core.w - hall.x) < EPS) return 'right';
  return null;
}

function frame(core, upperSide) {
  const swap = ['left','right'].includes(upperSide);
  const w = swap ? core.h : core.w, h = swap ? core.w : core.h;
  const point = ({x,y}) => upperSide === 'bottom' ? {x:core.x+core.w-x,y:core.y+core.h-y}
    : upperSide === 'left' ? {x:core.x+y,y:core.y+core.h-x}
    : upperSide === 'right' ? {x:core.x+core.w-y,y:core.y+x}
    : {x:core.x+x,y:core.y+y};
  const box = r => {
    const a=point(r), b=point({x:r.x+r.w,y:r.y+r.h});
    return rect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(a.x-b.x),Math.abs(a.y-b.y));
  };
  return {w,h,point,box};
}

function contains(container, r) {
  if (!container) return false;
  const parts = container.parts?.length ? container.parts : [container];
  // Check the union, not a composite hall's bounding box: a landing cannot
  // occupy the missing corner of an L-shaped circulation room.
  const xs = [...new Set([r.x,r.x+r.w,...parts.flatMap(p=>[p.x,p.x+p.w])])].filter(x=>x>=r.x-EPS&&x<=r.x+r.w+EPS).sort((a,b)=>a-b);
  const ys = [...new Set([r.y,r.y+r.h,...parts.flatMap(p=>[p.y,p.y+p.h])])].filter(y=>y>=r.y-EPS&&y<=r.y+r.h+EPS).sort((a,b)=>a-b);
  return xs.slice(1).every((x,i)=>ys.slice(1).every((y,j)=> {
    const cx=(xs[i]+x)/2,cy=(ys[j]+y)/2;
    return parts.some(p=>cx>=p.x-EPS&&cy>=p.y-EPS&&cx<=p.x+p.w+EPS&&cy<=p.y+p.h+EPS);
  }));
}

function fitStairLayout({core,lowerHall,upperHall,riseFt,wideDoors=false,codeProfile}) {
  const profile=getStairCodeProfile(codeProfile),limits=limitsFor(profile);
  if(!core||![core.x,core.y,core.w,core.h,riseFt].every(Number.isFinite)||core.w<=0||core.h<=0) return {valid:false,reason:'Finite positive core dimensions and rise are required.'};
  if(riseFt>2*limits.maxFlightRiseFt) return {valid:false,reason:'This fitter supports at most two flights; the requested rise needs another landing/flight.'};
  const upperSide=sideOf(core,upperHall), lowerSide=sideOf(core,lowerHall);
  if (!upperSide || !lowerSide || !(riseFt>0)) return {valid:false,reason:'Stairs need adjacent lower and upper circulation landings and a positive floor rise.'};
  const axes=frame(core,upperSide), {w,h}=axes;
  const lowerPoint=axes.point({x:w,y:h/2});
  const rightSide=Math.abs(lowerPoint.x-core.x)<EPS?'left':Math.abs(lowerPoint.x-core.x-core.w)<EPS?'right':Math.abs(lowerPoint.y-core.y)<EPS?'top':'bottom';
  const opposite={top:'bottom',bottom:'top',left:'right',right:'left'};
  const sideEntry=lowerSide!==upperSide && lowerSide!==opposite[upperSide];
  const reflect=sideEntry && lowerSide!==rightSide;
  const point = p => axes.point(reflect ? {x:w-p.x,y:p.y} : p);
  const box = r => axes.box(reflect ? {...r,x:w-r.x-r.w} : r);
  const openingWidth=wideDoors?4:3;
  const minRisers=Math.ceil(riseFt/limits.maxRiserFt);
  const widths=(wideDoors?[4]:[3.5,3]).filter(width=>width>=limits.minWidthFt);
  const goings=[...new Set([Math.max(PRODUCT_DEFAULTS.preferredGoingIn/12,limits.minTreadFt),limits.minTreadFt])];
  for (const width of widths) for(let risers=minRisers;risers<=Math.max(minRisers,Math.ceil(riseFt/.5));risers++) {
    const riserFt=riseFt/risers;
    for(let offset=.5;offset+width<=w-.5+EPS;offset+=.5) {
      const upperLanding=box(rect(offset,-width,width,width));
      if (!contains(upperHall,upperLanding)) continue;
      if (lowerSide===opposite[upperSide]) {
        const treadFt=h/(risers-1);
        const lowerLanding=box(rect(offset,h,width,width));
        if(riseFt>limits.maxFlightRiseFt || treadFt<limits.minTreadFt || treadFt>1.2 || !contains(lowerHall,lowerLanding)) continue;
        return finish('straight',[{rect:rect(offset,0,width,h),from:{x:offset+width/2,y:h},to:{x:offset+width/2,y:0},risers}],[],
          {x:offset+width/2,y:h},{x:offset+width/2,y:0},[lowerLanding,upperLanding],treadFt);
      }
      // Return flights suit a lower entry beside the *top* of the core.
      // Reserve a real central guard gap; two flights never share the same
      // three-foot strip or overlap a landing in the drawing.
      if (offset===.5 && w>=2*width+1-EPS && (sideEntry || lowerSide===upperSide)) {
        const left=.25,right=w-.25-width;
        const upperPad=box(rect(left,-width,width,width));
        for(const treadFt of goings) for(let lowerRisers=2;lowerRisers<risers-1;lowerRisers++) {
          const upperRisers=risers-lowerRisers,upperRun=(upperRisers-1)*treadFt,lowerRun=(lowerRisers-1)*treadFt;
          if(treadFt<limits.minTreadFt || Math.max(lowerRisers,upperRisers)*riserFt>limits.maxFlightRiseFt) continue;
          const groundDepth=upperRun-lowerRun;
          if(groundDepth<width-EPS || upperRun+width>h-.25+EPS || !contains(upperHall,upperPad)) continue;
          const lower=sideEntry?{x:w,y:width/2}:{x:right+width/2,y:0};
          const lowerPad=box(sideEntry?rect(w,0,width,width):rect(right,-width,width,width));
          if(!contains(lowerHall,lowerPad)) continue;
          return finish('switchback',[
            {rect:rect(right,groundDepth,width,lowerRun),from:{x:right+width/2,y:groundDepth},to:{x:right+width/2,y:upperRun},risers:lowerRisers},
            {rect:rect(left,0,width,upperRun),from:{x:left+width/2,y:upperRun},to:{x:left+width/2,y:0},risers:upperRisers},
          ],[rect(left,upperRun,w-.5,width),rect(right,0,w-right,groundDepth)],lower,{x:left+width/2,y:0},[lowerPad,upperPad],treadFt);
        }
      }
      if (!sideEntry) continue;
      for (const treadFt of goings) for(let lowerRisers=2;lowerRisers<risers-1;lowerRisers++) {
        const upperRisers=risers-lowerRisers, longRun=(upperRisers-1)*treadFt, shortRun=(lowerRisers-1)*treadFt;
        if(treadFt<limits.minTreadFt || Math.max(lowerRisers,upperRisers)*riserFt>limits.maxFlightRiseFt) continue;
        if(longRun+width>h-.5+EPS || offset+width+shortRun>w+EPS) continue;
        const cy=longRun+width/2, cx=offset+width/2;
        const lowerLanding=box(rect(w,cy-width/2,width,width));
        if(!contains(lowerHall,lowerLanding)) continue;
        const turn=rect(offset,longRun,width,width);
        const entryPad=rect(offset+width+shortRun,longRun,w-offset-width-shortRun,width);
        return finish('quarter-turn',[
          {rect:rect(offset+width,longRun,shortRun,width),from:{x:offset+width+shortRun,y:cy},to:{x:offset+width,y:cy},risers:lowerRisers},
          {rect:rect(offset,0,width,longRun),from:{x:cx,y:longRun},to:{x:cx,y:0},risers:upperRisers},
        ],[turn,...(entryPad.w>EPS?[entryPad]:[])],{x:w,y:cy},{x:cx,y:0},[lowerLanding,upperLanding],treadFt);
      }
      function finish(kind,flights,landings,lower,upper,externalLandings,treadFt) {
        let z=0;
        const fitted=flights.map(f=>{const fromZFt=z;z+=f.risers*riserFt;return {...f,rect:box(f.rect),from:point(f.from),to:point(f.to),fromZFt,toZFt:z};});
        const path=[point(lower)];
        fitted.forEach((flight,index)=>{
          path.push(flight.from,flight.to);
          if(index<fitted.length-1 && landings[0]) {
            const turn=center(box(landings[0]));
            path.push(turn);
          }
        });
        path.push(point(upper));
        return {valid:true,codeProfileId:profile.id,kind,riseFt,risers,riserFt,treadFt,flightWidthFt:width,openingWidthFt:openingWidth,
          flights:fitted,landings:landings.map(box),externalLandings,path,
          lowerEndpoint:{...point(lower),side:lowerSide},upperEndpoint:{...point(upper),side:upperSide},
          floorOpening:{...core},headroomStrategy:'full-core floor opening',minimumHeadroomFt:limits.minHeadroomFt};
      }
    }
  }
  return {valid:false,reason:`No fitted stair connects these landings within ${core.w} × ${core.h} ft for a ${riseFt} ft rise.`};
}

function applyStairLayouts(plan) {
  const levels=[...(plan.levels||[])].sort((a,b)=>a.level-b.level);
  for(let i=0;i<levels.length-1;i++) {
    const lower=levels[i],upper=levels[i+1],lc=lower.stairCore,uc=upper.stairCore;
    if(!lc || !uc || !lc.vertical) continue;
    const lr=lower.rooms.find(r=>r.id===lc.roomId),ur=upper.rooms.find(r=>r.id===uc.roomId);
    if(!lr || !ur) continue;
    if(['x','y','w','h'].some(key=>Math.abs(lr[key]-ur[key])>EPS)) {
      lc.layout=uc.layout={valid:false,reason:'Lower and upper stair cores must align before a flight can connect them.'};
      continue;
    }
    const core=rect(lr.x,lr.y,lr.w,lr.h);
    let lowerHall=lower.rooms.find(r=>r.id===(lc.landingRoomId||lc.hallRoomId));
    const upperHall=upper.rooms.find(r=>r.id===(uc.landingRoomId||uc.hallRoomId));
    let layout=fitStairLayout({core,lowerHall,upperHall,riseFt:lc.vertical.riseFt,wideDoors:lc.wideDoorways||uc.wideDoorways});
    if(!layout.valid) for(const hall of lower.rooms.filter(r=>['entry','hallway'].includes(r.type)&&r.id!==lowerHall?.id)) {
      const alternative=fitStairLayout({core,lowerHall:hall,upperHall,riseFt:lc.vertical.riseFt,wideDoors:lc.wideDoorways||uc.wideDoorways});
      if(alternative.valid) {layout=alternative;lowerHall=hall;lc.landingRoomId=hall.id;lc.hallRoomId=hall.id;break;}
    }
    lc.layout=layout;uc.layout=layout;
    if(!layout.valid) continue;
    lc.vertical={...lc.vertical,stepCount:layout.risers,riserFt:layout.riserFt,treadFt:layout.treadFt,
      runFt:layout.flights.reduce((sum,f)=>sum+(f.risers-1)*layout.treadFt,0)};
    for(const profile of [lower.verticalProfile,...(plan.verticalModel?.levels||[]).filter(p=>p.level===lower.level)]) {
      if(profile) Object.assign(profile,{stairSteps:layout.risers,stairRiserFt:layout.riserFt,stairTreadFt:layout.treadFt,stairRunFt:lc.vertical.runFt});
    }
    for(const [level,stair,endpoint] of [[lower,lc,layout.lowerEndpoint],[upper,uc,layout.upperEndpoint]]) {
      const door=(level.doors||[]).find(d=>d.a===stair.roomId||d.b===stair.roomId);
      if(door) Object.assign(door,{a:stair.roomId,b:stair.landingRoomId||stair.hallRoomId,x:endpoint.x,y:endpoint.y,width:layout.openingWidthFt,dir:['top','bottom'].includes(endpoint.side)?'horizontal':'vertical',openThreshold:true,stairEndpoint:true});
    }
  }
  if(plan.stairCore) plan.stairCore=levels.filter(l=>l.stairCore).map(l=>({level:l.level,...l.stairCore}));
  return plan;
}

module.exports={LIMITS,fitStairLayout,applyStairLayouts};
