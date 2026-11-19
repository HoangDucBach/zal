import NextLink from "next/link";

/** The Zal mark, from `brands/Dark/MonoLogo.svg`. One colour: `currentColor`. */
function ZalMark({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="currentColor"
      viewBox="40 40 432 432"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M405.967 114.062C439.928 151.845 460.6 201.814 460.6 256.616C460.6 374.437 365.087 469.95 247.266 469.95C214.167 469.95 465.417 386.502 375.792 303.55C333.169 264.101 115 261.462 95.8001 427.282C34.4603 315.529 265.188 91.0864 405.967 114.062Z" />
      <path d="M247.266 43.2829C326.135 40.0674 392.334 64.6152 452.067 98.7486C260.067 43.4719 159.8 167.015 119.267 235.282C78.7334 303.549 51 254.847 51 220.35C51 114.062 142.733 47.5448 247.266 43.2829Z" />
    </svg>
  );
}

/** The wordmark. Links home. `compact` keeps the mark only, for the collapsed sidebar. */
export function Logo({ compact = false }: { readonly compact?: boolean }) {
  return (
    <NextLink
      aria-label={compact ? "Zal home" : undefined}
      className="flex items-center gap-2 font-semibold"
      href="/"
    >
      <ZalMark className="size-5 text-accent" />
      {compact ? null : "Zal"}
    </NextLink>
  );
}
