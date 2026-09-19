# Interfaces: Phase 1 - Deterministic Context Wins

Status: Draft (awaiting human approval)
Frozen before implementation. Verified against `AuthStorage` (`auth-storage.ts:701`, `:1173`) and the `SettingsManager` `getX()` + env-override pattern.

## Contract map

| Surface | Kind | Contract? |
|---|---|---|
| `capToolOutput`, `evictStaleImages`, `createContextStatsAccumulator` | exported fn | yes |
| Settings keys + env vars | config | yes |
| Scratchpad pointer text, image tombstone text | model-visible | yes (de facto, Hyrum's Law) |
| Accumulator internals, scratchpad dir layout | implementation | no |

Two model-visible strings are commitments; their format markers are versioned below.

## Module: tool-output-cap.ts

```ts
export interface ToolOutputCapOptions {
  maxLines: number;   // > 0
  maxBytes: number;   // > 0
  headRatio: number;  // [0, 1]
}

export interface CapToolOutputInput {
  content: (TextContent | ImageContent)[];
  /** Existing pointer from a tool that already spilled output (bash fullOutputPath). */
  existingFullOutputPath?: string;
  options: ToolOutputCapOptions;
  /** Injected I/O. Returns an absolute path. Keeps the function pure/testable. */
  writeScratchpad: (text: string) => string;
}

export interface CappedToolOutput {
  content: (TextContent | ImageContent)[];
  capped: boolean;
  fullOutputPath?: string;
  originalBytes: number;
}

export function exceedsOutputCap(text: string, options: ToolOutputCapOptions): boolean;
export function capToolOutput(input: CapToolOutputInput): CappedToolOutput;
```

Failure contract: **fail open.** Any thrown error returns `{ content, capped: false }`. Never throws. Never returns an empty `content` array. If `existingFullOutputPath` is present, it is reused and no new file is written.

Pointer format (frozen, do not reword without a version bump):

```
[Output exceeded {maxLines} lines / {maxBytes} bytes ({totalLines} lines, {totalBytes} bytes).]
[Full output: {fullOutputPath}]
[Use grep/awk/sed on that file to inspect specific sections.]
```

## Module: image-ttl.ts

```ts
export interface ImageTtlOptions {
  ttlTurns: number; // >= 0; 0 disables (passthrough)
}

/** Pure. Returns a new array; never mutates inputs or message objects. */
export function evictStaleImages(
  messages: readonly AgentMessage[],
  options: ImageTtlOptions,
): AgentMessage[];

export function imageEvictionPlaceholder(mimeType: string, observation?: string): string;
```

Tombstone format (frozen):

```
[image evicted: {mimeType}]
[image evicted: {mimeType}; observed: {observation}]
```

Guarantee: a message whose only content part was an image ends with exactly one `TextContent` placeholder. `ttlTurns: 0` returns the input array unchanged (passthrough).

## Module: context-stats.ts

```ts
export interface ContextStats {
  turnIndex: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  toolResultBytes: number;
  imageBytes: number;
  estimatedContextTokens: number;
  toolResultsCapped: number;
  imagesEvicted: number;
}

export interface ContextStatsAccumulator {
  observeToolResult(content: (TextContent | ImageContent)[], capped: boolean): void;
  observeEviction(imageCount: number): void;
  snapshot(input: { turnIndex: number; usage: Usage; messages: readonly AgentMessage[] }): ContextStats;
  reset(): void;
}

export function createContextStatsAccumulator(): ContextStatsAccumulator;
export type ContextStatsSink = (stats: ContextStats) => void;
```

Failure contract: a throwing sink is swallowed. Stats collection never breaks or delays a turn.

## Key resolver: jev-openrouter.ts (additive only)

```ts
export type JevApiKeyResolver = () => string | undefined | Promise<string | undefined>;

export interface OpenRouterJevOptions {
  // existing fields unchanged
  apiKey?: string;                    // highest priority (explicit/tests)
  resolveApiKey?: JevApiKeyResolver;  // host-provided: AuthStorage -> env
}
```

Resolution order: `apiKey` -> `resolveApiKey()` -> `process.env.OPENROUTER_API_KEY` -> `undefined` classifier. The key is never logged or persisted. The host resolver uses `await authStorage.getApiKey("openrouter")`. A missing or failing key yields `undefined` (the loop falls back to the generative model), never a throw.

## Config surface (additive, optional)

| Setting key | Env var | Type | Default | Invalid |
|---|---|---|---|---|
| `toolOutputCap.enabled` | `PRIME_AGENT_TOOL_OUTPUT_CAP` | bool | `false` | warn, default |
| `toolOutputCap.maxLines` | `PRIME_AGENT_TOOL_OUTPUT_MAX_LINES` | int > 0 | `200` | warn, default |
| `toolOutputCap.maxBytes` | `PRIME_AGENT_TOOL_OUTPUT_MAX_BYTES` | int > 0 | `16384` | warn, default |
| `toolOutputCap.headRatio` | `PRIME_AGENT_TOOL_OUTPUT_HEAD_RATIO` | float [0,1] | `0.6` | warn, default |
| `imageTtl.enabled` | `PRIME_AGENT_IMAGE_TTL` | bool | `false` | warn, default |
| `imageTtl.ttlTurns` | `PRIME_AGENT_IMAGE_TTL_TURNS` | int >= 0 | `2` | warn, default |

Precedence: env > project settings > global settings > default, matching existing convention.

Validation lives only at this boundary. Invalid input degrades to the default with a warning; it never crashes startup.

## Hook composition

- `afterToolCall`: extension `tool_result` hooks run first and merge; the cap runs **last** so it always bounds what enters context. Per-tool opt-out is config-driven, not hook-driven (extensions cannot silently defeat the cap). Decision pending Open Question 4.
- `transformContext`: extension `emitContext` runs first, then `evictStaleImages`. Both operate on copies; the durable session is untouched.
- Hook signatures are unchanged. Behavior differs only when flags are set (unflagged runs are byte-identical to today).

## Backward compatibility (Hyrum's Law)

- New config keys are additive and optional; no existing key changes type or is removed.
- Hook signatures unchanged.
- Model-visible strings frozen; format markers allow future versioning.
- No `packages/agent` API change in Phase 1.

## Verification checklist

- [x] Typed input/output for every exported function
- [x] Single error strategy (fail open, never throw)
- [x] Validation at boundaries only
- [x] New config additive/optional; no breaking changes
- [x] Naming: camelCase fields, `UPPER_SNAKE` env, `is/has` booleans, `observe*`/`snapshot` verbs
- [x] Model-visible strings frozen and versioned
- [ ] Human approval
- [ ] Open Questions 1-4 answered
