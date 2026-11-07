"""Raw Herdr TUI socket probe: subscribe to lifecycle + agent events over the Windows named pipe and print each event line."""
import json, os, sys, time

PIPE_DIR = chr(92) * 2 + '.' + chr(92) + 'pipe'  # \\.\pipe

def main():
    hint = sys.argv[1] if len(sys.argv) > 1 else 'overlay-dev'
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 60
    names = os.listdir(PIPE_DIR)
    cands = [n for n in names if 'herdr' in n.lower() and hint in n.lower() and not n.lower().endswith('client.sock')]
    print('pipes:', cands, flush=True)
    pipe = PIPE_DIR + chr(92) + cands[0]
    f = open(pipe, 'r+b', buffering=0)
    types = ["workspace.created", "workspace.closed", "workspace.renamed", "workspace.metadata_updated",
             "worktree.created", "worktree.opened", "worktree.removed",
             "pane.created", "pane.closed", "pane.exited", "pane.agent_detected", "pane.updated", "pane.focused",
             "tab.created", "tab.closed"]
    subs = [{"type": t} for t in types]
    # pane.agent_status_changed is per-pane: pass pane ids as argv[3:]
    subs += [{"type": "pane.agent_status_changed", "pane_id": p} for p in sys.argv[3:]]
    req = {"id": "sub_1", "method": "events.subscribe", "params": {"subscriptions": subs}}
    f.write((json.dumps(req) + "\n").encode())
    deadline = time.time() + seconds
    buf = b''
    while time.time() < deadline:
        try:
            chunk = f.read(65536)
        except OSError as e:
            print('read error', e, flush=True)
            break
        if not chunk:
            time.sleep(0.05)
            continue
        buf += chunk
        while b'\n' in buf:
            line, buf = buf.split(b'\n', 1)
            if line.strip():
                print(time.strftime('%H:%M:%S'), line.decode(errors='replace'), flush=True)
    print('done', flush=True)

main()
