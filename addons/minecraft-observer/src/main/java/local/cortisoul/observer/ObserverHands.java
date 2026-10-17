package local.cortisoul.observer;
import local.cortisoul.observer.mixin.HandAccessor;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.*;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.Items;
/** Draw only; do not flush caller-owned Iris buffers or mutate equipment. */
public final class ObserverHands {
    public static void draw(ItemInHandRenderer renderer,AbstractClientPlayer player,float delta,PoseStack poses,MultiBufferSource buffers,int light) {
        float swing=player.getAttackAnim(delta),pitch=player.getViewXRot(delta);
        boolean ranged=player.isUsingItem()&&(player.getUseItem().is(Items.BOW)||player.getUseItem().is(Items.CROSSBOW));
        var swinging=player.swingingArm==null?InteractionHand.MAIN_HAND:player.swingingArm;
        for(var hand:InteractionHand.values()) {
            if(ranged&&player.getUsedItemHand()!=hand)continue;
            ((HandAccessor)renderer).cortiArm(player,delta,pitch,hand,swinging==hand?swing:0f,player.getItemInHand(hand),0f,poses,buffers,light);
        }
    }
}
