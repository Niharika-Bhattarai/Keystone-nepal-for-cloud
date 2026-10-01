'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');
const {buildNepalDxf}=require('../lib/nepal/dxfExport');
const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
const hasEzdxf=spawnSync(python,['-c','import ezdxf'],{encoding:'utf8'}).status===0;

test('AutoCAD export: valid R2010 DXF in mm with every drawing layer populated',{skip:!hasEzdxf&&'ezdxf not installed (pip install -r requirements.txt)'},()=>{
  const brief=normalizeBrief(require('./fixtures/nepal/rental-3_5.json')).brief;
  const r=searchConcepts(brief,{provisionalSetbacksMm:[1000,1000,1000,1000],workingCoverageLimit:0.7,maxCandidates:1});
  const v=r.parkingProgramVariant,c=v.candidates[0];
  const {dxf,payload}=buildNepalDxf(c,v.brief);
  assert.match(dxf,/AC1024/);// R2010
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'ks-dxf-')),'plan.dxf');fs.writeFileSync(file,dxf);
  const check=spawnSync(python,['-c',`
import ezdxf,json,collections,sys
doc=ezdxf.readfile(sys.argv[1]);a=doc.audit()
c=collections.Counter(e.dxf.layer for e in doc.modelspace())
print(json.dumps({'errors':len(a.errors),'insunits':doc.header['$INSUNITS'],'layers':c,
 'texts':[e.dxf.text for e in doc.modelspace().query('TEXT')]}))`,file],{encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
  const out=JSON.parse(check.stdout);
  assert.equal(out.errors,0);assert.equal(out.insunits,4);
  for(const layer of ['A-WALL','A-DOOR','A-GLAZ','A-FURN','P-FIXT','P-SANR-PIPE','P-SANR-DRAN','S-GRID','S-COLS','S-BEAM',
    'A-ANNO-DIMS','A-ANNO-TAGS','A-AREA-IDEN','A-ROOF','C-PROP'])assert.ok(out.layers[layer]>0,layer);
  // Wall segments: every solid wall box of every level is drawn once.
  const walls=c.levels.reduce((n,l)=>n+(l.walls?.walls||[]).reduce((m,w)=>m+w.solidBoxes.length,0),0);
  assert.equal(out.layers['A-WALL'],walls);
  assert.ok(out.texts.includes('FOR REVIEW ONLY - NOT FOR CONSTRUCTION OR PERMIT'));
  assert.ok(out.texts.includes('OPEN BIKE PARKING'));
  assert.equal(payload.units,'mm');
});
