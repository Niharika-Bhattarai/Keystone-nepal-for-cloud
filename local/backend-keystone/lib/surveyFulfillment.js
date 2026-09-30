'use strict';
const {SURVEY_FIELDS}=require('./surveyFieldRegistry');
const {surveyCapabilityGaps}=require('./surveyCapabilities');
const {checkSurveyRequirements,validateBedroomBathroomAccess}=require('./surveyRequirements');
const {normalizeBrief,unrecognizedFeatureRequests}=require('./tile/normalizeBrief');
const {roomArea}=require('./planGeometry');
const {isOutdoorType}=require('./tile/canonicalRoomTypes');
const {measureBedroomClosets}=require('./closetGeometry');
const {validateRequestedFeatureRooms}=require('./residential/v2/validators/featureRoomPlacementValidator');

const preferences=new Set(['location','lotContext','materials','indoorOutdoor','naturalLight','budgetTier','hvacSystem','freeformWishes']);
const count=value=>{
  const match=/^(\d+)(?:\s+(?:Beds?|Bedrooms?|Baths?|Bathrooms?|Story|Stories))?$/i.exec(String(value??'').trim());
  return match?Number(match[1]):null;
};
function buildSurveyFulfillment(plan,survey={},brief=normalizeBrief(survey)) {
  const levels=plan?.levels||[],rooms=levels.flatMap(l=>(l.rooms||[]).map(r=>({...r,level:l.level})));
  const bedroom=rooms.filter(r=>['primary_bedroom','bedroom'].includes(r.type));
  const baths=rooms.filter(r=>['primary_bathroom','bathroom'].includes(r.type));
  const bedroomIds=new Set(bedroom.map(r=>r.id));
  const attached=baths.filter(r=>bedroomIds.has(r.attachedTo));
  const refs=items=>items.map(r=>`level:${r.level}/room:${r.id}`);
  const gaps=new Map(surveyCapabilityGaps(survey).map(g=>[g.field,g]));
  const checks=new Map(checkSurveyRequirements(plan,brief).map(c=>[c.field,c]));
  const items=Object.entries(survey).map(([field,requested])=>{
    const item={field,sourceField:field,sourceVersion:survey.surveyVersion??'legacy-unversioned',provenance:'user',
      requested:structuredClone(requested),resolved:null,strength:preferences.has(field)?'preference':'hard',
      status:'not_implemented',evidenceRefs:[],reason:'No independent fulfillment evaluator exists for this field yet.'};
    const satisfy=(ok,resolved,evidence,reason)=>Object.assign(item,{status:ok?'satisfied':'conflict',resolved,evidenceRefs:evidence,reason});
    if(gaps.has(field)) {item.reason=gaps.get(field).message;return item;}
    if(!SURVEY_FIELDS[field]) return item;
    if(requested===null||requested===''||(Array.isArray(requested)&&requested.length===0)) {
      return Object.assign(item,{status:'needs_project_input',reason:'No explicit value was supplied. Defaults are not recorded as user choices.'});
    }
    const spec=SURVEY_FIELDS[field];
    if(spec.type==='choice'&&![...spec.values,...Object.keys(spec.aliases||{})].some(value=>value.toLowerCase()===String(requested).trim().toLowerCase())) {
      item.reason='This legacy choice has no explicit field interpretation. A normalizer fallback is not fulfillment evidence.';
      return item;
    }
    const counts={stories:levels.filter(l=>l.level>=1),bedrooms:bedroom,bathrooms:baths,privateBaths:attached,privateBathCount:attached,
      sharedBathroomCount:baths.filter(r=>!bedroomIds.has(r.attachedTo))};
    if(counts[field]) {
      const measured=counts[field],expected=count(requested);
      if(expected===null) {item.status='conflict';item.reason='The requested count could not be interpreted without changing it.';return item;}
      satisfy(expected===measured.length,measured.length,field==='stories'?measured.map(l=>`level:${l.level}`):refs(measured),
        'Compared the original requested count with actual level/room identities. Room and fixture quality are validated separately.');
      if(['privateBaths','privateBathCount'].includes(field)) {
        const accessErrors=validateBedroomBathroomAccess(plan);
        if(accessErrors.length) {item.status='conflict';item.reason=accessErrors.join(' ');}
      }
    } else if(field==='bedroomConfigs') {
      const accessErrors=validateBedroomBathroomAccess(plan);
      const closets=measureBedroomClosets(plan,survey);
      const measured=requested.map((config,index)=>{
        const programId=index===0?'primary':`bedroom_${index+1}`;
        const matches=bedroom.filter(r=>r.programId===programId),room=matches[0];
        const ownBaths=room?baths.filter(b=>b.attachedTo===room.id):[];
        const expected=config.privateBath===true||config.privateBath==='Yes';
        return {programId,roomId:room?.id??null,privateBath:{requested:expected,actual:ownBaths.length,
          status:matches.length===1&&ownBaths.length===Number(expected)&&!accessErrors.length?'satisfied':'conflict'},
          closet:closets[index]};
      });
      item.resolved=measured;
      item.evidenceRefs=refs(bedroom.concat(attached)).concat(closets.flatMap(c=>c.roomIds.map(id=>`level:${c.level}/room:${id}`)));
      item.status=measured.some(r=>r.privateBath.status==='conflict'||r.closet.status==='conflict')?'conflict'
        :closets.every(c=>c.status==='satisfied')?'satisfied':'needs_project_input';
      item.reason=item.status==='conflict'?'Bedroom bathroom or physical closet geometry/access does not match the selections.':'Measured private bathroom access, closet storage, aisle and owner-only doors against each bedroom selection.';
    } else if(field==='accessibilityNeeds'&&/single-level preferred/i.test(requested)) {
      item.strength='preference';
      item.status='preference_scored';
      item.resolved={preferredStories:1,actualStories:levels.filter(l=>l.level>=1).length,score:levels.filter(l=>l.level>=1).length===1?1:0};
      item.evidenceRefs=levels.map(l=>`level:${l.level}`);
      item.reason='Compared the single-level preference with actual storeys; the explicit storey selection takes precedence.';
    } else if(field==='masterLocation') {
      const expected=/main|level\s*1/i.test(requested)?1:2,primary=bedroom.filter(r=>r.type==='primary_bedroom');
      if(levels.filter(l=>l.level>=1).length===1&&expected===2) {
        item.status='needs_project_input';item.reason='The legacy survey selected an upper primary bedroom for a single-level house; that stale selection requires explicit migration.';
      } else satisfy(primary.length===1&&primary[0].level===expected,primary.map(r=>r.level),refs(primary),'Measured the primary bedroom level.');
    } else if(field==='laundryLocation') {
      if(/no preference/i.test(requested)) {item.status='satisfied';item.resolved='no_level_constraint';item.reason='No laundry-level constraint was requested.';}
      else {const expected=/level\s*2/i.test(requested)?2:1, laundry=rooms.filter(r=>r.type==='laundry');
        satisfy(laundry.length>0&&laundry.every(r=>r.level===expected),laundry.map(r=>r.level),refs(laundry),'Measured the laundry level; proximity/access are separate checks.');}
    } else if(field==='kitchenPlacement'||field==='totalArea'||field==='lotWidth'||field==='lotDepth'||field==='outdoorLiving') {
      const checked=checks.get(field);
      if(checked) {
        const affected=field==='kitchenPlacement'?rooms.filter(r=>r.type==='kitchen'):rooms;
        const resolved=field==='lotWidth'?levels.map(l=>l.width):field==='lotDepth'?levels.map(l=>l.height)
          :field==='totalArea'?rooms.filter(r=>r.type!=='garage'&&!isOutdoorType(r.type)).reduce((sum,r)=>sum+roomArea(r),0)
          :field==='kitchenPlacement'?{frontEdge:plan.facade?.frontEdge,kitchenRoomIds:affected.map(r=>r.id)}
          :{roomIds:rooms.filter(r=>isOutdoorType(r.type)).map(r=>r.id)};
        satisfy(checked.fulfilled,resolved,refs(affected),checked.message);
        item.measurementScope=field.startsWith('lot')?'building_dimensions_only; setbacks and usable site boundary unverified':'current_concept_geometry';
        if(field.startsWith('lot')&&checked.fulfilled) {
          item.status='needs_project_input';
          item.reason='The building dimensions fit the entered lot dimensions; a usable site envelope and setbacks have not been verified.';
        }
      }
    } else if(field==='accessibilityNeeds'&&/^none$/i.test(requested)) {
      satisfy(true,'no_additional_accessibility_request',[],'No additional accessibility requirement selected; this does not certify accessibility.');
    } else if(field==='accessibilityNeeds'&&/wide/i.test(requested)) {
      const doors=levels.flatMap(l=>(l.doors||[]).filter(d=>!d.garageDoor&&!d.openThreshold).map((d,index)=>({level:l.level,index,...d})));
      const checked=checks.get(field);
      item.resolved={nominalWidthsFt:doors.map(d=>d.width)};
      item.evidenceRefs=doors.map(d=>`level:${d.level}/opening:${d.a}:${d.b}@${d.x},${d.y}`);
      item.status=checked&&!checked.fulfilled?'conflict':'needs_project_input';
      item.reason='Nominal door spans are measured; finished clear passages and hardware schedules remain unverified.';
    } else if(field==='ceilingHeight') {
      const profiles=levels.map(l=>l.verticalProfile),expected=/tall|10/.test(String(requested).toLowerCase())?10:9;
      satisfy(profiles.length>0&&profiles.every(p=>p?.clearHeightFt===expected),profiles.map(p=>p?.clearHeightFt??null),
        levels.map(l=>`level:${l.level}/verticalProfile.clearHeightFt`),'Measured the selected flat planning ceiling height; project floor build-ups remain assumptions.');
    } else if(field==='surveyVersion') {
      satisfy(true,requested,['designSurvey.surveyVersion'],'Records serialization provenance, not a design feature.');
    } else if(field==='features'&&/^(none|n\/a)$/i.test(requested)) {
      satisfy(true,[],[],'No additional feature rooms were requested.');
    } else if(field==='features') {
      // Normalize the original selection again, independently of the generated
      // program. Saved plans without identities cannot prove alias ownership.
      const originalBrief=normalizeBrief(survey);
      const requests=originalBrief.requestedFeatureItems;
      const errors=validateRequestedFeatureRooms(plan,originalBrief);
      errors.push(...unrecognizedFeatureRequests(requested).map(chunk=>`Unrecognized feature selection: ${chunk}`));
      const measured=requests.map(request=>({programId:request.programId,kind:request.kind,
        roomIds:rooms.filter(r=>r.programId===request.programId).map(r=>r.id)}));
      const exact=measured.length>0&&measured.every(m=>m.roomIds.length===1);
      const affected=rooms.filter(r=>measured.some(m=>m.roomIds.includes(r.id)));
      if(errors.length) satisfy(false,measured,refs(affected),errors.join(' '));
      else if(exact) satisfy(true,measured,refs(affected),'Verified each requested room identity, count, usable nominal area and placement constraints.');
      else {item.resolved=measured;item.status='needs_project_input';item.reason='Feature identities are absent or the selection cannot be fully interpreted; regenerate to obtain per-room evidence.';}
      item.measurementScope='feature_instances_and_nominal_placement; furnishings and connectivity validated separately; acoustic performance unverified';
    }
    return item;
  });
  const counts=items.reduce((out,item)=>{out[item.status]=(out[item.status]||0)+1;return out;},{});
  const unresolved=items.filter(i=>!['satisfied','preference_scored'].includes(i.status));
  return {...(plan?.surveyFulfillment?.freeformWishes?{freeformWishes:structuredClone(plan.surveyFulfillment.freeformWishes)}:{}),
    version:'survey-evidence-v1',scope:'Incremental concept evidence; incomplete evaluators are explicit, not passes.',items,
    summary:{total:items.length,counts,complete:unresolved.length===0,hardConflicts:items.filter(i=>i.strength==='hard'&&i.status==='conflict').map(i=>i.field),
      unresolvedFields:unresolved.map(i=>i.field)}};
}
module.exports={buildSurveyFulfillment};
