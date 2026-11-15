import { RoutingIcon } from "@solar-icons/react/linear";
import NextLink from "next/link";

/** The wordmark. Links home. */
export function Logo() {
  return (
    <NextLink className="flex items-center gap-2 font-semibold" href="/">
      <RoutingIcon aria-hidden size={16} />
      Zal
    </NextLink>
  );
}
