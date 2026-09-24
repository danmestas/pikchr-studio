"""Run every tests/*-browser.py script against a local static server.

Usage: python3 tests/run-browser.py [pattern ...]

The browser scripts hard-code http://127.0.0.1:8790, so the server binds that
port. If something already listens there and serves this public/ directory
byte-for-byte, the runner reuses it and never stops it; any other listener is
an error. A server the runner starts carries its own
deadline (SERVER_DEADLINE seconds) so it cannot outlive a killed runner, and
is terminated in a finally block on every exit path. A failing script is
retried once and reported FLAKY if the retry passes.
"""
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HOST = "127.0.0.1"
PORT = int(os.environ.get("PIKCHR_STUDIO_PORT", "8790"))
BASE = f"http://{HOST}:{PORT}"
SERVER_DEADLINE = int(os.environ.get("PIKCHR_STUDIO_SERVER_DEADLINE", "1800"))
SCRIPT_TIMEOUT = int(os.environ.get("PIKCHR_STUDIO_SCRIPT_TIMEOUT", "180"))
TESTS = Path(__file__).resolve().parent
PUBLIC = TESTS.parent / "public"


def port_free():
    with socket.socket() as s:
        return s.connect_ex((HOST, PORT)) != 0


def serves_this_studio():
    try:
        remote = urllib.request.urlopen(f"{BASE}/index.html", timeout=2).read()
    except Exception:
        return False
    return remote == (PUBLIC / "index.html").read_bytes()


def wait_for_server(deadline=15):
    end = time.time() + deadline
    while time.time() < end:
        try:
            urllib.request.urlopen(f"{BASE}/index.html", timeout=1)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def run_script(path):
    env = dict(os.environ, PIKCHR_STUDIO_URL=BASE)
    try:
        proc = subprocess.run([sys.executable, str(path)], cwd=TESTS, env=env,
                              capture_output=True, text=True, timeout=SCRIPT_TIMEOUT)
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as e:
        return 124, e.stdout or "", (e.stderr or "") + f"\nTIMEOUT after {SCRIPT_TIMEOUT}s"


def main(argv):
    patterns = argv or [""]
    scripts = sorted(p for p in TESTS.glob("*-browser.py")
                     if p.name != "run-browser.py" and any(s in p.name for s in patterns))
    if not scripts:
        print("no browser scripts matched", patterns)
        return 2
    server = None
    if not port_free():
        if not serves_this_studio():
            print(f"port {PORT} is in use by something other than this studio; stop it or set PIKCHR_STUDIO_PORT")
            return 2
        print(f"reusing the studio server already running on {BASE}")
    else:
        server = subprocess.Popen(
            ["perl", "-e", "alarm shift; exec @ARGV", str(SERVER_DEADLINE),
             sys.executable, "-m", "http.server", str(PORT), "--bind", HOST, "--directory", str(PUBLIC)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    results = []
    try:
        if not wait_for_server():
            print("server did not come up on", BASE)
            return 2
        for script in scripts:
            code, out, err = run_script(script)
            status = "PASS" if code == 0 else "FAIL"
            if code != 0:
                code2, out2, err2 = run_script(script)
                if code2 == 0:
                    status = "FLAKY"
                else:
                    out, err = out2, err2
            results.append((script.name, status))
            print(f"{status:5} {script.name}", flush=True)
            if status == "FAIL":
                tail = (out + "\n" + err).strip().splitlines()[-int(os.environ.get("PIKCHR_STUDIO_TAIL", "25")):]
                for line in tail:
                    print("      " + line)
    finally:
        if server is not None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
    counts = {k: sum(1 for _, s in results if s == k) for k in ("PASS", "FLAKY", "FAIL")}
    print(f"\nbrowser: {counts['PASS']} pass, {counts['FLAKY']} flaky, {counts['FAIL']} fail, {len(results)} total")
    return 1 if counts["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
