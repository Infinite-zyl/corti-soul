package local.cortisoul.observer.mixin;
import local.cortisoul.observer.CortiObserver;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.ItemInHandRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
/** Use corti's actual skin for the empty first-person arm as well. */
@Mixin(ItemInHandRenderer.class)
public class HandMixin {
    @ModifyVariable(method="renderPlayerArm",at=@At("STORE"))
    private AbstractClientPlayer cortiArmSkin(AbstractClientPlayer original) { var target=CortiObserver.target();return target==null?original:target; }
}
