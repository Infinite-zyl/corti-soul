import os,sys,unittest,uuid,subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from single_instance import SingleInstance

@unittest.skipUnless(os.name=='nt','Windows native mutex')
class SingleInstanceTests(unittest.TestCase):
    def test_second_handle_is_rejected_and_owner_can_release(self):
        name='Local\\corti-soul-test-'+uuid.uuid4().hex
        first=SingleInstance('test',name,False);second=SingleInstance('test',name,False)
        try:
            self.assertTrue(first.acquire());self.assertFalse(second.acquire())
            first.close();self.assertTrue(second.acquire())
        finally:first.close();second.close()

    def test_process_exit_releases_kernel_handle(self):
        name='Local\\corti-soul-test-'+uuid.uuid4().hex
        module=str(Path(__file__).resolve().parents[1])
        code="import sys,time;sys.path.insert(0,sys.argv[1]);from single_instance import SingleInstance;s=SingleInstance('test',sys.argv[2],False);print(s.acquire(),flush=True);time.sleep(20)"
        child=subprocess.Popen([sys._base_executable,'-c',code,module,name],stdout=subprocess.PIPE,text=True,creationflags=0x08000000)
        contender=SingleInstance('test',name,False)
        try:
            self.assertEqual(child.stdout.readline().strip(),'True')
            self.assertFalse(contender.acquire())
            child.terminate();child.wait(timeout=5)
            self.assertTrue(contender.acquire())
        finally:
            contender.close()
            if child.poll() is None:child.terminate();child.wait(timeout=5)
            child.stdout.close()

    def test_legacy_window_rejection_releases_new_lock(self):
        name='Local\\corti-soul-test-'+uuid.uuid4().hex
        candidate=SingleInstance('legacy',name,True)
        candidate.focus_existing=lambda:True
        following=SingleInstance('test',name,False)
        try:
            self.assertFalse(candidate.acquire());self.assertIsNone(candidate.handle)
            self.assertTrue(following.acquire())
        finally:candidate.close();following.close()
