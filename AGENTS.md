# AGENTS.md

Guidance for coding agents working in this repository. Humans: see [CONTRIBUTING.md](CONTRIBUTING.md).

## What this is

`@bever/sdk`: reads Bever semantic models and calls the Bever HTTP API from browsers and Node.js. It never compiles `.bev` source. No runtime dependencies.

| File | Role |
| --- | --- |
| `src/model.ts` | Semantic model types, mirroring `Bever.Model`; `SUPPORTED_SEMANTIC_MODEL_VERSION` |
| `src/validation.ts` | `parseBeverModel`: strict ingestion of model JSON |
| `src/app.ts` | `createBeverApp`: entities, fields, actions |
| `src/presentation.ts` | `resolveEntityPresentation`: the reference implementation of presentation defaults; lookup capabilities |
| `src/routes.ts` | Entity route names |
| `src/client.ts` | `createBeverClient`: records, lookups, sign-in, antiforgery |
| `test/fixtures` | Model fixtures shared with the compiler's contract tests |

## Read first

| Topic | Document |
| --- | --- |
| SDK reference | [bever.dev/reference/sdk](https://bever.dev/reference/sdk) (`../bever.dev/docs/reference/sdk.md` when checked out alongside) |
| Semantic model JSON | [bever.dev/reference/semantic-model](https://bever.dev/reference/semantic-model) |
| Presentation defaults | [bever.dev/guide/presentation](https://bever.dev/guide/presentation) |
| HTTP API | [bever.dev/reference/http-api](https://bever.dev/reference/http-api) |
| Model rules and boundaries | [bever/docs/architecture.md](https://github.com/bever-team/bever/blob/main/docs/architecture.md) |
| Generated client rules | [bever-templates/docs/generated-client.md](https://github.com/bever-team/bever-templates/blob/main/docs/generated-client.md) |

## Commands

```sh
npm install
npm test        # builds, then runs node --test
```

## Rules

- The SDK mirrors the model contract; it does not extend it. A model change bumps `SUPPORTED_SEMANTIC_MODEL_VERSION`, updates the types, and refreshes `test/fixtures` from `tests/Bever.Core.Tests/fixtures/semantic-model` in bever, together with the compiler change.
- Ingestion is strict: unknown, missing, or duplicate properties and other model versions are errors.
- Presentation defaults live only in `resolveEntityPresentation`. Changing a default needs tests and an update to the bever.dev presentation guide. Resolution never mutates the model's actions or writes defaults back into it.
- The SDK never grants anything: it describes what the model declares, and the server decides every request.
- No runtime dependencies.
- Docs ship with code: update the bever.dev SDK reference in the same change.
