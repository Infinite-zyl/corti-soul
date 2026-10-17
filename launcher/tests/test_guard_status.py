import sys,unittest
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from guard_status import fallback_usage

class GuardStatusTests(unittest.TestCase):
    now=datetime(2026,10,17,7,tzinfo=timezone.utc)
    def test_actual_counter_and_limit_not_legacy(self):
        state={'day':'2026-10-17','paidSwitches':0,'fallbackSwitches':4}
        self.assertEqual(fallback_usage(state,{'maxPaidSwitchesPerDay':0,'maxFallbackSwitchesPerDay':12},self.now)['switches'],0)
        self.assertEqual(fallback_usage(state,{'maxPaidSwitchesPerDay':0},self.now)['maxSwitches'],0)
        state['paidSwitches']=3
        self.assertEqual(fallback_usage(state,{},self.now)['switches'],3)
    def test_shanghai_midnight_resets_only_old_day(self):
        now=datetime(2026,10,16,16,tzinfo=timezone.utc)
        self.assertEqual(fallback_usage({'day':'2026-10-16','paidSwitches':9},{},now)['switches'],0)
        self.assertEqual(fallback_usage({'day':'2026-10-17','paidSwitches':2},{},now)['switches'],2)
    def test_missing_or_corrupt_is_unknown(self):
        for state in [{},{'day':'broken','paidSwitches':4},{'day':'2026-10-17','paidSwitches':True},{'day':'2026-10-18','paidSwitches':4}]:
            self.assertIsNone(fallback_usage(state,{},self.now)['switches'])
