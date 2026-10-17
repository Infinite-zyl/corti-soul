package local.cortisoul.observer;

import com.google.gson.*;
import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import org.lwjgl.glfw.GLFW;
import org.slf4j.LoggerFactory;
import java.nio.file.*;
import java.io.InputStream;
import java.util.concurrent.*;

public final class CortiObserver implements ClientModInitializer {
    private static volatile JsonObject state;
    private static Path snapshot;
    private static String observer = "", target = "";
    private static boolean showHud = true, showHands = true, keyDown;
    private static boolean reported;

    @Override public void onInitializeClient() {
        try {
            JsonObject cfg = JsonParser.parseString(Files.readString(FabricLoader.getInstance().getConfigDir().resolve("corti-observer.json"))).getAsJsonObject();
            observer = text(cfg, "observer"); target = text(cfg, "target");
            snapshot = Path.of(text(cfg, "snapshotFile"));
            if (!snapshot.isAbsolute() || observer.isBlank() || target.isBlank() || observer.equals(target)) throw new IllegalArgumentException();
            showHud = !cfg.has("showHud") || cfg.get("showHud").getAsBoolean();
            showHands = !cfg.has("showHands") || cfg.get("showHands").getAsBoolean();
            var worker = Executors.newSingleThreadScheduledExecutor(r -> { var thread = new Thread(r, "corti-observer-state"); thread.setDaemon(true); return thread; });
            worker.scheduleWithFixedDelay(CortiObserver::readState, 0, 1, TimeUnit.SECONDS);
        } catch (Exception e) {
            observer = "";
            LoggerFactory.getLogger("corti-observer").warn("Missing or invalid observer configuration; mod inactive.");
        }
    }

    private static void readState() {
        try (InputStream stream = Files.newInputStream(snapshot)) {
            byte[] bytes = stream.readNBytes(32769);
            if (bytes.length > 32768) throw new IllegalArgumentException();
            var value = JsonParser.parseString(new String(bytes, java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
            if (!SnapshotRules.valid(value,observer,target)) throw new IllegalArgumentException();
            state = value; reported = false;
        } catch (Exception e) {
            state = null;
            if (!reported) { reported = true; LoggerFactory.getLogger("corti-observer").info("Observer status unavailable; waiting for the local Minecraft World."); }
        }
    }

    public static boolean isObserver() {
        var mc = Minecraft.getInstance();
        return mc.player != null && !observer.isBlank() && observer.equals(mc.player.getGameProfile().getName()) && mc.player.isSpectator();
    }

    public static AbstractClientPlayer target() {
        var mc = Minecraft.getInstance();
        if (!isObserver() || !showHands || !mc.options.getCameraType().isFirstPerson() || mc.options.hideGui) return null;
        if (mc.getCameraEntity() instanceof AbstractClientPlayer player && player != mc.player && !player.isSpectator() && target.equals(player.getGameProfile().getName())) return player;
        return null;
    }

    public static String text(JsonObject object, String key) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull()) return "";
        try { return object.get(key).getAsString().replaceAll("[\\r\\n§]", " "); } catch (Exception e) { return ""; }
    }
    private static int integer(JsonObject object, String key, int fallback) {
        try { return object.get(key).getAsInt(); } catch (Exception e) { return fallback; }
    }
    private static boolean fresh(JsonObject value) {
        return SnapshotRules.fresh(value,System.currentTimeMillis());
    }
    private static String phase(String phase) {
        return switch (phase) { case "executing" -> "正在执行"; case "sleeping" -> "正在睡觉"; case "held" -> "身体被接管"; case "queued" -> "任务待执行"; case "idle" -> "队列空闲"; default -> "游戏未连接"; };
    }
    private static void line(GuiGraphics g, String value, int x, int y, int width, int color) {
        var font = Minecraft.getInstance().font;
        g.drawString(font, font.plainSubstrByWidth(value, Math.max(1, width)), x, y, color, true);
    }

    public static void render(GuiGraphics graphics) {
        if (!isObserver()) return;
        boolean pressed = InputConstants.isKeyDown(Minecraft.getInstance().getWindow().getWindow(), GLFW.GLFW_KEY_F8);
        if (pressed && !keyDown) showHud = !showHud;
        keyDown = pressed;
        var mc = Minecraft.getInstance();
        if (!showHud || mc.options.hideGui) return;
        var value = state;
        int width = Math.min(300, graphics.guiWidth() - 16), left = 8, top = 8;
        boolean camera = mc.getCameraEntity() instanceof AbstractClientPlayer p && p != mc.player && target.equals(p.getGameProfile().getName());
        String title = target + " · ", action = "等待 World 状态（显示不调用模型）", detail = "F8 切换状态面板 · F1 隐藏界面";
        boolean valid = value != null && fresh(value);
        if (!camera) title += "等待附身";
        else if (!valid) title += "状态更新暂停";
        else {
            title += phase(text(value, "phase"));
            if (value.has("task") && value.get("task").isJsonObject()) {
                var task = value.getAsJsonObject("task");
                action = "任务#" + integer(task,"id",0) + " " + text(task,"label");
                detail = integer(task,"index",0)+"/"+integer(task,"total",0)+" · "+integer(task,"elapsedMs",0)/1000+"s · "+text(task,"step");
            } else if (text(value,"phase").equals("held")) action = text(value,"hold");
            else if (text(value,"phase").equals("sleeping")) action = "游戏内睡觉；这不等于模型休眠";
            else if (text(value,"phase").equals("idle")) action = "暂无执行任务 · 模型是否思考未提供";
            else if (text(value,"phase").equals("offline")) action = "corti 当前没有连接游戏";
            if (!value.get("last").isJsonNull() && !value.get("task").isJsonObject()) {
                var last=value.getAsJsonObject("last"); detail="最近 "+text(last,"kind")+" · "+text(last,"text");
            }
        }
        graphics.fill(left,top,left+width,top+49,0xc0182029);
        line(graphics,title,left+7,top+6,width-14,0xff75e0b6);
        line(graphics,action,left+7,top+21,width-14,0xfff1f5f9);
        line(graphics,detail,left+7,top+35,width-14,0xffc2cdd9);
        if (camera && valid && value.get("online").getAsBoolean()) drawHotbar(graphics,value);
    }

