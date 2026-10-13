import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HomeBook, canonicalFacility } from '../src/home.ts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mc-home-'));
  const file = join(dir, 'home.json'); const blocks = new Map();
  for (const x of [1, 4]) {
    blocks.set(`${x},64,1`, { name: 'red_bed', properties: { facing: 'south', part: 'foot', occupied: false } });
    blocks.set(`${x},64,2`, { name: 'red_bed', properties: { facing: 'south', part: 'head', occupied: false } });
  }
  blocks.set('7,64,1', { name: 'chest', properties: {} });
  const observer = { dimension: 'overworld', position: [0,64,0], playerPosition: [2,64,0],
    read: (p) => blocks.get(p.join(',')) ?? null,
    candidates: () => [...blocks.keys()].map((k) => k.split(',').map(Number)), };
  const input = { name: '村庄的家', confirmation: '用户确认：左边归她，右边归我，箱子共享',
    facilities: [{ at: [1,64,1], role: 'own-bed' }, { at: [4,64,2], role: 'user-bed' }, { at: [7,64,1], role: 'shared-storage' }] };
  return { dir, file, blocks, observer, input, book: new HomeBook(file) };
}
function withFixture(name, fn) {
  test(name, () => { const f = fixture(); try { fn(f); } finally { rmSync(f.dir, { recursive: true, force: true }); } });
}
withFixture('相邻床头尾合并但不擅自归属；survey无写入无世界改动', (f) => {
  const before = JSON.stringify([...f.blocks]);
  const survey = f.book.survey(f.observer);
  assert.equal(survey.facilities.length, 3); assert.equal(survey.centerSource, 'Infinite');
  assert.ok(survey.facilities.every((x) => !('role' in x)));
  assert.equal(JSON.stringify([...f.blocks]), before); assert.throws(() => readFileSync(f.file));
});
withFixture('玩家不在附近使用自己的位置，并写明调查中心', (f) => {
  f.observer.playerPosition = [100,64,0];
  assert.equal(f.book.survey(f.observer).centerSource, 'corti');
});
withFixture('保存两张床与共享设施，重建可读且存档不会串用', (f) => {
  const saved = f.book.save('uuid:a', f.input, f.observer);
  assert.deepEqual(saved.facilities[0].at, [1,64,2]);
  const next = new HomeBook(f.file);
  assert.equal(next.get('uuid:a').name, '村庄的家'); assert.equal(next.get('uuid:b'), null);
  assert.match(next.summary('uuid:a'), /历史登记/);
});
withFixture('同一床不能同时分配给两人', (f) => {
  f.input.facilities[1].at = [1,64,2];
  assert.throws(() => f.book.save('a',f.input,f.observer), /重复分配/);
});
withFixture('床被占用、拆掉、未加载与离线分别返回真实状态', (f) => {
  f.book.save('a', f.input, f.observer);
  f.blocks.get('1,64,2').properties.occupied = true;
  assert.equal(f.book.query('a', f.observer).facilities[0].status, 'occupied');
  f.blocks.set('1,64,2', { name:'air',properties:{} });
  assert.equal(f.book.query('a', f.observer).facilities[0].status, 'invalid');
  f.blocks.delete('1,64,2');
  assert.equal(f.book.query('a', f.observer).facilities[0].status, 'unloaded');
  assert.equal(f.book.query('a', null).facilities[1].status, 'unloaded');
  assert.equal(f.book.query('a', {...f.observer,dimension:'the_nether'}).facilities[1].status,'unloaded');
});
withFixture('部分床未加载不能登记或声称已失效', (f) => {
  f.blocks.delete('1,64,1');
  assert.throws(() => canonicalFacility([1,64,2],f.observer), /尚未加载/);
});
withFixture('多个候选必须明确自己床，确认说明不得为空', (f) => {
  assert.throws(() => f.book.save('a',{...f.input,confirmation:''},f.observer), /确认说明/);
  assert.throws(() => f.book.save('a',{...f.input,facilities:[{at:[7,64,1],role:'shared-storage'}]},f.observer), /自己的床/);
});
withFixture('更新失败不损坏旧档案；已登记家不能自动覆盖', (f) => {
  f.book.save('a',f.input,f.observer); const before = readFileSync(f.file,'utf8');
  assert.throws(() => f.book.save('a',{...f.input,name:'新家'},f.observer), /已有家/);
  assert.throws(() => f.book.save('a',{...f.input,replace:true,facilities:[{at:[7,64,1],role:'own-bed'}]},f.observer), /不匹配/);
  assert.equal(readFileSync(f.file,'utf8'), before);
  f.book.save('a',{...f.input,replace:true,name:'更新的家'},f.observer);
  assert.equal(f.book.get('a').name,'更新的家');
});
withFixture('损坏文件不让启动失败；查询明确报错且保存不覆盖原文件', (f) => {
  writeFileSync(f.file,'{broken'); const book = new HomeBook(f.file);
  assert.match(book.summary('a'),/档案损坏/);
  assert.throws(() => book.query('a',f.observer),/档案损坏/);
  assert.throws(() => book.save('a',f.input,f.observer),/档案损坏/);
  assert.equal(readFileSync(f.file,'utf8'),'{broken');
});
withFixture('撤销只删登记，不改床或其他存档', (f) => {
  f.book.save('a',f.input,f.observer); f.book.save('b',f.input,f.observer);
  const before = JSON.stringify([...f.blocks]);
  f.book.remove('a','用户明确撤销');
  assert.equal(f.book.get('a'),null); assert.ok(f.book.get('b'));
  assert.equal(JSON.stringify([...f.blocks]),before);
});
test('未配置持久数据目录时不冒充保存成功', () => {
  const f=fixture();try{assert.throws(()=>new HomeBook(null).save('a',f.input,f.observer), /数据目录/);}finally{rmSync(f.dir,{recursive:true,force:true});}
});
