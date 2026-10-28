# Contributing to @bever/sdk

```sh
npm install
npm test
```

- The SDK mirrors the semantic model types in [bever](https://github.com/bever-team/bever) (`Bever.Model`). A contract change updates both, bumps `SUPPORTED_SEMANTIC_MODEL_VERSION`, and refreshes `test/fixtures` from `tests/Bever.Core.Tests/fixtures/semantic-model`.
- `resolveEntityPresentation` is the reference implementation of presentation defaults. Changes to defaults need tests and an update to the [presentation guide](https://github.com/bever-team/bever.dev/blob/main/docs/guide/presentation.md).
- The SDK has no runtime dependencies. Keep it that way.
- Keep pull requests focused and include tests. By participating you agree to follow the [code of conduct](https://github.com/bever-team/.github/blob/main/CODE_OF_CONDUCT.md).
