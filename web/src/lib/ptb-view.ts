// Decodes a built @mysten/sui `Transaction` into a serializable, human-readable
// view of the real Programmable Transaction Block: its inputs, its ordered
// commands, and the actual data-flow edges between them (which command output
// feeds which command input). Pure scalars carry no type tag once serialized,
// so they're decoded best-effort by byte length with an honest hex fallback.
//
// No React, no network — `tx.getData()` is synchronous.

import {
  fromBase64,
  normalizeSuiAddress,
  toHex,
  SUI_CLOCK_OBJECT_ID,
  SUI_RANDOM_OBJECT_ID,
  SUI_SYSTEM_STATE_OBJECT_ID,
  MOVE_STDLIB_ADDRESS,
  SUI_FRAMEWORK_ADDRESS,
  SUI_SYSTEM_ADDRESS,
} from "@mysten/sui/utils";
import { bcs } from "@mysten/sui/bcs";
import type { Transaction } from "@mysten/sui/transactions";
import { fmtAddress } from "@/lib/format";
import type { ResolvedStep } from "@/lib/ai/action-plan-cache";

// ─── View model ────────────────────────────────────────────────────────────

export type PtbArgRef =
  | { kind: "gas" }
  | { kind: "input"; index: number }
  | { kind: "result"; index: number }
  | { kind: "nestedResult"; cmd: number; out: number };

export type PtbInputKind =
  | "Pure"
  | "UnresolvedPure"
  | "Object"
  | "UnresolvedObject";

export type PtbInput = {
  index: number;
  kind: PtbInputKind;
  objectKind?: "ImmOrOwnedObject" | "SharedObject" | "Receiving";
  /** Best-effort human display: decoded scalar, literal value, or short id. */
  display: string;
  /** Friendly label when known: "Clock", "USDC vault", "Protocol config". */
  label?: string;
  /** Full object id (objects only) — for copy + monospace render. */
  objectId?: string;
  /** Honest raw fallback: hex (Pure) / JSON (UnresolvedPure) / id (Object). */
  raw: string;
  /** True when a Pure scalar was decoded heuristically by length. */
  approxDecode?: boolean;
  /** Command indices that read this input. */
  consumedBy: number[];
};

export type PtbCommandKind =
  | "MoveCall"
  | "SplitCoins"
  | "MergeCoins"
  | "TransferObjects"
  | "MakeMoveVec"
  | "Publish"
  | "Upgrade"
  | "Intent";

export type PtbArg = { ref: PtbArgRef; role?: string };

export type PtbMoveTarget = {
  package: string;
  packageShort: string;
  packageLabel?: string;
  module: string;
  function: string;
  typeArguments: string[];
};

export type PtbCommand = {
  index: number;
  kind: PtbCommandKind;
  /** Deterministic human label, e.g. "Split coin → 2 parts". */
  label: string;
  target?: PtbMoveTarget;
  args: PtbArg[];
  /** Upstream edges feeding this command. */
  consumes: { inputs: number[]; commands: number[] };
  /** Downstream command indices that read this command's result. */
  consumedBy: number[];
};

export type PtbView = {
  sender?: string;
  gas?: { budget?: string; price?: string; owner?: string };
  inputs: PtbInput[];
  commands: PtbCommand[];
  counts: { inputs: number; commands: number; byKind: Record<string, number> };
  /** Full getData() snapshot, pretty-printed, for the "copy raw" affordance. */
  rawJson: string;
};

/** Deployment-specific labels the static map can't know — assembled from the
 *  cached plan (vault names) and passed to `decodePtb`. */
export type PtbContext = {
  objectLabels?: Record<string, string>;
};

// ─── Known on-chain labels (framework constants only) ────────────────────────

const norm = (id: string) => normalizeSuiAddress(id);

