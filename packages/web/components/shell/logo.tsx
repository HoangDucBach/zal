import { RoutingIcon } from "@solar-icons/react/linear";
import NextLink from "next/link";

/** The wordmark. Links home. `compact` keeps the mark only, for the collapsed sidebar. */
export function Logo({ compact = false }: { readonly compact?: boolean }) {
  return (
    <NextLink
      aria-label={compact ? "Zal home" : undefined}
      className="flex items-center gap-2 font-semibold"
      href="/"
    >
      <RoutingIcon aria-hidden size={16} />
      {compact ? null : "Zal"}
    </NextLink>
  );
}
