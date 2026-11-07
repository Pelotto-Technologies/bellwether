"""Send one raw JSON request to the Herdr TUI named pipe and print the response.
usage: python -I rpc.py <session-hint> <method> '<params-json>'
"""
import json, os, sys, time

PIPE_DIR = chr(92) * 2 + '.' + chr(92) + 'pipe'  # \\.\pipe

def main():
    hint, method = sys.argv[1], sys.argv[2]
    params = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
    names = os.listdir(PIPE_DIR)
    cands = [n for n in names if 'herdr' in n.lower() and hint in n.lower() and not n.lower().endswith('client.sock')]
    f = open(PIPE_DIR + chr(92) + cands[0], 'r+b', buffering=0)
    f.write((json.dumps({"id": "probe_1", "method": method, "params": params}) + "\n").encode())
    buf = b''
    deadline = time.time() + 10
    while time.time() < deadline and b'\n' not in buf:
        chunk = f.read(65536)
        if chunk:
            buf += chunk
        else:
            time.sleep(0.02)
    print(buf.split(b'\n', 1)[0].decode(errors='replace'))

main()
