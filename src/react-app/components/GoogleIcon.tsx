import { cn } from "../lib/utils";

/**
 * Google's own product marks, wherever the app points at Google Classroom or
 * Google Drive, so the thing that will open is recognizable at a glance.
 *
 * Served as files rather than inlined: the Drive mark defines gradients and a
 * mask by id, and two inlined copies on one page would share those ids.
 * Decorative — the words beside it always name the product.
 */
export default function GoogleIcon({ product, className }: { product: "classroom" | "drive"; className?: string }) {
  return (
    <img
      src={`/brand/google-${product}.svg`}
      alt=""
      aria-hidden
      draggable={false}
      className={cn("h-5 w-5 shrink-0 object-contain", className)}
    />
  );
}
