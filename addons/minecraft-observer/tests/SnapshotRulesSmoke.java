import com.google.gson.*;
import local.cortisoul.observer.SnapshotRules;
public class SnapshotRulesSmoke {
    static void require(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args){
        JsonObject s=JsonParser.parseString("{\"version\":1,\"at\":1000,\"observer\":\"Cam\",\"target\":\"corti\",\"online\":true,\"phase\":\"idle\",\"task\":null,\"last\":null,\"hotbar\":[]}").getAsJsonObject();
        require(SnapshotRules.valid(s,"Cam","corti"));require(!SnapshotRules.valid(s,"Other","corti"));
        require(SnapshotRules.fresh(s,1000));require(SnapshotRules.fresh(s,6000));require(!SnapshotRules.fresh(s,6001));require(!SnapshotRules.fresh(s,999));
        var invalid=s.deepCopy();invalid.remove("task");require(!SnapshotRules.valid(invalid,"Cam","corti"));
        invalid=s.deepCopy();invalid.addProperty("online","yes");require(!SnapshotRules.valid(invalid,"Cam","corti"));
        invalid=s.deepCopy();invalid.addProperty("phase","thinking");require(!SnapshotRules.valid(invalid,"Cam","corti"));
        invalid=s.deepCopy();invalid.add("last",new JsonArray());require(!SnapshotRules.valid(invalid,"Cam","corti"));
        invalid=s.deepCopy();invalid.addProperty("hotbar","not-array");require(!SnapshotRules.valid(invalid,"Cam","corti"));
        System.out.println("Snapshot schema and stale-state checks passed (11 assertions)");
    }
}
