# Adapter fixtures

Event streams for adapter tests and the mock pipe server.

- `mixed-agents.events.ndjson`: **synthetic.** A Claude Code pane (`w1:p3`) and a GitHub
  Copilot CLI pane (`w2:p1`) in separate workspaces, one event per line, in the exact
  `pane.agent_status_changed` shape captured live in `../events.log`. Only the `agent`
  value and pane ids differ from the capture. Use it to prove the adapter treats agents
  the same regardless of `agent`. Replace it with a live capture from a Copilot pane
  when one is recorded.
