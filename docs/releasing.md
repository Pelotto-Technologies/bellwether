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

## Not automated

These need Brandon's accounts and are deliberately left out:

- **npm publish.** All packages are `private: true`. Publishing needs an npm account
  or org, an automation token stored as the `NPM_TOKEN` repository secret, and removing
  `private` from the packages that should ship.
- **Signing.** Release archives are unsigned. Signing (for example Sigstore/cosign
  attestations, GPG, or Windows and macOS code signing for an Electron build) needs
  keys or certificates owned by the project.
- **Electron installers.** `packages/shell` does not exist yet.
