package local.cortisoul.observer.mixin;
import local.cortisoul.observer.CortiObserver;
import local.cortisoul.observer.ObserverHands;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.renderer.*;
import com.mojang.blaze3d.vertex.PoseStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
/** Shared vanilla/Iris entry; preserve the caller's shader buffer and render phase. */
@Mixin(ItemInHandRenderer.class)
public class HandMixin {
    @Inject(method="renderHandsWithItems",at=@At("HEAD"),cancellable=true)
    private void cortiShaderHands(float delta,PoseStack poses,MultiBufferSource.BufferSource buffers,LocalPlayer local,int light,CallbackInfo ci) {
        var target=CortiObserver.target();if(target==null)return;
        ObserverHands.draw((ItemInHandRenderer)(Object)this,target,delta,poses,buffers,light);
        ci.cancel();
    }
    @ModifyVariable(method="renderPlayerArm",at=@At("STORE"))
    private AbstractClientPlayer cortiArmSkin(AbstractClientPlayer original) { var target=CortiObserver.target();return target==null?original:target; }
}
