# Herdr fixtures

- `capture-2026-11-06.ndjson`: the live capture from `docs/research/events.log`
  (a real Claude Code pane going `working` → `idle`, then the pane closing), one
  pushed line per row, timestamps stripped.
- `snapshot.json`: a `session.snapshot` response shaped to the protocol 22 schema in
  `docs/research/herdr-api.schema.json` and consistent with the capture (pane `w1:p3`
  runs `claude`). It is hand-built, not recorded: no live snapshot was captured during
  research. `schema.test.ts` validates it against the schema. Replace it with a real
  `herdr api snapshot` capture (scrubbed) when one is taken.

`.ndjson` rather than `.jsonl` because `*.jsonl` recordings are gitignored.
