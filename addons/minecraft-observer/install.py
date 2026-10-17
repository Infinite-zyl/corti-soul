"""SPDX-License-Identifier: MIT. Install only our camera mod/config with recoverable backups."""
import argparse,json,os,shutil,hashlib,zipfile
from pathlib import Path
from datetime import datetime

MOD_ID='corti_observer'
def mod_id(file):
    with zipfile.ZipFile(file) as archive:
        return json.loads(archive.read('fabric.mod.json'))['id']

def install(repo, runtime, jar, apply=False):
    cfg=json.loads((runtime/'deployments/mybot/config.json').read_text(encoding='utf-8-sig'))['worlds']['minecraft']
    client=cfg['client'];game=Path(client['gameDir']).resolve()
    version=client.get('versionId','')
    if not game.is_dir() or 'fabric' not in version or '1.20.6' not in version:raise ValueError('观察者必须使用已配置的 Fabric 1.20.6 实例')
    profile=game/'versions'/version/(version+'.json')
    if not profile.is_file():raise ValueError('Fabric 实例描述缺失')
    if mod_id(jar)!=MOD_ID:raise ValueError('不是本功能的mod')
    observer=client.get('username') or 'CortiCam';target=cfg.get('username') or 'corti'
    if observer==target:raise ValueError('观察者与bot账号不能相同')
    settings={'observer':observer,'target':target,'snapshotFile':str((runtime/'deployments/mybot/data/minecraft-observer-hud.json').resolve()),'showHud':True,'showHands':True}
    mods=game/'mods';config=game/'config/corti-observer.json';dest=mods/jar.name
    if config.is_file():
        try:previous=json.loads(config.read_text(encoding='utf8'))
        except (ValueError,OSError):raise ValueError('原HUD配置损坏，保留原文；请先检查配置')
        for key in ['showHud','showHands']:
            if type(previous.get(key)) is bool:settings[key]=previous[key]
    existing=list(mods.glob('corti-observer-*.jar'))
    for file in existing:
        if file.resolve().parent!=mods.resolve() or mod_id(file)!=MOD_ID:raise ValueError('同名mod归属不明，保留原文件')
    data=json.dumps(settings,ensure_ascii=False,indent=2)+'\n'
    digest=hashlib.sha256(jar.read_bytes()).hexdigest()
    if len(existing)==1 and existing[0]==dest and hashlib.sha256(dest.read_bytes()).hexdigest()==digest and config.is_file() and config.read_text(encoding='utf8')==data:
        return {'changed':False,'sha256':digest}
    if not apply:return {'changed':True,'planned':True,'observer':observer,'target':target,'sha256':digest}
    backup=repo/'backups'/('observer-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f'));backup.mkdir(parents=True)
    for file in existing:shutil.copy2(file,backup/file.name)
    original=config.read_bytes() if config.exists() else None
    if original is not None:(backup/'corti-observer.json').write_bytes(original)
    mods.mkdir(parents=True,exist_ok=True);config.parent.mkdir(parents=True,exist_ok=True)
    temporary=mods/(jar.name+'.install.tmp');settings_temp=config.with_suffix('.json.install.tmp')
    try:
        shutil.copy2(jar,temporary);settings_temp.write_text(data,encoding='utf8')
        for file in existing:
            if file!=dest:file.unlink()
        os.replace(temporary,dest);os.replace(settings_temp,config)
    except Exception:
        for file in existing:
            try:shutil.copy2(backup/file.name,file)
            except OSError:pass
        if dest not in existing:dest.unlink(missing_ok=True)
        if original is not None:config.write_bytes(original)
        else:config.unlink(missing_ok=True)
        raise
    finally:temporary.unlink(missing_ok=True);settings_temp.unlink(missing_ok=True)
    return {'changed':True,'sha256':digest,'observer':observer,'target':target,'backup':str(backup)}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    repo=Path(__file__).resolve().parents[2]
    runtime=Path(json.loads((repo/'runtime-selection.json').read_text(encoding='utf8'))['corticoRoot'])
    jar=Path(__file__).parent/'build/libs/corti-observer-1.1.0.jar'
    print(json.dumps(install(repo,runtime,jar,args.apply),ensure_ascii=False))
