/** 实际gotoGoal开门通行；假身体/路径，不连接服务器。 */
import assert from 'node:assert/strict';import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';
const root=resolve(process.env.CORTICO_ROOT??resolve(import.meta.dirname,'../../../../cortico-qq')),require=createRequire(join(root,'package.json'));
const {Vec3}=require('vec3'),{goals}=require('mineflayer-pathfinder');
const load=(f:string)=>import(pathToFileURL(join(root,'src/worlds/minecraft',f)).href);
const {gotoGoal}=await load('travel.ts'),{installHomeEntry}=await load('home-entry.ts');
const home={name:'家',dimension:'minecraft:overworld',returnAt:[0,64,2],entrance:{at:[0,64,0],inside:[0,64,1],outside:[0,64,-1],kind:'oak_door'}};
let opened=false,clicks=0;const moves:number[][]=[];
const bot={entity:{position:new Vec3(0,64,2)},game:{dimension:home.dimension},pathfinder:{goto:async(g:{x:number;y:number;z:number})=>{moves.push([g.x,g.y,g.z]);bot.entity.position=new Vec3(g.x,g.y,g.z);}},blockAt:()=>({name:'oak_door',getProperties:()=>({open:opened})}),activateBlock:async()=>{clicks++;opened=true;}};
installHomeEntry(bot,()=>home);const ctx={aborted:()=>false,taskId:1};
await gotoGoal(bot,new goals.GoalNear(0,64,-20,2),ctx);assert.deepEqual(moves.slice(0,2),[[0,64,1],[0,64,-1]]);assert.equal(clicks,1);
moves.length=0;await gotoGoal(bot,new goals.GoalNear(0,64,2,2),ctx);assert.deepEqual(moves.slice(0,2),[[0,64,-1],[0,64,1]]);assert.equal(clicks,1);
bot.entity.position=new Vec3(0,64,2);bot.blockAt=()=>null;
await assert.rejects(gotoGoal(bot,new goals.GoalNear(0,64,-20,2),ctx),/家门未加载/);assert.equal(clicks,1);
console.log('实际gotoGoal：出门、进门、已开门不点击、门失效受阻通过，无拆墙/TP/模型。');
