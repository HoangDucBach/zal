"use client";

import type { Edge, Node, NodeChange, XYPosition } from "@xyflow/react";
import type { CanvasNodeData } from "@/lib/canvas/graph";
import type {
  CanvasAction,
  ConnectEnd,
  Connection,
  PaletteComponent,
} from "@/lib/canvas/palette";
import type { MenuAction, MenuActionId } from "./node-menu";

import {
  Alert,
  Breadcrumbs,
  Button,
  Card,
  Chip,
  Spinner,
  Surface,
  toast,
} from "@heroui/react";
import {
  ArchiveUpIcon,
  ArrowLeftIcon,
  CopyIcon,
  EyeIcon,
  FolderOpenIcon,
  GpsIcon,
  LayersMinimalisticIcon,
  TrashBinMinimalisticIcon,
  UndoLeftIcon,
} from "@solar-icons/react/linear";
import {
  Background,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
} from "@xyflow/react";
import { motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DraftPanel } from "./draft-panel";
import { GatePanel } from "./gate-panel";
import { GuidedDemo } from "./guided-demo";
import { Inbox } from "./inbox";
import { Inspector, type InspectorSubject } from "./inspector";
import { LiveBar } from "./live-bar";
import { NodeMenu } from "./node-menu";
import {
  CanvasNetwork,
  AccountActions,
  ConnectRules,
  GateActions,
  NODE_ICONS,
  nodeTypes,
} from "./nodes";
import { CHILD_CANVAS, DRAG_TYPE, Palette } from "./palette";
import { SandboxClock } from "./sandbox-clock";
import { ScheduleClock } from "./schedule-parts";
import { Timeline } from "./timeline";
import { ToolBar, type PointerMode } from "./tool-bar";

import { useNotifications } from "@/components/shell/notifications";
import { liveNetwork } from "@/config/chains";
import { useCanvasLayout, type UpdateLayout } from "@/hooks/use-canvas-layout";
import { useCanvasView } from "@/hooks/use-canvas-view";
import { useChainClock, useKeeperStatus } from "@/hooks/use-schedules";
import { useSelectedAccount } from "@/hooks/use-selected-account";
import { type LayoutChange } from "@/lib/api/layout-sync";
import { nodeId, nodeTitle } from "@/lib/canvas/graph";
import { buyerAndLpDemo, sellerDemo } from "@/lib/canvas/guided-demo";
import {
  FOOTPRINT,
  ROOT,
  addDraft,
  addLink,
  buildView,
  cannotGroup,
  childOf,
  dissolve,
  isChildId,
  isDraftId,
  levelOf,
  moveToChild,
  newChildId,
  moveToParent,
  newDraftId,
  placeFree,
  reconcile,
  removeDrafts,
  renameChild,
  setPositions,
  settleLink,
  suggestChildName,
  type CanvasLayout,
  type CanvasLevel,
  type CanvasView,
  type ChildId,
  type ViewNodeData,
} from "@/lib/canvas/layout";
import { canWriteLayout } from "@/lib/canvas/layout-access";
import {
  CATALOGUE,
  canConnect,
  describeAction,
  evaluate,
  landsAs,
  palette,
} from "@/lib/canvas/palette";

type FlowNode = Node<ViewNodeData>;

/** Room for the floating panels: the palette, the right column, and the tool bar with the Timeline. */
const FIT_PADDING = {
  top: "60px",
  right: "350px",
  bottom: "170px",
  left: "250px",
} as const;
/** Inside a child canvas the breadcrumb bar sits above the clock. */
const FIT_PADDING_CHILD = { ...FIT_PADDING, top: "110px" } as const;

const SCOPE_NAMES: Record<CanvasNodeData["kind"], string> = {
  account: "Account",
  counterparty: "counterparty",
  invoice: "invoice",
  budget: "Budget",
  approval: "Approval",
  split: "Split",
  escrow: "Escrow",
  schedule: "Schedule",
  vault: "Vault",
  pool: "Funding pool",
};

const MENU_ICON = { size: 16, "aria-hidden": true } as const;

/** A dropped draft is centred on the pointer: half a node card. */
const CARD_CENTRE = { x: 112, y: 40 } as const;
const NOT_A_NODE = "Connections end on a node, not a gate or port";

const isComponent = (value: string): value is PaletteComponent =>
  CATALOGUE.some((entry) => entry.component === value);

const isChainNode = (data: ViewNodeData): data is CanvasNodeData =>
  data.kind !== "gate" && data.kind !== "port" && data.kind !== "draft";

function addressOf(data: CanvasNodeData): string | undefined {
  switch (data.kind) {
    case "account":
      return data.account.exists ? data.account.address : undefined;
    case "counterparty":
      return data.counterparty;
    case "vault":
      return data.vault;
    case "pool":
      return data.pool.address;
    default:
      return undefined;
  }
}

