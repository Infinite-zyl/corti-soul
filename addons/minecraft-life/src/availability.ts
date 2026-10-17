/** Read-only checks of the existing main provider's guard cooldown. No network probes. */
import {readFileSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
export function providerPause(dataDir:string|undefined,guardFile:string,now=Date.now()):boolean {
 if(!dataDir)return true;
 try {
  const config=JSON.parse(readFileSync(join(dirname(dataDir),'config.json'),'utf8'));
  // Optional explicit budget sleep shares the deployment's existing data boundary.
  const sleep=join(dataDir,'minecraft-budget-sleep.json');
  if(existsSync(sleep)){const s=JSON.parse(readFileSync(sleep,'utf8'));if(s.paused===true&&(s.until===null||Number(s.until)>now))return true;}
  if(!existsSync(guardFile))return false;
  const state=JSON.parse(readFileSync(guardFile,'utf8'));
  return (state.lanes?.[config.activeProvider]?.blockedUntil??0)>now;
 }catch{return true;}
}
