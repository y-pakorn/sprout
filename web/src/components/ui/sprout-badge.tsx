import { Sprout } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The small Sprout corner mark stamped on a vault/position icon.
 * Place inside a `relative` parent (e.g. wrapping an <AssetIcon/>).
 */
export function SproutBadge({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute -bottom-1 -right-1 inline-flex size-4 items-center justify-center rounded-full bg-midnight-ink text-canvas-white",
        className,
      )}
    >
      <Sprout className="size-2.5" strokeWidth={2.6} />
    </span>
  );
}
