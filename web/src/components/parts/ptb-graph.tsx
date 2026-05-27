"use client";

import { useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Panel,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { Box, Split, Combine, Send, Layers, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PtbView, PtbCommand, PtbCommandKind } from "@/lib/ptb-view";

// A drawn DAG of the PTB's commands using React Flow, auto-laid-out top→bottom
// with dagre. Nodes are commands; edges are real command→command result
// dependencies, so branch (one→many) and merge (many→one) are visible. Inputs
// are NOT nodes — they surface in the selected-command detail panel.

const NODE_W = 184;
const NODE_H = 58;

type NodeData = {
  cmd: PtbCommand;
  selected: boolean;
  dimmed: boolean;
};

const nodeTypes = { ptb: CommandNode };

export function PtbGraph({
  view,
  selected,
  onSelect,
}: {
  view: PtbView;
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);

  // Layout (positions) depends only on graph structure — compute once.
  const layout = useMemo(() => computeLayout(view.commands), [view.commands]);

  const active = hover ?? selected;
  const neighbors = useMemo(() => {
    if (active === null) return null;
    const c = view.commands[active];
    return new Set<number>([active, ...c.consumes.commands, ...c.consumedBy]);
  }, [active, view.commands]);

  const nodes: Node<NodeData>[] = useMemo(
    () =>
      view.commands.map((cmd) => ({
        id: String(cmd.index),
        type: "ptb",
        position: layout[cmd.index],
        data: {
          cmd,
          selected: selected === cmd.index,
          dimmed: neighbors !== null && !neighbors.has(cmd.index),
        },
        draggable: false,
        selectable: false,
        connectable: false,
      })),
    [view.commands, layout, selected, neighbors],
  );

  const edges: Edge[] = useMemo(() => {
    const out: Edge[] = [];
    for (const c of view.commands) {
      for (const p of c.consumes.commands) {
        const on = active !== null && (p === active || c.index === active);
        out.push({
          id: `${p}-${c.index}`,
          source: String(p),
          target: String(c.index),
          type: "smoothstep",
          animated: on,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: on ? "#47d096" : "#1111111f",
          },
          style: {
            stroke: on ? "#47d096" : "#11111126",
            strokeWidth: on ? 2 : 1.25,
            opacity: active !== null && !on ? 0.35 : 1,
          },
        });
      }
    }
    return out;
  }, [view.commands, active]);

  return (
    <div className="h-full min-h-[180px] w-full overflow-hidden ring-1 ring-hairline rounded-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect(Number(node.id))}
        onNodeMouseEnter={(_, node) => setHover(Number(node.id))}
        onNodeMouseLeave={() => setHover(null)}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        className="bg-canvas-white"
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#1111110f" />
        <Panel position="top-right" className="!m-2">
          <ResetViewButton />
        </Panel>
      </ReactFlow>
    </div>
  );
}

function ResetViewButton() {
  const { fitView } = useReactFlow();
  return (
    <button
      type="button"
      onClick={() => void fitView({ padding: 0.18, duration: 300 })}
      title="Reset view"
      className="inline-flex cursor-pointer items-center gap-1 bg-canvas-white/90 px-2 py-1 text-caption font-medium text-midnight-ink ring-1 ring-hairline shadow-button transition-colors hover:bg-canvas-white rounded-button backdrop-blur-sm"
    >
      <Maximize2 className="size-3" strokeWidth={2.4} />
      Fit
    </button>
  );
}

function CommandNode({ data }: NodeProps<Node<NodeData>>) {
  const { cmd, selected, dimmed } = data;
  const title = cmd.target ? `${cmd.target.module}::${cmd.target.function}` : cmd.label;
  return (
    <div
      // w-[184px] must match NODE_W (dagre lays out against that width).
      className={cn(
        "surface-panel flex w-[184px] items-center gap-2 px-2.5 py-2 ring-1 transition-all duration-200 rounded-card",
        selected ? "ring-deliver-green bg-canvas-white shadow-card" : "ring-hairline",
        dimmed && "opacity-35",
      )}
    >
      <Handle type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-transparent" />
      <span className="inline-flex size-5 shrink-0 items-center justify-center bg-whisper-gray text-[10px] font-medium tabular-nums text-midnight-ink rounded-button">
        {cmd.index + 1}
      </span>
      <span className="inline-flex size-6 shrink-0 items-center justify-center bg-midnight-ink/[0.06] text-midnight-ink rounded-full">
        {kindIcon(cmd.kind)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-caption leading-tight text-midnight-ink">
          {title}
        </span>
        {cmd.target?.packageLabel && (
          <span className="block truncate text-[10px] leading-tight text-muted-ash">
            {cmd.target.packageLabel}
          </span>
        )}
      </span>
      <Handle type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-transparent" />
    </div>
  );
}

function computeLayout(commands: PtbCommand[]): Record<number, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 30, ranksep: 52, marginx: 12, marginy: 12 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const c of commands) g.setNode(String(c.index), { width: NODE_W, height: NODE_H });
  for (const c of commands)
    for (const p of c.consumes.commands) g.setEdge(String(p), String(c.index));
  dagre.layout(g);
  const pos: Record<number, { x: number; y: number }> = {};
  for (const c of commands) {
    const n = g.node(String(c.index));
    pos[c.index] = { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2 };
  }
  return pos;
}

function kindIcon(kind: PtbCommandKind) {
  const cls = "size-3.5";
  const sw = 2.4;
  switch (kind) {
    case "SplitCoins":
      return <Split className={cls} strokeWidth={sw} />;
    case "MergeCoins":
      return <Combine className={cls} strokeWidth={sw} />;
    case "TransferObjects":
      return <Send className={cls} strokeWidth={sw} />;
    case "MakeMoveVec":
      return <Layers className={cls} strokeWidth={sw} />;
    default:
      return <Box className={cls} strokeWidth={sw} />;
  }
}