const STATIC_OBJECT_LABELS: Record<string, string> = {
  [norm(SUI_CLOCK_OBJECT_ID)]: "Clock",
  [norm(SUI_RANDOM_OBJECT_ID)]: "Random",
  [norm(SUI_SYSTEM_STATE_OBJECT_ID)]: "Sui system",
};

const STATIC_PACKAGE_LABELS: Record<string, string> = {
  [norm(MOVE_STDLIB_ADDRESS)]: "Move stdlib (0x1)",
  [norm(SUI_FRAMEWORK_ADDRESS)]: "Sui framework (0x2)",
  [norm(SUI_SYSTEM_ADDRESS)]: "Sui system (0x3)",
};

// ─── Pure-byte decoding (honest, best-effort) ────────────────────────────────

function decodePureScalar(bytes: Uint8Array): {
  display: string;
  approx: boolean;
} {
  const hex = `0x${toHex(bytes)}`;
  try {
    // option<address>: [0] = None, [1, ...32] = Some(address).
    if (bytes.length === 1 && bytes[0] === 0) return { display: "None", approx: true };
    if (bytes.length === 33 && bytes[0] === 1) {
      return { display: fmtAddress(norm(`0x${toHex(bytes.slice(1))}`)), approx: true };
    }
    switch (bytes.length) {
      case 1:
        return {
          display: bytes[0] === 1 ? "true" : bytes[0] === 0 ? "false" : String(bytes[0]),
          approx: true,
        };
      case 8:
        return { display: bcs.U64.parse(bytes), approx: true };
      case 16:
        return { display: bcs.U128.parse(bytes), approx: true };
      case 32:
        return { display: fmtAddress(norm(hex)), approx: true };
      default:
        return { display: hex, approx: false };
    }
  } catch {
    return { display: hex, approx: false };
  }
}

function formatLiteral(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") {
    return value.startsWith("0x") && value.length > 16 ? fmtAddress(value) : value;
  }
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

// ─── Argument + command walking ──────────────────────────────────────────────

// The discriminated unions returned by getData() are typed loosely here; we
// narrow on `$kind` at each step. `RawArg`/`RawCmd` keep the call sites honest
// without importing the SDK's internal valibot output types.
type RawArg = {
  $kind: string;
  Input?: number;
  Result?: number;
  NestedResult?: [number, number];
};

function toArgRef(arg: RawArg): PtbArgRef {
  switch (arg.$kind) {
    case "Input":
      return { kind: "input", index: arg.Input ?? -1 };
    case "Result":
      return { kind: "result", index: arg.Result ?? -1 };
    case "NestedResult":
      return {
        kind: "nestedResult",
        cmd: arg.NestedResult?.[0] ?? -1,
        out: arg.NestedResult?.[1] ?? -1,
      };
    default:
      return { kind: "gas" };
  }
}

// Flattens each command's arguments in display order so edges + role hints can
// be computed uniformly.
function commandArgList(cmd: Record<string, unknown> & { $kind: string }): RawArg[] {
  switch (cmd.$kind) {
    case "MoveCall":
      return ((cmd.MoveCall as { arguments?: RawArg[] }).arguments ?? []);
    case "SplitCoins": {
      const c = cmd.SplitCoins as { coin: RawArg; amounts: RawArg[] };
      return [c.coin, ...c.amounts];
    }
    case "MergeCoins": {
      const c = cmd.MergeCoins as { destination: RawArg; sources: RawArg[] };
      return [c.destination, ...c.sources];
    }
    case "TransferObjects": {
      const c = cmd.TransferObjects as { objects: RawArg[]; address: RawArg };
      return [...c.objects, c.address];
    }
    case "MakeMoveVec":
      return (cmd.MakeMoveVec as { elements: RawArg[] }).elements ?? [];
    case "Upgrade":
      return [(cmd.Upgrade as { ticket: RawArg }).ticket];
    default:
      return [];
  }
}

