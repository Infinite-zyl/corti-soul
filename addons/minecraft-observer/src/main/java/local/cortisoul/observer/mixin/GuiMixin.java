package local.cortisoul.observer.mixin;
import local.cortisoul.observer.CortiObserver;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiGraphics;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
@Mixin(Gui.class)
public class GuiMixin {
    @Inject(method="render",at=@At("TAIL"))
    private void cortiHud(GuiGraphics graphics, float delta, CallbackInfo ci) { CortiObserver.render(graphics); }
}
