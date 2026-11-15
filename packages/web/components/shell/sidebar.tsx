"use client";

// The app sidebar (PRD "App shell"): Overview, Canvas and Explorer, then Docs and the profile toolbar in the footer.

import {
  BookIcon,
  ChartSquareIcon,
  MagnifierIcon,
  RoutingIcon,
} from "@solar-icons/react/linear";
import { Chip, Separator, Surface, buttonVariants } from "@heroui/react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { CanvasSwitcher } from "./canvas-switcher";
import { Logo } from "./logo";
import { useNotifications } from "./notifications";
import { ProfileToolbar, SandboxAutostart } from "./profile";

import { useAppHref } from "@/hooks/use-selected-account";

const ICON = { size: 16, "aria-hidden": true } as const;

const NAV = [
  {
    href: "/app/overview",
    label: "Overview",
    icon: <ChartSquareIcon {...ICON} />,
  },
  { href: "/app/canvas", label: "Canvas", icon: <RoutingIcon {...ICON} /> },
  {
    href: "/app/explorer",
    label: "Explorer",
    icon: <MagnifierIcon {...ICON} />,
  },
] as const;

function NavLink({
  href,
  label,
  icon,
  count = 0,
}: {
  readonly href: string;
  readonly label: string;
  readonly icon: React.ReactNode;
  /** Unread notifications, shown on the Canvas link because that is where they are acted on. */
  readonly count?: number;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const appHref = useAppHref();

  return (
    <NextLink
      aria-current={active ? "page" : undefined}
      className={`${buttonVariants({
        variant: active ? "secondary" : "ghost",
        size: "sm",
        fullWidth: true,
      })} justify-start`}
      href={href === "/app/docs" ? href : appHref(href)}
    >
      {icon}
      {label}
      {count > 0 ? (
        <Chip className="ms-auto" color="accent" size="sm" variant="soft">
          {count}
        </Chip>
      ) : null}
    </NextLink>
  );
}

export function Sidebar() {
  const { unreadCount } = useNotifications();

  return (
    <Surface
      className="flex h-full w-60 shrink-0 flex-col gap-4 border-r border-separator p-3"
      variant="default"
    >
      <div className="flex items-center justify-between px-2 pt-1">
        <Logo />
        <Chip size="sm" variant="soft">
          testnet
        </Chip>
      </div>
      <CanvasSwitcher />
      <nav aria-label="App" className="flex flex-col gap-1">
        {NAV.map((item) => (
          <NavLink
            key={item.href}
            {...item}
            count={item.href === "/app/canvas" ? unreadCount : 0}
          />
        ))}
      </nav>
      <div className="flex-1" />
      <div className="flex flex-col gap-3">
        <NavLink href="/app/docs" icon={<BookIcon {...ICON} />} label="Docs" />
        <Separator />
        <ProfileToolbar />
      </div>
      <Suspense>
        <SandboxAutostart />
      </Suspense>
    </Surface>
  );
}
