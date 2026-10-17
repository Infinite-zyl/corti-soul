package local.cortisoul.observer.mixin;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.*;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;
@Mixin(ItemInHandRenderer.class)
public interface HandAccessor {
    @Invoker("renderArmWithItem")
    void cortiArm(AbstractClientPlayer player,float delta,float pitch,InteractionHand hand,float swing,ItemStack item,float equip,PoseStack poses,MultiBufferSource buffers,int light);
}
