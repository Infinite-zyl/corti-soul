package local.cortisoul.observer;
import com.google.gson.*;
import java.util.Set;
/** Schema checks are deliberately independent of the game renderer. */
public final class SnapshotRules {
    public static boolean valid(JsonObject value,String observer,String target) {
        try {
            if(!value.get("version").getAsJsonPrimitive().isNumber() || value.get("version").getAsInt()!=1)return false;
            if(!observer.equals(value.get("observer").getAsString())||!target.equals(value.get("target").getAsString()))return false;
            if(!value.get("at").getAsJsonPrimitive().isNumber()||!Double.isFinite(value.get("at").getAsDouble()))return false;
            if(!value.get("online").getAsJsonPrimitive().isBoolean())return false;
            if(!Set.of("offline","idle","executing","held","sleeping","queued").contains(value.get("phase").getAsString()))return false;
            if(!value.has("task")||(!value.get("task").isJsonNull()&&!value.get("task").isJsonObject()))return false;
            if(!value.has("last")||(!value.get("last").isJsonNull()&&!value.get("last").isJsonObject()))return false;
            return value.get("hotbar").isJsonArray()&&value.getAsJsonArray("hotbar").size()<=9;
        } catch(Exception e) {return false;}
    }
    public static boolean fresh(JsonObject value,long now) {
        try {long age=now-value.get("at").getAsLong();return age>=0&&age<=5000;}catch(Exception e){return false;}
    }
}