const GATEWAY_ROLES: Record<string, string[]> = {
  // ember gateway arg orders — see lib/ember-actions.ts
  deposit_asset_v2: ["vault", "config", "coin", "min_shares", "receiver", "clock"],
  redeem_shares: ["clock", "vault", "config", "shares", "receiver"],
  cancel_pending_withdrawal_request: ["vault", "config", "sequence"],
};

function commandLabel(
  kind: PtbCommandKind,
  cmd: Record<string, unknown> & { $kind: string },
  target: PtbMoveTarget | undefined,
): string {
  switch (kind) {
    case "SplitCoins": {
      const n = (cmd.SplitCoins as { amounts: RawArg[] }).amounts.length;
      return `Split coin → ${n} part${n === 1 ? "" : "s"}`;
    }
    case "MergeCoins": {
      const n = (cmd.MergeCoins as { sources: RawArg[] }).sources.length + 1;
      return `Merge ${n} coins`;
    }
    case "TransferObjects": {
      const n = (cmd.TransferObjects as { objects: RawArg[] }).objects.length;
      return `Transfer ${n} object${n === 1 ? "" : "s"}`;
    }
    case "MakeMoveVec": {
      const n = (cmd.MakeMoveVec as { elements: RawArg[] }).elements.length;
      return `Build vector (${n})`;
    }
    case "Publish":
      return "Publish package";
    case "Upgrade":
      return "Upgrade package";
    case "MoveCall": {
      if (!target) return "Move call";
      if (target.module === "gateway") {
        if (target.function === "deposit_asset_v2") return "Deposit to vault";
        if (target.function === "redeem_shares") return "Redeem from vault";
        if (target.function === "cancel_pending_withdrawal_request")
          return "Cancel withdrawal";
      }
      const where = target.packageLabel ?? target.packageShort;
      return `${target.module}::${target.function} · ${where}`;
    }
    default:
      return kind;
  }
}

// ─── Main decode ─────────────────────────────────────────────────────────────

