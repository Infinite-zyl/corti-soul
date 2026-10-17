package local.cortisoul.observer.mixin;
import local.cortisoul.observer.CortiObserver;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.level.GameType;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import org.spongepowered.asm.mixin.*;
import org.spongepowered.asm.mixin.injection.*;

/** Iris 1.7.2 runtime selectors, checked against the installed jar's bytecode. */
@Pseudo
@Mixin(targets="net.irisshaders.iris.pathways.HandRenderer",remap=false)
public class IrisHandMixin {
    @Redirect(method="canRender",at=@At(value="INVOKE",target="Lnet/minecraft/class_636;method_2920()Lnet/minecraft/class_1934;",remap=false),remap=false,require=0)
    private GameType cortiRenderPermission(MultiPlayerGameMode mode) { return CortiObserver.target()!=null?GameType.SURVIVAL:mode.getPlayerMode(); }
    @Redirect(method="isHandTranslucent",at=@At(value="INVOKE",target="Lnet/minecraft/class_746;method_6118(Lnet/minecraft/class_1304;)Lnet/minecraft/class_1799;",remap=false),remap=false,require=0)
    private ItemStack cortiHandMaterial(LocalPlayer player,EquipmentSlot slot) { var target=CortiObserver.target();return target==null?player.getItemBySlot(slot):target.getItemBySlot(slot); }
}
