'use strict';
const {createHash}=require('node:crypto');
const {getStairCodeProfile,TICKS_PER_FOOT}=require('./codeProfiles');
const {exactTicks,uniformRiser}=require('./precision');
const {validateFittedLayout}=require('./validateFittedLayout');
const {validateStairAssembly}=require('./validateStairAssembly');

const rect=r=>r?{x:r.x,y:r.y,w:r.w,h:r.h}:null;
const validRect=r=>r&&[r.x,r.y,r.w,r.h].every(Number.isFinite)&&r.w>0&&r.h>0;
const polygon=r=>validRect(r)?[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}]:null;
const finiteOrNull=n=>Number.isFinite(n)?n:null;
const levelId=level=>`level:${level.level}`;
const missingInputs=[
  'project_jurisdiction_and_amendments','finished_floor_and_subfloor_build_ups',
  'finished_enclosure_faces','tread_riser_and_nosing_surfaces','landing_clear_polygons_and_supports',
  'floor_opening_headers_joists_and_soffits','headroom_sweep','handrails_and_guards',
  'structural_material_load_and_connection_verification','coordinated_detail_drawings',
];
function profileFor(plan,level) {
  return level.verticalProfile || plan.verticalModel?.levels?.find(p=>p.level===level.level) || null;
}
function canonical(value) {
  if(Array.isArray(value)) return value.map(canonical);
  if(value&&typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}

// Explicit, deterministic migration. It refits each connection from its own
// rooms/elevations; old flags, assemblies and structural approvals are ignored.
// The returned legacy layout is a compatibility projection only. This is not
// automatically applied to existing production plans until P04/S02 migration.
function migratePlanStairs(plan,{profile}={}) {
  if(!plan||!Array.isArray(plan.levels)) throw new TypeError('A plan with levels is required.');
  const selected=getStairCodeProfile(profile);
  const result=structuredClone(plan);
  const levels=[...result.levels].sort((a,b)=>a.level-b.level);
  if(levels.some(l=>!Number.isSafeInteger(l.level))||new Set(levels.map(levelId)).size!==levels.length) throw new TypeError('Distinct integer level IDs are required.');
  result.stairAssemblies=[];
  for(const level of levels) {
    level.stairAssemblyIds=[];
    if(level.stairCore) delete level.stairCore.layout;
  }
  // Lazy require avoids a cycle when the layout service later adopts assembly
  // generation. The migration never calls itself through that service.
  const {fitStairLayout}=require('../stairLayout');
  for(let i=0;i<levels.length-1;i++) {
    const lower=levels[i],upper=levels[i+1],lc=lower.stairCore,uc=upper.stairCore;
    if(!lc&&!uc) continue;
    const lowerRoom=lower.rooms?.find(r=>r.id===lc?.roomId);
    const upperRoom=upper.rooms?.find(r=>r.id===uc?.roomId);
    const core=rect(lowerRoom);
    const lowerHall=lower.rooms?.find(r=>r.id===(lc?.landingRoomId||lc?.hallRoomId));
    const upperHall=upper.rooms?.find(r=>r.id===(uc?.landingRoomId||uc?.hallRoomId));
    const lowerProfile=profileFor(result,lower),upperProfile=profileFor(result,upper);
    const lowerZ=finiteOrNull(lowerProfile?.floorZFt),upperZ=finiteOrNull(upperProfile?.floorZFt);
    const rise=lowerZ!==null&&upperZ!==null?upperZ-lowerZ:finiteOrNull(lc?.vertical?.riseFt);
    const aligned=validRect(core)&&validRect(upperRoom)&&['x','y','w','h'].every(k=>Math.abs(core[k]-upperRoom[k])<1e-9);
    const layout=aligned&&Number.isFinite(rise)&&rise>0
      ?fitStairLayout({core,lowerHall,upperHall,riseFt:rise,wideDoors:lc?.wideDoorways||uc?.wideDoorways,codeProfile:selected})
      :{valid:false,reason:'Aligned cores and a positive floor rise are required for migration.'};
    const checked=validateFittedLayout(layout,{core,profile:selected});
    const id=`stair:${levelId(lower)}:${levelId(upper)}`;
    const findings=checked.errors.map(message=>({code:'STAIR_GEOMETRY_INVALID',ruleId:null,severity:'error',message}));
    const flights=[],landings=[];
    if(checked.valid&&lowerZ!==null) {
      try {
        exactTicks(lowerZ);
        for(const [index,f] of layout.flights.entries()) {
          const runTicks=exactTicks(Math.hypot(f.to.x-f.from.x,f.to.y-f.from.y));
          flights.push({id:`${id}:flight:${index}`,order:index,risers:f.risers,
            riser:uniformRiser(checked.measurements.riseTicks,layout.risers),
            going:{numeratorTicks:runTicks,denominator:f.risers-1},nominalWidthFt:layout.flightWidthFt,
            widthAboveRailsFt:null,widthBetweenRailsFt:null,runTicks,
            from:{...f.from,z:lowerZ+f.fromZFt},to:{...f.to,z:lowerZ+f.toZFt},reservation:polygon(f.rect),
            // Pitch follows successive nosings: rise/going. Landing-to-landing
            // rise includes one extra riser and would overstate that pitch.
            nosingLine:null,treadSurfaces:null,riserSurfaces:null,slope:layout.riserFt/(runTicks/TICKS_PER_FOOT/(f.risers-1))});
        }
        const reservations=[
          {type:'lower',r:layout.externalLandings?.[0],z:lowerZ,connections:[lowerHall?.id]},
          ...layout.landings.map((r,index)=>({type:index===0?'turn':'connector',r,
            z:lowerZ+(index===0?layout.flights[0].toZFt:0),connections:[]})),
          {type:'upper',r:layout.externalLandings?.[1],z:upperZ,connections:[upperHall?.id]},
        ];
        for(const [index,l] of reservations.entries()) if(validRect(l.r)) landings.push({id:`${id}:landing:${index}`,
          type:l.type,reservation:polygon(l.r),finishedZFt:l.z,clearPolygon:null,widthFt:null,depthFt:null,
          accessConnectionIds:l.connections.filter(Boolean),supportedEdges:null});
      } catch(error) {
        flights.length=0;landings.length=0;
        findings.push({code:'STAIR_PRECISION_UNRESOLVED',ruleId:null,severity:'error',message:error.message});
      }
    }
    if(lowerZ===null||upperZ===null) findings.push({code:'STAIR_ELEVATIONS_MISSING',ruleId:null,severity:'unverified',message:'Absolute floor datums are missing; no absolute stair surfaces can be derived.'});
    const geometryHash=createHash('sha256').update(JSON.stringify(canonical({
      fromLevelId:levelId(lower),toLevelId:levelId(upper),profile:selected,core,upperCore:rect(upperRoom),
      lowerHall,upperHall,lowerProfile,upperProfile,rise,wideDoors:Boolean(lc?.wideDoorways||uc?.wideDoorways),
    }))).digest('hex');
    const assembly={id,schemaVersion:1,fromLevelId:levelId(lower),toLevelId:levelId(upper),codeProfileId:selected.id,
      geometryHash,assemblyFamilyId:null,geometryBasis:'legacy_nominal_recomputed',
      elevations:{coordinateFrame:'building_feet',lowerFinishedFloorZFt:lowerZ,upperFinishedFloorZFt:upperZ,
        lowerSubfloorZFt:null,upperSubfloorZFt:null,totalRiseTicks:checked.measurements?.riseTicks??null,
        floorBuildUps:null,treadFinishThicknessFt:null,riserFinishThicknessFt:null,
        source:lowerZ!==null&&upperZ!==null?'legacy_planning_assumption':'missing'},
      core:{roughReservation:polygon(core),finishedEnclosure:null,floorOpening:checked.valid?polygon(core):null,
        floorOpeningStatus:checked.valid?'assumed_full_core':'missing',obstructionVolumes:null,clearanceEnvelope:null},
      flights,landings,guards:null,handrails:null,
      structure:{members:null,connections:null,materialInputs:null,loadInputs:null,status:'unverified'},
      validation:{status:findings.some(f=>f.severity==='error')?'invalid':'incomplete',findings,unverifiedInputs:[...missingInputs]},drawings:null};
    const contract=validateStairAssembly(assembly,{profile:selected});
    if(!contract.valid) throw new Error(`Stair migration contract failed: ${contract.errors.join('; ')}`);
    result.stairAssemblies.push(assembly);
    lower.stairAssemblyIds.push(id);upper.stairAssemblyIds.push(id);
    if(lc) lc.layout=structuredClone(layout);
    // On a middle floor prefer its outgoing connection as the legacy single
    // layout. Both true connections remain in stairAssemblies and level refs.
    if(uc&&!uc.layout) uc.layout=structuredClone(layout);
  }
  if(result.stairCore) result.stairCore=levels.filter(l=>l.stairCore).map(l=>({level:l.level,...l.stairCore}));
  return result;
}
module.exports={migratePlanStairs};
