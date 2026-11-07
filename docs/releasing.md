# Releasing

Pushing a tag that starts with `v` runs `.github/workflows/release.yml`:

1. `pnpm install --frozen-lockfile` and `pnpm check` (typecheck, test, build) on Ubuntu.
2. Packs `bellwether-<tag>.tar.gz` and `.zip` containing the static renderer
   (`packages/renderer/dist`), the adapter and CLI `dist` folders with their
   `package.json`, `LICENSE`, `README.md`, and the public packs `themes/neutral`,
   `themes/aesir` and `themes/wayfarers`. Private theme folders are never included: the
   workflow copies those three by name.
3. Creates a GitHub Release for the tag with the generated notes and both archives
   (`softprops/action-gh-release@v2`).

```sh
git tag v0.1.0
git push origin v0.1.0
```

The archives hold built output only. To run the adapter from one, install its runtime
dependencies (`pnpm install --prod` inside `packages/adapter`) and serve the renderer:
`node packages/adapter/dist/bin.js --mock --serve packages/renderer/dist`.

## npm

The `npm` job in the same workflow publishes `@pelotto-tech/bellwether` (the
`packages/cli` package) after the GitHub Release succeeds. The package is
self-contained: `prepack` (`tools/stage-runtime.mjs`) copies the built adapter and
renderer into `runtime/`, and `ws` and `smol-toml` are its dependencies. The renderer
bundles whatever theme folders exist, so always publish from CI on a clean checkout, never
from a machine with private packs.

One-time setup:

1. Reserve the `@pelotto-tech` scope on npm and log in (`npm login`).
2. Create an automation token with publish rights and add it as the `NPM_TOKEN`
   repository secret (Settings, Secrets and variables, Actions). Until it is set the
   publish step is skipped.
3. Bump `packages/cli/package.json` `version` to match the tag (the job fails if
   `v<version>` differs from the tag), then tag and push as above.

Check what would ship without publishing:

```sh
pnpm build && cd packages/cli && npm pack --dry-run
```

## Not automated

- **Signing.** Release archives are unsigned. Signing (for example Sigstore/cosign
  attestations, GPG, or Windows and macOS code signing for an Electron build) needs
  keys or certificates owned by the project. npm provenance is added automatically once the repository is public (npm rejects it for private repos).
- **Electron installers.** The shell runs from source (`pnpm shell`); no installer is built.
