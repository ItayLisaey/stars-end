---
"stars-end": minor
---

Add a model-profile plugin system. Everything model/provider-specific — the AI SDK model factory, the coordinate adapter (how the model emits bboxes), the `providerOptions` (e.g. the per-generation Gemini thinking config), and the sampling temperature — is now bundled in a `ModelProfile` resolved from a registry, instead of being scattered across `config`, `call`, and the grounding tier.

New public API:

- `registerProfile(profile)` — plug in a custom model/provider (custom profiles take precedence over built-ins, so you can also override one).
- `profileFor(modelId)` and the `ModelProfile` / `ProviderOptions` types.
- `UnsupportedModelError` — thrown when no profile matches a model id.

The built-in Gemini profile carries the generation-aware thinking config. Using a model with no matching profile now throws `UnsupportedModelError` (it can't pick a coordinate adapter / provider) rather than silently misbehaving.
