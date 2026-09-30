'use strict';
const assert=require('node:assert/strict');
const {fitStairLayout}=require('../../lib/stairLayout');
function openingPlan(door, window, vertical = false) {
  const room = {id:'a',type:'living_room',x:0,y:0,w:20,h:20,
    heightMeta:{doorHeadHeightFt:8,windowSillHeightFt:2.25,windowHeadHeightFt:8.25}};
  return {levels:[{level:1,width:20,height:20,rooms:[room],
    doors:door?[{id:'door',a:'a',b:'__exterior__',x:vertical?0:10,y:vertical?10:0,dir:vertical?'vertical':'horizontal',width:8,...door}]:[],
    windows:window?[{roomId:'a',x:vertical?0:10,y:vertical?10:0,dir:vertical?'vertical':'horizontal',width:6,...window}]:[]}]};
}

function stairPlan(kind='quarter-turn', upper=2) {
  const core={id:'s',type:'stairs',x:10,y:10,w:7,h:kind==='switchback'?12:14};
  const lower=kind==='straight'?{id:'lo',type:'hallway',x:10,y:24,w:7,h:5}:{id:'lo',type:'hallway',x:17,y:10,w:5,h:kind==='switchback'?4:14};
  const high={id:'hi',type:'hallway',x:10,y:5,w:7,h:5};
  const layout=fitStairLayout({core,lowerHall:lower,upperHall:high,riseFt:10});
  assert.equal(layout.valid,true);assert.equal(layout.kind,kind);
  return {levels:[1,upper].map(level=>({level,width:32,height:32,rooms:structuredClone([core,lower,high]),stairCore:{roomId:'s',layout:structuredClone(layout)}})),
    verticalModel:{levels:[{level:1,floorZFt:0,clearHeightFt:9,floorToFloorFt:10,structureThicknessFt:1},{level:upper,floorZFt:10,clearHeightFt:9,floorToFloorFt:10,structureThicknessFt:1}]}};
}
module.exports={openingPlan,stairPlan};
