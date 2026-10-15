import test from 'node:test';import assert from 'node:assert/strict';import {caveStepCost,tuneSurfaceTravel} from '../src/surface-route.ts';
test('普通寻路不挖、保留下一格台阶，重复热改不叠加成本函数',()=>{
 const b={entity:{position:{y:120}},pathfinder:{goal:{y:120}}},m={canDig:true,maxDropDown:4,exclusionAreasStep:[]};
 tuneSurfaceTravel(b,m);tuneSurfaceTravel(b,m);assert.equal(m.canDig,false);assert.equal(m.maxDropDown,2);assert.equal(m.exclusionAreasStep.length,1);
 assert.ok(m.exclusionAreasStep[0]({position:{y:110},skyLight:0})>0);b.pathfinder.goal.y=70;assert.equal(m.exclusionAreasStep[0]({position:{y:110},skyLight:0}),0);
 b.pathfinder.goal.y=120;m.canDig=true;assert.equal(m.exclusionAreasStep[0]({position:{y:110},skyLight:0}),0);
});
test('只偏好避开已知阴暗低处；屋内、树荫、未知亮度和明确下矿目标不误判',()=>{
 assert.ok(caveStepCost(110,0,120,120)>0);assert.equal(caveStepCost(120,0,120,120),0);
 assert.equal(caveStepCost(110,12,120,120),0);assert.equal(caveStepCost(110,undefined,120,120),0);assert.equal(caveStepCost(110,0,120,64),0);
});