/** Which sides an edge leaves and enters, so no money path loops around its own nodes. */
function handlesFor(
  from: XYPosition,
  to: XYPosition,
): { sourceHandle: string; targetHandle: string } {
  if (Math.abs(to.x - from.x) < 120) {
    return to.y < from.y
      ? { sourceHandle: "top-out", targetHandle: "bottom-in" }
      : { sourceHandle: "bottom-out", targetHandle: "top-in" };
  }

  return to.x < from.x
    ? { sourceHandle: "left-out", targetHandle: "right-in" }
    : { sourceHandle: "right-out", targetHandle: "left-in" };
}

function toFlowEdges(
  view: CanvasView,
  at: ReadonlyMap<string, XYPosition>,
): Edge[] {
  const origin = { x: 0, y: 0 };

  return view.edges.map((edge) => {
    const auto = handlesFor(
      at.get(edge.source) ?? origin,
      at.get(edge.target) ?? origin,
    );

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? auto.sourceHandle,
      targetHandle: edge.targetHandle ?? auto.targetHandle,
      label: edge.label,
      animated: edge.ghost,
      deletable: edge.draft === true,
    };
  });
}

function Message({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Alert className="w-96">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        <Alert.Description>{children}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

const typingIn = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

function CanvasFlow() {
  // xyflow tags its root `.light` or `.dark`, and the HeroUI theme selects on those
  // classes, so the flow must follow the app theme or nodes render with the wrong tokens.
  const { resolvedTheme } = useTheme();
  const { fitView, getNodes, screenToFlowPosition } = useReactFlow();
  const params = useSearchParams();
  const {
    wallet,
    network,
    selected: selectedCanvas,
    canvas,
    graph,
  } = useCanvasView();
  const { focusRequest } = useNotifications();
  const accountAddress = canvas.data?.account.exists
    ? canvas.data.account.address
    : undefined;
  const [layout, updateAnyLayout, persistence] = useCanvasLayout({
    network,
    wallet,
    account: accountAddress,
    selected: selectedCanvas,
  });
  // The wallet's own canvas before it exists has no role yet, and is where the palette creates it.
  const readOnly =
    canvas.data !== undefined &&
    canvas.data.account.exists &&
    !canWriteLayout(canvas.data.account.myRole);
  const updateLayout = useCallback<UpdateLayout>(
    (change, options) => {
      if (!readOnly || options?.derived === true)
        updateAnyLayout(change, options);
    },
    [readOnly, updateAnyLayout],
  );
  const [requestedLevel, setLevel] = useState<CanvasLevel>(ROOT);
  // A dissolved child canvas closes itself: its level falls back to the root.
  const level: CanvasLevel =
    requestedLevel !== ROOT && childOf(layout, requestedLevel) === undefined
      ? ROOT
      : requestedLevel;
  const activeChild = level === ROOT ? undefined : childOf(layout, level);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [action, setAction] = useState<CanvasAction | undefined>(undefined);
  /** The draft link whose form is open: it settles when that form's transaction confirms. */
  const [pendingLink, setPendingLink] = useState<
    { readonly id: string; readonly action: CanvasAction } | undefined
  >(undefined);
  const [mode, setMode] = useState<PointerMode>("select");
  const [minimap, setMinimap] = useState(true);
  const [menu, setMenu] = useState<
    { readonly id: string; readonly anchor: Element } | undefined
  >(undefined);
  const focused = useRef<string | undefined>(undefined);
  const pendingFly = useRef<string | undefined>(undefined);
  const padding = level === ROOT ? FIT_PADDING : FIT_PADDING_CHILD;

  useEffect(() => {
    if (graph !== undefined)
      updateLayout((current) => reconcile(current, graph, level), {
        derived: true,
      });
  }, [graph, level, updateLayout]);

  const view = useMemo(
    () =>
      graph === undefined
        ? undefined
        : buildView(graph, layout, level, canvas.data?.routed ?? []),
    [graph, layout, level, canvas.data],
  );

  useEffect(() => {
    if (view === undefined) {
      setNodes([]);

      return;
    }
    setNodes((previous) => {
      const before = new Map(previous.map((n) => [n.id, n]));

      return view.nodes.map((spec) => {
        const old = before.get(spec.id);

        return {
          id: spec.id,
          type: spec.data.kind,
          position: old?.dragging ? old.position : { ...spec.position },
          data: spec.data,
          selected: old?.selected ?? false,
          draggable: spec.data.kind !== "port",
          connectable: spec.data.kind !== "port" && spec.data.kind !== "gate",
          deletable: spec.data.kind === "draft",
        };
      });
    });
  }, [view]);

  const selectedIds = useMemo(
    () => nodes.filter((n) => n.selected).map((n) => n.id),
    [nodes],
  );

  const fit = useCallback(
    () => void fitView({ padding, duration: 300, maxZoom: 1 }),
    [fitView, padding],
  );

  // Fit when the canvas grows or shrinks, and when the open canvas level changes; a pending fly wins.
  // Drafts do not count: a draft stays exactly where it was dropped, so the view must not move under it.
  const nodeCount =
    view?.nodes.filter((n) => n.data.kind !== "draft").length ?? 0;

  useEffect(() => {
    if (nodeCount === 0) return;
    let timer = 0;
    // fitView skips nodes xyflow has not measured yet, so a fit that runs first does nothing; with a single node
    // (a new wallet's ghost Account) nothing refits later and the node stays at the top-left under the palette.
    const run = () => {
      if (getNodes().some((n) => n.measured?.width === undefined)) {
        timer = window.setTimeout(run, 60);

        return;
      }
      const id = pendingFly.current;

      if (id === undefined) {
        fit();

        return;
      }
      pendingFly.current = undefined;
      setNodes((current) =>
        current.map((n) => ({ ...n, selected: n.id === id })),
      );
      void fitView({ nodes: [{ id }], duration: 400, maxZoom: 1, padding });
    };

    timer = window.setTimeout(run, 60);

    return () => window.clearTimeout(timer);
  }, [nodeCount, level, fit, fitView, getNodes, padding]);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  const enter = useCallback((id: ChildId) => {
    setLevel(id);
    setSelected(undefined);
    setAction(undefined);
  }, []);

  /** Selects a node and flies to it, opening the canvas level it is drawn on. */
  const open = useCallback(
    (id: string) => {
      const target = isChildId(id) ? ROOT : levelOf(layout, id);

      setSelected(id);
      setAction(undefined);
      if (target !== level) {
        pendingFly.current = id;
        setLevel(target);

        return;
      }
      setNodes((current) =>
        current.map((n) => ({ ...n, selected: n.id === id })),
      );
      void fitView({ nodes: [{ id }], duration: 400, maxZoom: 1, padding });
    },
    [fitView, layout, level, padding],
  );

  // `/app/canvas?focus=<nodeId>`, from an Overview row: fly to that node once it is drawn, on its canvas level.
  const focus = params.get("focus") ?? undefined;

  useEffect(() => {
    if (focus === undefined || focused.current === focus) return;
    if (!graph?.nodes.some((n) => n.id === focus)) return;
    focused.current = focus;
    open(focus);
  }, [focus, graph, open]);

  // A notification's "Show", from anywhere in the app.
  const handledRequest = useRef(0);

  useEffect(() => {
    if (focusRequest === undefined) return;
    if (focusRequest.nonce === handledRequest.current) return;
    if (!graph?.nodes.some((n) => n.id === focusRequest.nodeId)) return;
    handledRequest.current = focusRequest.nonce;
    open(focusRequest.nodeId);
  }, [focusRequest, graph, open]);

  const dataOf = useCallback(
    (id: string | undefined) =>
      id === undefined
        ? undefined
        : graph?.nodes.find((n) => n.id === id)?.data,
    [graph],
  );
  // The Inspector follows a node only while it is drawn on the open level.
  const selectedData = view?.nodes.some((n) => n.id === selected)
    ? dataOf(selected)
    : undefined;
  const selectedGate = view?.nodes.find(
    (n) => n.id === selected && n.data.kind === "gate",
  )?.data;
  const entries = useMemo(
    () => (canvas.data === undefined ? [] : palette(canvas.data, selectedData)),
    [canvas.data, selectedData],
  );

  const group = useCallback(
    (ids: readonly string[]) => {
      const reason = cannotGroup(ids, level);

      if (reason !== undefined) {
        toast.danger(reason);

        return;
      }
      const name = suggestChildName(
        layout,
        ids.flatMap((id) => {
          const data = dataOf(id);

          return data === undefined ? [] : [data];
        }),
      );
      const move = { kind: "new", id: newChildId(), name } as const;
      const result = moveToChild(layout, ids, level, move);

      if (!result.ok) {
        toast.danger(result.reason);

        return;
      }
      updateLayout((current) => {
        const replayed = moveToChild(current, ids, level, move);

        return replayed.ok ? replayed.layout : current;
      });
      setSelected(result.child);
      setAction(undefined);
      const moved = childOf(result.layout, result.child)?.nodeIds.length ?? 0;

      toast(`Moved ${moved} node${moved === 1 ? "" : "s"} into ${name}`, {
        description: "Layout only · nothing on-chain changed",
        actionProps: {
          children: "Open",
          onPress: () => enter(result.child),
        },
      });
    },
    [dataOf, enter, layout, level, updateLayout],
  );

  const moveInto = useCallback(
    (ids: readonly string[], child: ChildId) => {
      const target = { kind: "existing", id: child } as const;
      const result = moveToChild(layout, ids, level, target);

      if (!result.ok) toast.danger(result.reason);
      else
        updateLayout((current) => {
          const replayed = moveToChild(current, ids, level, target);

          return replayed.ok ? replayed.layout : current;
        });
    },
    [layout, level, updateLayout],
  );

  const dissolveChild = useCallback(
    (id: ChildId) => {
      const name = childOf(layout, id)?.name ?? "child canvas";

      updateLayout((current) => dissolve(current, id));
      setSelected(undefined);
      setLevel(ROOT);
      toast(`${name} dissolved`, {
        description: "Nodes back on the parent canvas",
      });
    },
    [layout, updateLayout],
  );

  // ---- Drafts and connections ----------------------------------------------------------------------------------

  /** One end of a connection by id: a draft, a node the chain draws, or `undefined` for a gate or a port. */
  const endOf = useCallback(
    (id: string): ConnectEnd | undefined => {
      const draft = layout.drafts.find((d) => d.id === id);

      if (draft !== undefined)
        return { kind: "draft", component: draft.component };
      const data = dataOf(id);

      return data === undefined ? undefined : { kind: "node", data };
    },
    [dataOf, layout.drafts],
  );

  const judge = useCallback(
    (from: string, to: string): Connection | undefined => {
      const source = endOf(from);
      const target = endOf(to);

      return canvas.data === undefined ||
        source === undefined ||
        target === undefined
        ? undefined
        : canConnect(source, target, canvas.data);
    },
    [canvas.data, endOf],
  );
  const rules = useMemo(() => ({ judge }), [judge]);

  const unchanged: LayoutChange = (current) => current;

  /**
   * Records a valid connection as a draft link, after `before` (the draft it connects, when just placed), and opens
   * its form, prefilled.
   */
  const openConnection = (
    before: LayoutChange,
    source: string,
    target: string,
    result: Extract<Connection, { ok: true }>,
  ) => {
    const landing = landsAs(result.action);
    const lands =
      landing !== undefined && dataOf(landing) === undefined
        ? landing
        : undefined;
    const link = (current: CanvasLayout) =>
      addLink(before(current), source, target, lands);

    updateLayout((current) => link(current).layout);
    setPendingLink({ id: link(layout).id, action: result.action });
    setSelected(isDraftId(target) ? source : target);
    setAction(result.action);
  };

  /** A connection dragged from one node to another, or picked in a draft's panel. */
  const connect = (source: string, target: string) => {
    const result = judge(source, target);

    if (result === undefined) toast.danger(NOT_A_NODE);
    else if (!result.ok) toast.danger(result.reason);
    else openConnection(unchanged, source, target, result);
  };

  /** Places a draft at `at` on the open canvas, and connects it to `anchor` when given and the pair fits. */
  const place = (
    component: PaletteComponent,
    at: XYPosition,
    anchor?: string,
  ) => {
    const id = newDraftId();
    const placeDraft: LayoutChange = (current) =>
      addDraft(current, component, at, level, id).layout;
    const anchorData = anchor === undefined ? undefined : dataOf(anchor);
    const result =
      anchorData === undefined || canvas.data === undefined
        ? undefined
        : canConnect(
            { kind: "node", data: anchorData },
            { kind: "draft", component },
            canvas.data,
          );

    if (anchor !== undefined && result?.ok === true) {
      openConnection(placeDraft, anchor, id, result);

      return;
    }
    updateLayout(placeDraft);
    setSelected(id);
    setAction(undefined);
    setPendingLink(undefined);
    setNodes((current) => current.map((n) => ({ ...n, selected: false })));
  };

  /** The nearest free spot to `desired` among the nodes drawn on this canvas. */
  const freeNear = (desired: XYPosition) =>
    placeFree(
      desired,
      nodes.map((n) => n.position),
    );

  /** Creating the canvas account is the one component with no draft: its ghost node is already drawn. */
  const direct = (component: PaletteComponent) => {
    if (canvas.data === undefined) return;
    const availability = evaluate(component, canvas.data, undefined);

    if (availability.status !== "ready") {
      toast.danger(availability.reason);

      return;
    }
    setSelected(undefined);
    setAction(availability.action);
  };

  /**
   * A palette click: a draft next to the selection, connected to it when it fits. With nothing selected, a
   * component that attaches to the account connects to the Account; any other lands near the middle of the view.
   */
  const pick = (component: PaletteComponent) => {
    const state = canvas.data;

    if (state === undefined) return;
    if (component === "account" || !state.account.exists) {
      direct(component);

      return;
    }
    const chosen =
      selected !== undefined && dataOf(selected) !== undefined
        ? selected
        : evaluate(component, state, undefined).status === "ready"
          ? nodeId.account
          : undefined;
    const anchorAt =
      chosen === undefined
        ? undefined
        : nodes.find((n) => n.id === chosen)?.position;
    const centre = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });

    place(
      component,
      freeNear(
        anchorAt === undefined
          ? { x: centre.x - CARD_CENTRE.x, y: centre.y - CARD_CENTRE.y }
          : { x: anchorAt.x, y: anchorAt.y + FOOTPRINT.height },
      ),
      anchorAt === undefined ? undefined : chosen,
    );
  };

  /** A palette drop: on a node, a draft beside it connected to it, the old drop-on-node path; on the pane, a draft right there. */
  const drop = (
    component: PaletteComponent,
    onNode: string | undefined,
    at: XYPosition,
  ) => {
    const state = canvas.data;

    if (state === undefined) return;
    if (component === "account" || !state.account.exists) {
      direct(component);

      return;
    }
    if (onNode === undefined) {
      place(component, { x: at.x - CARD_CENTRE.x, y: at.y - CARD_CENTRE.y });

      return;
    }
    const end = endOf(onNode);
    const result =
      end === undefined
        ? undefined
        : canConnect({ kind: "draft", component }, end, state);

    if (result === undefined) toast.danger(NOT_A_NODE);
    else if (!result.ok) toast.danger(result.reason);
    else {
      const nodeAt = nodes.find((n) => n.id === onNode)?.position ?? at;

      place(
        component,
        freeNear({ x: nodeAt.x, y: nodeAt.y + FOOTPRINT.height }),
        onNode,
      );
    }
  };

  const deleteDrafts = (ids: readonly string[]) => {
    updateLayout((current) => removeDrafts(current, ids));
    if (selected !== undefined && ids.includes(selected))
      setSelected(undefined);
    if (pendingLink !== undefined && ids.includes(pendingLink.id)) {
      setPendingLink(undefined);
      setAction(undefined);
    }
  };

  const selectedDraft = layout.drafts.find((d) => d.id === selected);
  const draftTargets =
    selectedDraft === undefined || view === undefined
      ? []
      : view.nodes.flatMap((n) => {
          const result = judge(n.id, selectedDraft.id);

          return result?.ok === true && isChainNode(n.data)
            ? [
                {
                  id: n.id,
                  title: nodeTitle(n.data),
                  does: describeAction(result.action),
                },
              ]
            : [];
        });

  /** What a menu or shortcut acts on: the whole selection when the node is part of it, else the node alone. */
  const targetsOf = (id: string) =>
    selectedIds.includes(id) && selectedIds.length > 1 ? selectedIds : [id];

  const menuActions = (id: string): MenuAction[] => {
    const node = view?.nodes.find((n) => n.id === id);

    if (node === undefined) return [];
    const { data } = node;

    if (data.kind === "port")
      return [
        {
          id: "goto",
          label: `Go to ${data.label}`,
          icon: <GpsIcon {...MENU_ICON} />,
        },
      ];
    if (data.kind === "draft")
      return [
        {
          id: "inspect",
          label: "Inspect",
          icon: <EyeIcon {...MENU_ICON} />,
          shortcut: { key: "↵" },
        },
        {
          id: "delete",
          label:
            targetsOf(id).length > 1
              ? `Delete ${targetsOf(id).length} drafts`
              : "Delete draft",
          icon: <TrashBinMinimalisticIcon {...MENU_ICON} />,
          shortcut: { key: "⌫" },
          danger: true,
          section: true,
        },
      ];
    if (data.kind === "gate")
      return [
        {
          id: "open",
          label: "Open child canvas",
          icon: <FolderOpenIcon {...MENU_ICON} />,
          shortcut: { key: "↵" },
        },
        {
          id: "inspect",
          label: "Inspect",
          icon: <EyeIcon {...MENU_ICON} />,
        },
        {
          id: "focus",
          label: "Focus",
          icon: <GpsIcon {...MENU_ICON} />,
          shortcut: { key: "F" },
        },
        {
          id: "dissolve",
          label: "Dissolve",
          icon: <ArchiveUpIcon {...MENU_ICON} />,
          shortcut: { command: true, shift: true, key: "G" },
          danger: true,
          section: true,
        },
      ];
    const targets = targetsOf(id);
    const many = targets.length > 1;
    const address = isChainNode(data) ? addressOf(data) : undefined;
    const groupable = cannotGroup(targets, level) === undefined;
    const others = layout.children.filter(
      (c) => c.id !== level && targets.some((t) => !c.nodeIds.includes(t)),
    );

    return [
      {
        id: "inspect",
        label: "Inspect",
        icon: <EyeIcon {...MENU_ICON} />,
        shortcut: { key: "↵" },
      },
      {
        id: "focus",
        label: "Focus",
        icon: <GpsIcon {...MENU_ICON} />,
        shortcut: { key: "F" },
      },
      ...(address === undefined
        ? []
        : [
            {
              id: "copy" as const,
              label: "Copy address",
              icon: <CopyIcon {...MENU_ICON} />,
            },
          ]),
      ...(groupable
        ? [
            {
              id: "group" as const,
              label: many
                ? `Move ${targets.length} nodes to a child canvas`
                : "Move to child canvas",
              icon: <LayersMinimalisticIcon {...MENU_ICON} />,
              shortcut: { command: true, key: "G" },
              section: true,
            },
          ]
        : []),
      ...(data.kind === "account"
        ? []
        : others.map((c, index) => ({
            id: `move:${c.id}` as const,
            label: `Move to ${c.name}`,
            icon: NODE_ICONS.gate,
            section: index === 0 && !groupable,
          }))),
      ...(level === ROOT
        ? []
        : [
            {
              id: "ungroup" as const,
              label: "Move to parent canvas",
              icon: <UndoLeftIcon {...MENU_ICON} />,
              section: true,
            },
          ]),
    ];
  };

  const runAction = (actionId: MenuActionId, id: string) => {
    const node = view?.nodes.find((n) => n.id === id);

    if (node === undefined) return;
    const { data } = node;

    if (actionId.startsWith("move:")) {
      const child = actionId.slice("move:".length);

      if (isChildId(child)) moveInto(targetsOf(id), child);

      return;
    }
    switch (actionId) {
      case "inspect":
        setSelected(id);
        setAction(undefined);
        setNodes((current) =>
          current.map((n) => ({ ...n, selected: n.id === id })),
        );
        break;
      case "focus":
        open(id);
        break;
      case "copy": {
        const address = isChainNode(data) ? addressOf(data) : undefined;

        if (address !== undefined)
          void navigator.clipboard.writeText(address).then(
            () => toast.success("Address copied"),
            () => toast.danger("Could not copy the address"),
          );
        break;
      }
      case "group":
        group(targetsOf(id));
        break;
      case "ungroup":
        updateLayout((current) => moveToParent(current, targetsOf(id)));
        break;
      case "open":
        if (isChildId(id)) enter(id);
        break;
      case "dissolve":
        if (isChildId(id)) dissolveChild(id);
        break;
      case "goto":
        if (data.kind === "port") open(data.target);
        break;
      case "delete":
        deleteDrafts(targetsOf(id).filter(isDraftId));
        break;
    }
  };

  // Keyboard: the shortcuts the context menu shows.
  const shortcuts = useRef<(event: KeyboardEvent) => void>(() => undefined);

  useEffect(() => {
    shortcuts.current = (event: KeyboardEvent) => {
      if (typingIn(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      const single = selectedIds.length === 1 ? selectedIds[0] : selected;

      if (mod && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (!event.shiftKey) group(selectedIds);
        else if (single !== undefined && isChildId(single))
          dissolveChild(single);
        else if (activeChild !== undefined) dissolveChild(activeChild.id);

        return;
      }
      if (mod || single === undefined) return;
      if (event.key === "f" || event.key === "F") open(single);
      else if (event.key === "Enter")
        runAction(isChildId(single) ? "open" : "inspect", single);
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcuts.current(event);

    window.addEventListener("keydown", listener);

    return () => window.removeEventListener("keydown", listener);
  }, []);

  const subject: InspectorSubject | undefined =
    action !== undefined
      ? { kind: "action", action }
      : selectedData !== undefined
        ? { kind: "node", data: selectedData }
        : undefined;
  const closeInspector = () => {
    setSelected(undefined);
    setAction(undefined);
  };
  const sandbox = network?.kind === "sandbox";
  const ready = canvas.data !== undefined && network !== undefined;
  const positions = useMemo(
    () => new Map(nodes.map((n) => [n.id, n.position])),
    [nodes],
  );
  const edges = useMemo(
    () => (view === undefined ? [] : toFlowEdges(view, positions)),
    [view, positions],
  );
  const gateActions = useMemo(() => ({ open: enter }), [enter]);
  const accountActions = { create: () => direct("account") };

  return (
    <AccountActions value={accountActions}>
      <GateActions value={gateActions}>
        <ConnectRules value={rules}>
          <ReactFlow
            colorMode={resolvedTheme === "light" ? "light" : "dark"}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={36}
            deleteKeyCode={["Backspace", "Delete"]}
            edges={edges}
            isValidConnection={(c) => judge(c.source, c.target)?.ok === true}
            maxZoom={1.5}
            minZoom={0.1}
            multiSelectionKeyCode={["Shift", "Meta", "Control"]}
            nodeTypes={nodeTypes}
            nodes={nodes}
            nodesConnectable={ready && !readOnly}
            nodesDraggable={!readOnly}
            panOnDrag={mode === "pan" ? true : [1, 2]}
            selectionOnDrag={mode === "select"}
            onBeforeDelete={async ({ nodes: gone, edges: cut }) => ({
              nodes: gone.filter((n) => isDraftId(n.id)),
              edges: cut.filter((e) => e.deletable === true),
            })}
            onConnectEnd={(event, connection) => {
              const from = connection.fromNode?.id;

              if (from === undefined) return;
              const point =
                "changedTouches" in event ? event.changedTouches[0] : event;
              const under =
                point === undefined
                  ? null
                  : document
                      .elementFromPoint(point.clientX, point.clientY)
                      ?.closest(".react-flow__node");
              const to =
                connection.toNode?.id ??
                under?.getAttribute("data-id") ??
                undefined;

              if (to !== undefined && to !== from) connect(from, to);
            }}
            onDelete={({ nodes: gone, edges: cut }) =>
              deleteDrafts([...gone.map((n) => n.id), ...cut.map((e) => e.id)])
            }
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(DRAG_TYPE)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(event) => {
              const component = event.dataTransfer.getData(DRAG_TYPE);

              if (component === CHILD_CANVAS) {
                event.preventDefault();
                group(selectedIds);

                return;
              }
              if (!isComponent(component)) return;
              event.preventDefault();
              const nodeEl =
                event.target instanceof Element
                  ? event.target.closest(".react-flow__node")
                  : null;

              drop(
                component,
                nodeEl?.getAttribute("data-id") ?? undefined,
                screenToFlowPosition({ x: event.clientX, y: event.clientY }),
              );
            }}
            onNodeClick={(event, node) => {
              if (node.data.kind === "port") {
                open(node.data.target);

                return;
              }
              if (event.shiftKey || event.metaKey || event.ctrlKey) return;
              setSelected(node.id);
              setAction(undefined);
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              const anchor =
                event.target instanceof Element
                  ? event.target.closest(".react-flow__node")
                  : null;

              if (!selectedIds.includes(node.id))
                setNodes((current) =>
                  current.map((n) => ({ ...n, selected: n.id === node.id })),
                );
              if (anchor !== null) setMenu({ id: node.id, anchor });
            }}
            onNodeDoubleClick={(_, node) => {
              if (isChildId(node.id)) enter(node.id);
            }}
            onNodeDragStop={(_, __, dragged) =>
              updateLayout((current) =>
                setPositions(
                  current,
                  Object.fromEntries(
                    dragged
                      .filter((n) => n.data.kind !== "port")
                      .map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
                  ),
                ),
              )
            }
            onNodesChange={onNodesChange}
            onPaneClick={() => {
              setSelected(undefined);
              setAction(undefined);
            }}
          >
            {/* The dot grid over one quiet token gradient: the page background with a faint accent at the centre. */}
            <Background
              bgColor="var(--background)"
              className="bg-radial from-accent/10 via-accent/3 via-40% to-background"
            />
            {ready && !readOnly ? (
              <Panel className="bottom-44 flex items-start" position="top-left">
                <Palette
                  entries={entries}
                  scope={
                    selectedIds.length > 1
                      ? `${selectedIds.length} nodes`
                      : selectedData === undefined
                        ? (activeChild?.name ?? "canvas")
                        : SCOPE_NAMES[selectedData.kind]
                  }
                  structure={{
                    blockedBy: cannotGroup(selectedIds, level),
                    onCreate: () => group(selectedIds),
                  }}
                  onPick={pick}
                />
              </Panel>
            ) : null}
            <Panel
              className="flex flex-col items-center gap-2"
              position="top-center"
            >
              {activeChild === undefined ? null : (
                <motion.div
                  key={activeChild.id}
                  animate={{ opacity: 1, y: 0 }}
                  initial={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  <Surface
                    className="flex items-center gap-2 rounded-2xl border border-accent/40 bg-surface/70 p-1 backdrop-blur-xl"
                    data-testid="child-canvas-bar"
                    variant="default"
                  >
                    <Button
                      isIconOnly
                      aria-label="Back to the parent canvas"
                      size="sm"
                      variant="ghost"
                      onPress={() => setLevel(ROOT)}
                    >
                      <ArrowLeftIcon aria-hidden size={16} />
                    </Button>
                    <Breadcrumbs
                      onAction={(key) => {
                        if (key === ROOT) setLevel(ROOT);
                      }}
                    >
                      <Breadcrumbs.Item id={ROOT}>Canvas</Breadcrumbs.Item>
                      <Breadcrumbs.Item id={activeChild.id}>
                        {activeChild.name}
                      </Breadcrumbs.Item>
                    </Breadcrumbs>
                    <Chip size="sm" variant="secondary">
                      child canvas
                    </Chip>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => dissolveChild(activeChild.id)}
                    >
                      <ArchiveUpIcon aria-hidden size={14} />
                      Dissolve
                    </Button>
                  </Surface>
                </motion.div>
              )}
              <SandboxClock />
              <LiveBar persistence={persistence} />
              {wallet === undefined ? (
                <Message title="Connect a wallet">
                  Your wallet&apos;s Zal account · Sandbox runs the full demo
                </Message>
              ) : network === undefined ? (
                <Message title="Live network unavailable">
                  {liveNetwork.status === "unavailable"
                    ? liveNetwork.reason
                    : ""}{" "}
                  Sandbox runs without it.
                </Message>
              ) : canvas.isPending ? (
                <Card className="flex flex-row items-center gap-2 p-3">
                  <Spinner size="sm" />
                  <span className="text-sm">
                    {sandbox
                      ? "Starting the sandbox chain…"
                      : "Reading your canvas…"}
                  </span>
                </Card>
              ) : canvas.isError ? (
                <Message title="Could not read the canvas">
                  {canvas.error.message}
                </Message>
              ) : null}
            </Panel>
            {ready && graph !== undefined ? (
              <Panel
                className="bottom-52 flex items-start"
                position="top-right"
              >
                <div className="-m-3 flex max-h-full flex-col gap-3 overflow-y-auto p-3">
                  <Inbox graph={graph} onOpen={open} />
                  {selectedDraft !== undefined && action === undefined ? (
                    <DraftPanel
                      key={selectedDraft.id}
                      draft={selectedDraft}
                      targets={draftTargets}
                      onClose={closeInspector}
                      onConnect={(id) => connect(id, selectedDraft.id)}
                      onDelete={() => deleteDrafts([selectedDraft.id])}
                    />
                  ) : selectedGate?.kind === "gate" && action === undefined ? (
                    <GatePanel
                      key={selectedGate.gate.id}
                      gate={selectedGate.gate}
                      onClose={closeInspector}
                      onDissolve={() => dissolveChild(selectedGate.gate.id)}
                      onOpen={() => enter(selectedGate.gate.id)}
                      onRename={(name) =>
                        updateLayout((current) =>
                          renameChild(current, selectedGate.gate.id, name),
                        )
                      }
                    />
                  ) : subject === undefined ? null : (
                    <Inspector
                      key={`${selected ?? ""}:${action?.kind ?? ""}`}
                      network={network}
                      state={canvas.data}
                      subject={subject}
                      onClose={closeInspector}
                      onDone={() => {
                        // Only the form the link opened settles it; another form may be open by now.
                        if (
                          pendingLink !== undefined &&
                          pendingLink.action === action
                        ) {
                          const link = pendingLink.id;

                          updateLayout((current) => settleLink(current, link));
                        }
                        setPendingLink(undefined);
                        setAction(undefined);
                      }}
                    />
                  )}
                  {sandbox ? (
                    <GuidedDemo
                      buyer={buyerAndLpDemo(canvas.data)}
                      compact={
                        subject !== undefined || selectedGate !== undefined
                      }
                      seller={sellerDemo(canvas.data)}
                      onFocus={open}
                    />
                  ) : null}
                </div>
              </Panel>
            ) : null}
            <Panel
              className="pointer-events-none flex w-full flex-col items-center gap-2 px-16 *:pointer-events-auto"
              position="bottom-center"
            >
              <ToolBar
                minimap={minimap}
                mode={mode}
                onFit={fit}
                onMinimapChange={setMinimap}
                onModeChange={setMode}
              />
              {ready ? (
                <Timeline sandbox={sandbox} state={canvas.data} />
              ) : null}
            </Panel>
            {minimap && ready ? (
              <MiniMap
                pannable
                zoomable
                ariaLabel="Minimap"
                bgColor="transparent"
                className="overflow-hidden rounded-2xl border border-border/60 bg-surface/60 backdrop-blur-xl"
                maskColor="color-mix(in oklab, var(--background) 55%, transparent)"
                nodeBorderRadius={8}
                nodeColor={(node) =>
                  node.type === "gate"
                    ? "var(--accent)"
                    : node.type === "port"
                      ? "color-mix(in oklab, var(--accent) 45%, transparent)"
                      : "color-mix(in oklab, var(--foreground) 45%, transparent)"
                }
                nodeStrokeWidth={0}
                position="bottom-left"
              />
            ) : null}
          </ReactFlow>
        </ConnectRules>
        <NodeMenu
          actions={menu === undefined ? [] : menuActions(menu.id)}
          anchor={menu?.anchor}
          onAction={(id) => {
            if (menu !== undefined) runAction(id, menu.id);
          }}
          onClose={() => setMenu(undefined)}
        />
      </GateActions>
    </AccountActions>
  );
}

/** What schedule cards read beyond their node data: the network for Run now, a ticking chain clock, the keeper. */
function ScheduleScope({ children }: { readonly children: React.ReactNode }) {
  const { network, canvas } = useCanvasView();
  const keeper = useKeeperStatus(network);
  const now = useChainClock(canvas.data?.now ?? 0, canvas.dataUpdatedAt);
  const clock = useMemo(() => ({ now, keeper }), [now, keeper]);

  return (
    <CanvasNetwork value={network}>
      <ScheduleClock value={clock}>{children}</ScheduleClock>
    </CanvasNetwork>
  );
}

export function Canvas() {
  // Another canvas starts with its own selection, level and viewport.
  const selected = useSelectedAccount();

  return (
    <ReactFlowProvider key={selected ?? "own"}>
      <ScheduleScope>
        <CanvasFlow />
      </ScheduleScope>
    </ReactFlowProvider>
  );
}
