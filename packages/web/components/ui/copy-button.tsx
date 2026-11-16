"use client";

import { CheckReadLinearIcon, CopyLinearIcon } from "@solar-icons/react";
import { Button } from "@heroui/react";
import { useEffect, useState } from "react";

const ICON = { width: 14, height: 14, "aria-hidden": true } as const;

/** `0x1234…abcd`, or the first and last 6 hex digits of a hash. */
export function shortHex(value: string, head = 6, tail = 4): string {
  return value.length <= head + tail + 2
    ? value
    : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Icon button that copies `value`; shows a check for 1.5 s after a copy. */
export function CopyButton({
  value,
  label,
}: {
  readonly value: string;
  readonly label: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_500);

    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      isIconOnly
      aria-label={copied ? "Copied" : label}
      size="sm"
      variant="ghost"
      onPress={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      {copied ? (
        <CheckReadLinearIcon {...ICON} />
      ) : (
        <CopyLinearIcon {...ICON} />
      )}
    </Button>
  );
}