export function decodePtb(tx: Transaction, ctx: PtbContext = {}): PtbView {
  const data = tx.getData();
  const objectLabels = { ...STATIC_OBJECT_LABELS, ...(ctx.objectLabels ?? {}) };

  // 1) Inputs
  const inputs: PtbInput[] = data.inputs.map((inp, index) => {
    const base = { index, raw: "", consumedBy: [] as number[] };
    switch (inp.$kind) {
      case "Pure": {
        const bytes = fromBase64(inp.Pure.bytes);
        const { display, approx } = decodePureScalar(bytes);
        return { ...base, kind: "Pure", display, approxDecode: approx, raw: `0x${toHex(bytes)}` };
      }
      case "UnresolvedPure": {
        const value = (inp as { UnresolvedPure: { value: unknown } }).UnresolvedPure.value;
        return { ...base, kind: "UnresolvedPure", display: formatLiteral(value), raw: safeJson(value) };
      }
      case "Object": {
        const objectKind = inp.Object.$kind as PtbInput["objectKind"];
        const objectId = norm(
          (inp.Object as unknown as { [k: string]: { objectId: string } })[
            objectKind as string
          ].objectId,
        );
        return {
          ...base,
          kind: "Object",
          objectKind,
          objectId,
          display: fmtAddress(objectId),
          label: objectLabels[objectId],
          raw: objectId,
        };
      }
      case "UnresolvedObject": {
        const objectId = norm(
          (inp as { UnresolvedObject: { objectId: string } }).UnresolvedObject.objectId,
        );
        return {
          ...base,
          kind: "UnresolvedObject",
          objectId,
          display: fmtAddress(objectId),
          label: objectLabels[objectId],
          raw: objectId,
        };
      }
      default:
        return { ...base, kind: "Pure", display: "(unsupported input)", raw: "" };
    }
  });

  // 2) Commands + data-flow edges
  const commands: PtbCommand[] = data.commands.map((cmd, index) => {
    const kind = cmd.$kind as PtbCommandKind;
    let target: PtbMoveTarget | undefined;
    if (cmd.$kind === "MoveCall") {
      const mc = cmd.MoveCall;
      const pkg = norm(mc.package);
      target = {
        package: pkg,
        packageShort: fmtAddress(pkg),
        packageLabel: STATIC_PACKAGE_LABELS[pkg],
        module: mc.module,
        function: mc.function,
        typeArguments: mc.typeArguments ?? [],
      };
    }
    const rawArgs = commandArgList(cmd as Record<string, unknown> & { $kind: string });
    const args: PtbArg[] = rawArgs.map((a) => ({ ref: toArgRef(a) }));
    return {
      index,
      kind,
      label: commandLabel(kind, cmd as Record<string, unknown> & { $kind: string }, target),
      target,
      args,
      consumes: { inputs: [], commands: [] },
      consumedBy: [],
    };
  });

  // Wire edges from every arg ref.
  for (const command of commands) {
    for (const { ref } of command.args) {
      if (ref.kind === "input") {
        if (!command.consumes.inputs.includes(ref.index)) command.consumes.inputs.push(ref.index);
        inputs[ref.index]?.consumedBy.push(command.index);
      } else if (ref.kind === "result" || ref.kind === "nestedResult") {
        const producer = ref.kind === "result" ? ref.index : ref.cmd;
        if (!command.consumes.commands.includes(producer)) command.consumes.commands.push(producer);
        commands[producer]?.consumedBy.push(command.index);
      }
    }
  }

  // 3) Enrich gateway calls: roles + protocol-config / vault input labels.
  for (const command of commands) {
    if (command.kind !== "MoveCall" || command.target?.module !== "gateway") continue;
    const roles = GATEWAY_ROLES[command.target.function];
    if (command.target) command.target.packageLabel ??= "Ember gateway";
    if (!roles) continue;
    command.args.forEach((arg, i) => {
      const role = roles[i];
      if (!role) return;
      arg.role = role;
      if (arg.ref.kind === "input") {
        const input = inputs[arg.ref.index];
        if (input && !input.label) {
          if (role === "config") input.label = "Protocol config";
          else if (role === "vault") input.label = "Vault";
        }
      }
    });
  }

  // 4) Structural input labels: clock id → "Clock" already covered statically;
  //    ensure any object input matching a known label keeps it (already set).

  const byKind: Record<string, number> = {};
  for (const c of commands) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;

  return {
    sender: data.sender ?? undefined,
    gas: {
      budget: optStr(data.gasData.budget),
      price: optStr(data.gasData.price),
      owner: data.gasData.owner ?? undefined,
    },
    inputs,
    commands,
    counts: { inputs: inputs.length, commands: commands.length, byKind },
    rawJson: safeJson(data),
  };
}

/** Cheap counts-only read for the inline teaser (skips full decode work). */
export function ptbCounts(tx: Transaction): PtbView["counts"] {
  const data = tx.getData();
  const byKind: Record<string, number> = {};
  for (const c of data.commands) byKind[c.$kind] = (byKind[c.$kind] ?? 0) + 1;
  return { inputs: data.inputs.length, commands: data.commands.length, byKind };
}

/** Builds the deployment-specific label context from a cached plan's steps. */
export function buildPtbContext(steps?: ResolvedStep[]): PtbContext {
  if (!steps?.length) return {};
  const objectLabels: Record<string, string> = {};
  for (const s of steps) {
    if ("vault" in s && s.vault) {
      const v = s.vault as { objectId?: string; name?: string };
      if (v.objectId && v.name) objectLabels[norm(v.objectId)] = `${v.name} vault`;
    }
  }
  return { objectLabels };
}

function optStr(v: string | number | null | undefined): string | undefined {
  return v === null || v === undefined ? undefined : String(v);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    );
  } catch {
    return "{}";
  }
}
