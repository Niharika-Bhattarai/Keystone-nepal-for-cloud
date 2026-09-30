'use strict';
const {rect,areaSqM}=require('./areaLedger');
const {COLUMN_WIDTH_MM,INTERIOR_WALL_MM}=require('./constructionProfile');
// Owner's preferred planning range, not a Nepal code span limit or member design.
const PREFERRED_MIN_BAY_SPAN_MM=3048; // 10 ft
const MAX_PLANNING_BAY_SPAN_MM=4267; // floor(14 ft = 4267.2 mm)
function frameGrid(footprint,{targetSpanMm=3500,columnWidthMm=COLUMN_WIDTH_MM,
  protectedCorridor=null,protectedCore=null,partitionLinesMm=[],rowAxisTargetsMm=null,
  engineerReviewed=false}={}) {
  const slabs=footprint.slabs.map(rect);
  const x1=Math.min(...slabs.map(b=>b.x1)),x2=Math.max(...slabs.map(b=>b.x2));
  const y1=Math.min(...slabs.map(b=>b.y1)),y2=Math.max(...slabs.map(b=>b.y2));
  if (!Number.isSafeInteger(targetSpanMm)||targetSpanMm<2500||
    targetSpanMm>MAX_PLANNING_BAY_SPAN_MM)
    throw new Error('An explicit, plausible planning span is needed');
  if (!Number.isSafeInteger(columnWidthMm)||columnWidthMm<200)
    throw new Error('Column envelope must be explicit');
  const axis=(start,end)=>{const spans=Math.ceil((end-start)/targetSpanMm);
    return Array.from({length:spans+1},(_,i)=>Math.round(start+(end-start)*i/spans));};
  const half=columnWidthMm/2;
  const c=protectedCorridor?rect(protectedCorridor):null;
  const stair=protectedCore?rect(protectedCore):null;
  const coreAtWest=stair&&stair.x1===x1,coreAtEast=stair&&stair.x2===x2;
  // Use the two actual stair-bay column lines as structural anchors. A
  // corridor may still be reserved, but it must not create an extra row of
  // columns through habitable rooms on every level.
  const anchorX=coreAtWest?[x1+half,stair.x2-half,x2-half]:
    coreAtEast?[x1+half,stair.x1+half,x2-half]:
      c?[x1+half,c.x1-half,c.x2+half,x2-half]:null;
  if(anchorX&&anchorX.some((n,i)=>i>0&&n<=anchorX[i-1]))
    throw new Error('Planning columns cannot flank the clear corridor');
  const x=anchorX?anchorX.flatMap((value,i)=>{
    if(!i)return [value];
    const prior=anchorX[i-1],gap=value-prior;
    return gap>MAX_PLANNING_BAY_SPAN_MM?axis(prior,value).slice(1):[value];
  }):axis(x1+half,x2-half);
  const yAnchors=stair?[y1+half,stair.y1+half,stair.y2-half,y2-half]
    .filter((n,i,all)=>i===0||n>all[i-1]):null;
  if(stair&&(stair.y1<y1||stair.y2>y2||stair.y2-stair.y1-columnWidthMm>
    MAX_PLANNING_BAY_SPAN_MM))throw new Error('Dedicated stair bay exceeds its planning span');
  const y=yAnchors?yAnchors.flatMap((value,i)=>{
    if(!i)return [value];
    const prior=yAnchors[i-1],gap=value-prior;
    return gap>MAX_PLANNING_BAY_SPAN_MM?axis(prior,value).slice(1):[value];
  }):axis(y1+half,y2-half);
  const fixedRows=new Set(stair?y.map((value,i)=>
    [stair.y1+half,stair.y2-half].includes(value)?i:-1).filter(i=>i>0&&i<y.length-1):[]);
  if(rowAxisTargetsMm){
    if(!Array.isArray(rowAxisTargetsMm)||rowAxisTargetsMm.length!==y.length-2||
      !rowAxisTargetsMm.every(Number.isSafeInteger))
      throw new Error('One measured target is required for each interior grid row');
    for(let i=1;i<y.length-1;i++)if(!fixedRows.has(i))y[i]=rowAxisTargetsMm[i-1];
  }
  // Shift interior row axes away from partition-wall cores. A partition can
  // end at a column face, but it should not run through the column middle.
  const clearance=half+INTERIOR_WALL_MM/2;
  const partitionLines=[...new Set(partitionLinesMm.filter(n=>Number.isSafeInteger(n)&&
    n>y1+columnWidthMm&&n<y2-columnWidthMm))];
  for(let i=1;i<y.length-1;i++){
    if(fixedRows.has(i))continue;
    const original=y[i],choices=new Set([original]);
    for(const line of partitionLines){choices.add(Math.round(line-clearance));
      choices.add(Math.round(line+clearance));}
    for(let shift=-500;shift<=500;shift+=25)choices.add(original+shift);
    const ranked=[...choices].filter(n=>n>y[i-1]+500&&n<y[i+1]-500&&
      n-y[i-1]<=MAX_PLANNING_BAY_SPAN_MM&&y[i+1]-n<=MAX_PLANNING_BAY_SPAN_MM)
      .map(n=>({n,conflicts:partitionLines.filter(line=>Math.abs(n-line)<clearance).length,
        displacement:Math.abs(n-original)}))
      .sort((a,b)=>a.conflicts-b.conflicts||a.displacement-b.displacement||a.n-b.n);
    if(ranked.length)y[i]=ranked[0].n;
  }
  const spans=axes=>axes.slice(1).map((n,i)=>n-axes[i]);
  const xSpansMm=spans(x),ySpansMm=spans(y);
  const maxAdjacentAxisSpanMm=Math.max(...xSpansMm,...ySpansMm);
  if(maxAdjacentAxisSpanMm>MAX_PLANNING_BAY_SPAN_MM)
    throw new Error('Planning grid exceeds the 14 ft owner bay preference');
  const columns=[];
  for(let i=0;i<x.length;i++)for(let j=0;j<y.length;j++){
    const box=rect([Math.floor(x[i]-half),Math.floor(y[j]-half),
      Math.ceil(x[i]+half),Math.ceil(y[j]+half)]);
    if(areaSqM([box],slabs)<=1e-9) columns.push({id:`C-${i+1}-${j+1}`,
      xMm:x[i],yMm:y[j],widthMm:columnWidthMm});
  }
  return {xAxesMm:x,yAxesMm:y,columns,columnWidthMm,engineerReviewed,
    xSpansMm,ySpansMm,maxAdjacentAxisSpanMm,
    preferredSpanRangeMm:[PREFERRED_MIN_BAY_SPAN_MM,MAX_PLANNING_BAY_SPAN_MM],
    spanStatus:'adjacent_planning_axes_only_not_engineered_beams',
    status:engineerReviewed?'planning_grid_reviewed':'planning_reservation_only',
    protectedCorridor:c,protectedCore:stair,
    fixedRowAxisIndices:[...fixedRows],
    warnings:['Some short bays follow from the narrow stair/corridor geometry; the 10 ft lower preference is not guaranteed.',
      'Member sizing, actual beam continuity at footprint voids, infill interaction, seismic analysis and foundation design require the structural engineer.']};
}
module.exports={frameGrid,PREFERRED_MIN_BAY_SPAN_MM,MAX_PLANNING_BAY_SPAN_MM};
