"use client";

// The app sidebar (PRD "App shell"): Overview, Canvas and Explorer, then Docs and the profile toolbar in the footer.
// It collapses to an icon rail, so a half-screen window keeps its width for the canvas.

import {
  BookIcon,
  ChartSquareIcon,
  MagnifierIcon,
  RoutingIcon,
  SidebarMinimalisticIcon,
} from "@solar-icons/react/linear";
import {
  Badge,
  Button,
  Chip,
  Separator,
  Surface,
  buttonVariants,
} from "@heroui/react";
import { motion, useReducedMotion } from "motion/react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { CanvasSwitcher } from "./canvas-switcher";
import { Logo } from "./logo";
import { useNotifications } from "./notifications";
import { ProfileToolbar, SandboxAutostart } from "./profile";
import { RailTooltip } from "./rail-tooltip";

import { useAppHref } from "@/hooks/use-selected-account";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";

const ICON = { size: 16, "aria-hidden": true } as const;

/** Pixel widths of `w-16` and `w-60`, for the width animation. */
const WIDTH = { collapsed: 64, expanded: 240 } as const;

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
  collapsed,
  count = 0,
}: {
  readonly href: string;
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly collapsed: boolean;
  /** Unread notifications, shown on the Canvas link because that is where they are acted on. */
  readonly count?: number;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const appHref = useAppHref();
  const variant = active ? "secondary" : "ghost";
  const target = href === "/app/docs" ? href : appHref(href);

  if (collapsed)
    return (
      <RailTooltip shown label={count > 0 ? `${label} · ${count}` : label}>
        <Badge.Anchor>
          <NextLink
            aria-current={active ? "page" : undefined}
            aria-label={label}
            className={buttonVariants({
              variant,
              size: "sm",
              isIconOnly: true,
            })}
            href={target}
          >
            {icon}
          </NextLink>
          {count > 0 ? (
            <Badge color="accent" size="sm">
              {count}
            </Badge>
          ) : null}
        </Badge.Anchor>
      </RailTooltip>
    );

  return (
    <NextLink
      aria-current={active ? "page" : undefined}
      className={`${buttonVariants({ variant, size: "sm", fullWidth: true })} justify-start`}
      href={target}
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

function CollapseToggle({
  collapsed,
  onChange,
}: {
  readonly collapsed: boolean;
  readonly onChange: (collapsed: boolean) => void;
}) {
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <RailTooltip label={label} shown={collapsed}>
      <Button
        isIconOnly
        aria-expanded={!collapsed}
        aria-label={label}
        size="sm"
        variant="ghost"
        onPress={() => onChange(!collapsed)}
      >
        <SidebarMinimalisticIcon {...ICON} />
      </Button>
    </RailTooltip>
  );
}

export function Sidebar() {
  const { unreadCount } = useNotifications();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      animate={{ width: collapsed ? WIDTH.collapsed : WIDTH.expanded }}
      className="h-full shrink-0 overflow-hidden"
      initial={false}
      transition={{
        duration: reduceMotion === true ? 0 : 0.2,
        ease: "easeOut",
      }}
    >
      <Surface
        className={`flex h-full flex-col gap-4 border-r border-separator ${
          collapsed ? "w-16 items-center px-2 py-3" : "w-60 p-3"
        }`}
        variant="default"
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-2 pt-1">
            <Logo compact />
            <Chip className="px-0.5" size="sm" variant="soft">
              testnet
            </Chip>
            <CollapseToggle collapsed onChange={setCollapsed} />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 px-2 pt-1">
            <Logo />
            <span className="flex items-center gap-1">
              <Chip size="sm" variant="soft">
                testnet
              </Chip>
              <CollapseToggle collapsed={false} onChange={setCollapsed} />
            </span>
          </div>
        )}
        <CanvasSwitcher compact={collapsed} />
        <nav
          aria-label="App"
          className={`flex flex-col gap-1 ${collapsed ? "items-center" : ""}`}
        >
          {NAV.map((item) => (
            <NavLink
              key={item.href}
              {...item}
              collapsed={collapsed}
              count={item.href === "/app/canvas" ? unreadCount : 0}
            />
          ))}
        </nav>
        <div className="flex-1" />
        <div
          className={`flex flex-col gap-3 ${collapsed ? "items-center" : ""}`}
        >
          <NavLink
            collapsed={collapsed}
            href="/app/docs"
            icon={<BookIcon {...ICON} />}
            label="Docs"
          />
          <Separator />
          <ProfileToolbar compact={collapsed} />
        </div>
        <Suspense>
          <SandboxAutostart />
        </Suspense>
      </Surface>
    </motion.div>
  );
}
