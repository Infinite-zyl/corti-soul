import json,zipfile,tempfile,unittest,sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from install import install,MOD_ID

def makejar(file,identity=MOD_ID):
    file.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(file,'w')as archive:archive.writestr('fabric.mod.json',json.dumps({'id':identity}))

class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.repo=Path(self.temp.name);self.runtime=self.repo/'runtime';self.game=self.repo/'game'
        version='fabric-loader-0.16.14-1.20.6';profile=self.game/'versions'/version/(version+'.json');profile.parent.mkdir(parents=True);profile.write_text('{}')
        self.config=self.runtime/'deployments/mybot/config.json';self.config.parent.mkdir(parents=True)
        self.config.write_text(json.dumps({'worlds':{'minecraft':{'username':'corti','client':{'gameDir':str(self.game),'versionId':version}}}}))
        self.jar=self.repo/'build/corti-observer-1.0.0.jar';makejar(self.jar)
    def tearDown(self):self.temp.cleanup()
    def test_dry_run_and_repeat_install_preserve_hud_preference(self):
        self.assertTrue(install(self.repo,self.runtime,self.jar)['planned']);self.assertFalse((self.game/'mods').exists())
        self.assertTrue(install(self.repo,self.runtime,self.jar,True)['changed']);self.assertFalse(install(self.repo,self.runtime,self.jar,True)['changed'])
        file=self.game/'config/corti-observer.json';cfg=json.loads(file.read_text());cfg['showHud']=False;file.write_text(json.dumps(cfg))
        install(self.repo,self.runtime,self.jar,True);self.assertFalse(json.loads(file.read_text())['showHud'])
        self.assertEqual(len(list((self.game/'mods').glob('*.jar'))),1)
    def test_unowned_same_named_mod_and_corrupt_config_are_preserved(self):
        old=self.game/'mods/corti-observer-old.jar';makejar(old,'other')
        with self.assertRaises(ValueError):install(self.repo,self.runtime,self.jar,True)
        self.assertTrue(old.exists());old.unlink()
        file=self.game/'config/corti-observer.json';file.parent.mkdir();file.write_text('broken')
        with self.assertRaises(ValueError):install(self.repo,self.runtime,self.jar,True)
        self.assertEqual(file.read_text(),'broken')
    def test_failed_config_replace_restores_original_jar_and_config(self):
        old=self.game/'mods/corti-observer-0.9.0.jar';makejar(old);before=old.read_bytes()
        file=self.game/'config/corti-observer.json';file.parent.mkdir();file.write_text('{"showHud":false}');cfg=file.read_bytes()
        import install as module
        original=module.os.replace
        def replace(src,dst):
            if Path(dst)==file:raise OSError('simulated sharing violation')
            return original(src,dst)
        with patch.object(module.os,'replace',replace):
            with self.assertRaises(OSError):install(self.repo,self.runtime,self.jar,True)
        self.assertEqual(old.read_bytes(),before);self.assertEqual(file.read_bytes(),cfg)
        self.assertFalse((self.game/'mods'/self.jar.name).exists())
    def test_wrong_game_version_rejected_without_modification(self):
        cfg=json.loads(self.config.read_text());cfg['worlds']['minecraft']['client']['versionId']='1.20.6';self.config.write_text(json.dumps(cfg))
        with self.assertRaises(ValueError):install(self.repo,self.runtime,self.jar,True)
        self.assertFalse((self.game/'mods').exists())
