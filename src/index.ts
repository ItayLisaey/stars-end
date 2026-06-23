/**
 * Package entry. NOT a barrel of internals — exposes only the public Agent +
 * the public types & error classes a consumer needs.
 */
export { Agent } from "./agent.js";
export type { AgentOptions, InputOpt, ScrollParam } from "./agent.js";
export type { LocateOpt } from "./insight/locate.js";
export type { WaitOpt } from "./insight/assert.js";
export type { CacheMode } from "./cache/locate-cache.js";
export type { TraceConfig, TraceEntry, TraceSink } from "./trace/jsonl-trace.js";
export type {
  ActionResult,
  CoordinateAdapter,
  LocateResult,
  PixelBbox,
  Point,
  Rect,
  Size,
  Step,
} from "./types.js";
// model-profile plugin system: register a custom model/provider with the right
// settings (provider, coordinate adapter, providerOptions, temperature).
export { profileFor, registerProfile } from "./model/profile.js";
export type { ModelProfile, ProviderOptions } from "./model/profile.js";
export {
  ActionFailedError,
  AssertionError,
  CoordinateParseError,
  ElementNotFoundError,
  ExtractError,
  InputVerificationError,
  MaxStepsError,
  NoProgressError,
  ReplanLimitError,
  TooManyErrorsError,
  UnknownActionError,
  UnsupportedModelError,
  WaitForTimeoutError,
} from "./errors.js";
