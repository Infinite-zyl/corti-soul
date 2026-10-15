import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {routingMode,assertAutoRouting} from '../guard/routing-mode.mjs';
test('自动模式保留写操作，手动与损坏文件只允许只读',()=>{
 const dir=mkdtempSync(join(tmpdir(),'routing-mode-'));try{const file=join(dir,'mode.json');assert.equal(routingMode(file),'auto');assert.doesNotThrow(()=>assertAutoRouting('POST',file));
 writeFileSync(file,JSON.stringify({version:1,mode:'manual',provider:'example'}));for(const method of ['POST','PUT','PATCH','DELETE'])assert.throws(()=>assertAutoRouting(method,file),/手动/);assert.doesNotThrow(()=>assertAutoRouting('GET',file));
 writeFileSync(file,'{broken');assert.equal(routingMode(file),'manual');assert.throws(()=>assertAutoRouting('POST',file));
 writeFileSync(file,JSON.stringify({version:1,mode:'auto'}));assert.doesNotThrow(()=>assertAutoRouting('POST',file));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
