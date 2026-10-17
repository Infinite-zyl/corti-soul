package local.cortisoul.observer.mixin;
import com.llamalad7.mixinextras.sugar.Local;
import com.mojang.blaze3d.vertex.PoseStack;
import local.cortisoul.observer.CortiObserver;
import net.minecraft.client.Camera;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.*;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.Items;
import org.joml.Matrix4f;
import org.spongepowered.asm.mixin.*;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** SpectatorPlus 1.20.6 rendering hook, scoped to the configured camera and target. */
@Mixin(GameRenderer.class)
public class GameRendererMixin {
    @Shadow @Final private LightTexture lightTexture;
    @Shadow @Final private RenderBuffers renderBuffers;
    @Shadow @Final public ItemInHandRenderer itemInHandRenderer;
    @Inject(method="renderItemInHand(Lnet/minecraft/client/Camera;FLorg/joml/Matrix4f;)V",at=@At(value="INVOKE",target="Lorg/joml/Matrix4fStack;popMatrix()Lorg/joml/Matrix4fStack;",remap=false))
    private void cortiHands(Camera camera,float delta,Matrix4f projection,CallbackInfo ci,@Local PoseStack poses) {
        var player=CortiObserver.target();if(player==null)return;
        var mc=Minecraft.getInstance();var buffers=renderBuffers.bufferSource();
        int light=mc.getEntityRenderDispatcher().getPackedLightCoords(player,delta);
        float swing=player.getAttackAnim(delta),pitch=player.getViewXRot(delta);
        boolean ranged=player.isUsingItem()&&(player.getUseItem().is(Items.BOW)||player.getUseItem().is(Items.CROSSBOW));
        lightTexture.turnOnLightLayer();
        try {
            for(var hand:InteractionHand.values()) {
                if(ranged&&player.getUsedItemHand()!=hand)continue;
                float attack=player.swingingArm==hand?swing:0f;
                ((HandAccessor)itemInHandRenderer).cortiArm(player,delta,pitch,hand,attack,player.getItemInHand(hand),0f,poses,buffers,light);
            }
            buffers.endBatch();
        } finally { lightTexture.turnOffLightLayer(); }
    }
}