    private static void sprite(GuiGraphics g,String id,int x,int y,int w,int h) {
        g.blitSprite(ResourceLocation.tryParse("minecraft:hud/"+id),x,y,w,h);
    }
    private static double decimal(JsonObject value,String key,double fallback) {
        try { var n=value.get(key).getAsDouble();return Double.isFinite(n)?n:fallback; }catch(Exception e){return fallback;}
    }
    private static void drawHotbar(GuiGraphics g, JsonObject value) {
        var mc=Minecraft.getInstance();int x=(g.guiWidth()-182)/2,y=g.guiHeight()-22,selected=integer(value,"selected",-1);
        com.mojang.blaze3d.systems.RenderSystem.enableBlend();
        sprite(g,"hotbar",x,y,182,22);
        if(selected>=0&&selected<9)sprite(g,"hotbar_selection",x-1+selected*20,y-1,24,23);
        JsonArray bar=value.getAsJsonArray("hotbar");
        for(int i=0;i<Math.min(9,bar.size());i++)drawItem(g,bar.get(i),x+3+i*20,y+3);
        if(value.has("off")&&value.get("off").isJsonObject()) {
            sprite(g,"hotbar_offhand_left",x-29,y-1,29,24);drawItem(g,value.get("off"),x-26,y+3);
        }
        int row=g.guiHeight()-39;
        // Native atlas sprites respect resource packs; missing readings are omitted.
        int health=integer(value,"health",-1),food=integer(value,"food",-1),armor=integer(value,"armor",-1);
        for(int i=0;i<10;i++) {
            if(health>=0){sprite(g,"heart/container",x+i*8,row,9,9);int points=health-i*2;if(points>0)sprite(g,points>=2?"heart/full":"heart/half",x+i*8,row,9,9);}
            if(food>=0){int fx=x+182-i*8-9;sprite(g,"food_empty",fx,row,9,9);int points=food-i*2;if(points>0)sprite(g,points>=2?"food_full":"food_half",fx,row,9,9);}
            if(armor>0){sprite(g,"armor_empty",x+i*8,row-10,9,9);int points=armor-i*2;if(points>0)sprite(g,points>=2?"armor_full":"armor_half",x+i*8,row-10,9,9);}
        }
        if(value.has("experience")&&value.get("experience").isJsonObject()) {
            var xp=value.getAsJsonObject("experience");double progress=decimal(xp,"progress",-1);int level=integer(xp,"level",-1);
            if(progress>=0){sprite(g,"experience_bar_background",x,g.guiHeight()-29,182,5);int fill=Math.min(182,(int)(Math.max(0,progress)*183));if(fill>0)g.blitSprite(ResourceLocation.tryParse("minecraft:hud/experience_bar_progress"),182,5,0,0,x,g.guiHeight()-29,fill,5);}
            if(level>0){String label=Integer.toString(level);int tx=(g.guiWidth()-mc.font.width(label))/2,ty=g.guiHeight()-35;g.drawString(mc.font,label,tx+1,ty,0xff000000,false);g.drawString(mc.font,label,tx-1,ty,0xff000000,false);g.drawString(mc.font,label,tx,ty+1,0xff000000,false);g.drawString(mc.font,label,tx,ty-1,0xff000000,false);g.drawString(mc.font,label,tx,ty,0xff80ff20,false);}
        }
        sprite(g,"crosshair",(g.guiWidth()-15)/2,(g.guiHeight()-15)/2,15,15);
        com.mojang.blaze3d.systems.RenderSystem.disableBlend();
    }
    private static void drawItem(GuiGraphics g, JsonElement value, int x, int y) {
        if (value == null || !value.isJsonObject()) return;
        try {
            var object=value.getAsJsonObject();var id=ResourceLocation.tryParse(text(object,"id"));
            if(id==null || !BuiltInRegistries.ITEM.containsKey(id))return;
            var stack=new ItemStack(BuiltInRegistries.ITEM.get(id),Math.max(1,Math.min(999,integer(object,"count",1))));
            g.renderItem(stack,x,y);g.renderItemDecorations(Minecraft.getInstance().font,stack,x,y);
        } catch (Exception ignored) { }
    }
}
