"use client";

import type { ActivityItem, CanvasState } from "@/lib/canvas/types";
import type { AnimationPlaybackControls } from "motion/react";

import { Button, Card, Chip, ScrollShadow, toast } from "@heroui/react";
import { HistoryIcon } from "@solar-icons/react/linear";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { useNotifications } from "@/components/shell/notifications";
import { Amount } from "@/components/ui/amount";
import { activityNodeId } from "@/lib/canvas/activity-node";
import { formatDate, formatDateTime, formatDaysFrom } from "@/lib/format";
import { toAppError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";
import { advanceSandboxTo } from "@/lib/sandbox/session";

/**
 * What happened on this canvas, in chain order, and the payments coming up. In the sandbox the clock can jump to
 * the next due date, so the demo really reaches maturity (ADR 0007). Dragging back through history (story T1) is
 * not built yet.
 */
export function Timeline({
  state,
  sandbox,
}: {
  readonly state: CanvasState;
  readonly sandbox: boolean;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const upcoming = state.invoices
    .filter((inv) => inv.status === "approved" || inv.status === "issued")
    .sort((a, b) => a.dueDate - b.dueDate);
  const next = upcoming.find((inv) => inv.dueDate > state.now);

  return (
    <Card className="w-full max-w-2xl gap-2 border border-border/60 bg-surface/60 p-3 backdrop-blur-xl">
      <Card.Header className="flex flex-row flex-wrap items-center gap-2">
        <HistoryIcon aria-hidden className="text-muted" size={16} />
        <Card.Title className="text-sm">Timeline</Card.Title>
        <Chip size="sm" variant="secondary">
          now {formatDateTime(state.now)}
        </Chip>
        {upcoming.map((inv) => (
          <Chip
            key={String(inv.id)}
            color={inv.dueDate <= state.now ? "danger" : "accent"}
            size="sm"
            variant="soft"
          >
            #{String(inv.id)} <Amount value={inv.faceValue} /> due{" "}
            {formatDate(inv.dueDate)} ({formatDaysFrom(state.now, inv.dueDate)})
          </Chip>
        ))}
        {sandbox && next !== undefined ? (
          <Button
            isPending={busy}
            size="sm"
            variant="primary"
            onPress={async () => {
              setBusy(true);
              try {
                await advanceSandboxTo(next.dueDate);
                await queryClient.invalidateQueries({
                  queryKey: queryKeys.all,
                });
              } catch (error) {
                toast.danger(toAppError(error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Jump to due date of #{String(next.id)}
          </Button>
        ) : null}
      </Card.Header>
      <Card.Content>
        {state.activity.length === 0 ? (
          <span className="text-xs text-muted">No activity yet</span>
        ) : (
          <ActivityMarquee items={state.activity} />
        )}
      </Card.Content>
    </Card>
  );
}

/** Pixels per second: slow enough to read an item as it passes. */
const SPEED = 36;

function ActivityItems({
  items,
  copy,
}: {
  readonly items: readonly ActivityItem[];
  /** The loop's second copy: hidden from assistive tech and out of the tab order. */
  readonly copy?: boolean;
}) {
  const { flyTo } = useNotifications();

  return items.map((item) => (
    <Button
      key={item.key}
      className="h-6 shrink-0 text-xs"
      size="sm"
      variant="tertiary"
      onPress={copy ? undefined : () => flyTo(activityNodeId(item.event))}
    >
      {formatDate(item.timestamp)} · {item.title}
    </Button>
  ));
}

/**
 * The activity row as a right-to-left marquee, oldest first so the newest item enters from the right. It moves only
 * while one copy of the list is wider than the row; the loop is seamless because a second, inert copy follows the
 * first and the track wraps after exactly one copy's width. Hover or keyboard focus holds it still. Reduced motion
 * gets the plain scrollable row instead.
 */
function ActivityMarquee({
  items,
}: {
  readonly items: readonly ActivityItem[];
}) {
  const reduced = useReducedMotion() === true;
  const viewport = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLDivElement>(null);
  const [track, animate] = useAnimate<HTMLDivElement>();
  /** One copy's width (items plus the gap before the next copy) while the list overflows; otherwise undefined. */
  const [loop, setLoop] = useState<number | undefined>(undefined);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const controls = useRef<AnimationPlaybackControls | undefined>(undefined);
  /** Where the track was when its animation last restarted (a new item, a resize), so it carries on from there. */
  const travelled = useRef(0);
  const held = hovered || focused;
  const heldRef = useRef(held);

  useEffect(() => {
    const row = viewport.current;
    const copy = first.current;

    if (row === null || copy === null) return;
    const measure = () => {
      const last = copy.lastElementChild;
      const content =
        last === null
          ? 0
          : last.getBoundingClientRect().right -
            copy.getBoundingClientRect().left;

      setLoop(content > row.clientWidth ? copy.offsetWidth : undefined);
    };
    const observer = new ResizeObserver(measure);

    observer.observe(row);
    observer.observe(copy);
    measure();

    return () => observer.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;
    if (loop === undefined) {
      travelled.current = 0;
      void animate(track.current, { x: 0 }, { duration: 0 });

      return;
    }
    const running = animate(
      track.current,
      { x: [0, -loop] },
      { duration: loop / SPEED, ease: "linear", repeat: Infinity },
    );

    running.time = (travelled.current % loop) / SPEED;
    if (heldRef.current) running.pause();
    controls.current = running;

    return () => {
      travelled.current = (running.time * SPEED) % loop;
      running.stop();
      controls.current = undefined;
    };
  }, [animate, track, loop, reduced]);

  useEffect(() => {
    heldRef.current = held;
    if (held) controls.current?.pause();
    else controls.current?.play();
  }, [held]);

  if (reduced)
    return (
      <ScrollShadow
        className="flex gap-2 overflow-x-auto pb-1"
        orientation="horizontal"
      >
        <ActivityItems items={items} />
      </ScrollShadow>
    );

  return (
    <ScrollShadow
      hideScrollBar
      orientation="horizontal"
      visibility={loop === undefined ? "none" : "both"}
    >
      <div
        ref={viewport}
        className="overflow-hidden"
        data-testid="timeline-marquee"
        onBlur={() => {
          setFocused(false);
          // Focusing a hidden item scrolls the clipped row to it; put it back so the loop stays seamless.
          viewport.current?.scrollTo({ left: 0 });
        }}
        onFocus={() => setFocused(true)}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <motion.div ref={track} className="flex w-max">
          <div ref={first} className="flex shrink-0 gap-2 pr-2">
            <ActivityItems items={items} />
          </div>
          {loop === undefined ? null : (
            <div aria-hidden inert className="flex shrink-0 gap-2 pr-2">
              <ActivityItems copy items={items} />
            </div>
          )}
        </motion.div>
      </div>
    </ScrollShadow>
  );
}
