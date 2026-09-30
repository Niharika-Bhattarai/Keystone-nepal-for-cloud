'use strict';
// Reproducible offline review sheets from the two current residential fixtures.
const fs=require('node:fs');
const path=require('node:path');
const backend=path.join(__dirname,'..','backend-keystone');
const {normalizeBrief}=require(path.join(backend,'lib/nepal/normalizeBrief'));
const {buildReviewCase,renderReviewDocument}=require(path.join(backend,'lib/nepal/reviewSheet'));
const fixtures=[['2.5-storey owner home','rectangle-2_5.json'],
  ['3.5-storey two-rental-floor home','rental-3_5.json']];
const cases=fixtures.map(([label,file])=>{
  const raw=require(path.join(backend,'test/fixtures/nepal',file));
  const normalized=normalizeBrief(raw);
  if(normalized.missing.length||normalized.invalid.length||normalized.unsupported.length)
    throw new Error(`${file} is not a valid Nepal brief`);
  return buildReviewCase(label,normalized.brief);
});
const dir=path.join(__dirname,'..','runtime','nepal-plan-review');
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'index.html'),renderReviewDocument(cases));
fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(cases.map(item=>({
  label:item.label,assumptions:item.assumptions,
  candidates:item.result.candidates.map(c=>({id:c.id,geometryHash:c.geometryHash,
    ledger:c.ledger,grid:{xAxesMm:c.grid.xAxesMm,yAxesMm:c.grid.yAxesMm,
      xSpansMm:c.grid.xSpansMm,ySpansMm:c.grid.ySpansMm,
      maxAdjacentAxisSpanMm:c.grid.maxAdjacentAxisSpanMm,
      roomCellExceptions:c.validation.blockers.filter(b=>b.code==='MAIN_ROOM_GRID_CELL_NOT_MET')},
    stair:c.core.flights[0]&&{
      risers:c.core.flights[0].risers,riserMm:c.core.flights[0].riserMm,
      treadMm:c.core.flights[0].treadMm,requiredLengthMm:c.core.flights[0].requiredLengthMm},
    tank:c.core.reservoir,
    residentialDetails:c.levels.map(level=>({levelId:level.id,...level.residentialDetails,
      rooms:level.rooms?.rooms.map(room=>({roomId:room.id,finishIntent:room.finishIntent,
        furnishingIntent:room.furnishingIntent}))||[]})),
    blockers:c.validation.blockers})),
  rejected:item.result.attempts.filter(a=>a.status==='rejected')
})),null,2));
console.log(path.join(dir,'index.html'));
