import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from astropy.utils import iers  # noqa: E402

iers.conf.auto_download = False          # offline: bundled IERS tables
iers.conf.iers_degraded_accuracy = "warn"

SITES = [("Bratislava", 48.1486, 17.1077), ("Cape Town", -33.92, 18.42), ("Reykjavik", 64.13, -21.94)]
DATES = ["2020-01-15T21:00:00Z", "2024-06-21T23:30:00Z", "2026-11-02T20:00:00Z", "2031-03-10T02:00:00Z"]


def _node():
    import shutil
    try:
        import nodejs_wheel  # pip install nodejs-wheel-binaries
        return str(Path(nodejs_wheel.__file__).parent / "bin" / "node")
    except ImportError:
        return shutil.which("node") or pytest.skip("node.js not available")


@pytest.fixture(scope="session")
def js():
    """Run a function body with `A` = static/js/astro.js under node.js; `arg` is passed as JSON, returns JSON."""
    import json
    import subprocess
    node = _node()
    url = (ROOT / "static" / "js" / "astro.js").as_uri()

    def run(body, arg=None):
        code = (f"import * as A from '{url}';\nconst arg = JSON.parse(process.argv[1]);\n"
                f"const f = async () => {{ {body} }};\nf().then((r) => console.log(JSON.stringify(r)));")
        r = subprocess.run([node, "--input-type=module", "-e", code, json.dumps(arg)],
                           capture_output=True, text=True, check=True)
        return json.loads(r.stdout)
    return run


@pytest.fixture(scope="session")
def server():
    """The app on a free port, in a background thread."""
    import socket
    import threading
    import time
    import uvicorn
    from app.main import app
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=srv.run, daemon=True).start()
    for _ in range(200):
        if srv.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True


@pytest.fixture(scope="session")
def browser():
    """Headless Chromium (playwright); the UI tests are skipped when it is not installed / cannot start."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        pytest.skip("playwright not installed")
    p = sync_playwright().start()
    try:
        b = p.chromium.launch(args=["--js-flags=--expose-gc"])
    except Exception as e:  # missing system libraries etc.
        p.stop()
        pytest.skip(f"chromium cannot start: {str(e).splitlines()[0]}")
    yield b
    b.close(); p.stop()


@pytest.fixture()
def app_page(browser, server):
    """Fresh page with the planetarium loaded at a fixed place and time (Bratislava, 2026-11-20 21:00 UT)."""
    ctx = browser.new_context(viewport={"width": 1400, "height": 850}, timezone_id="UTC")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.add_init_script("""localStorage.setItem('dso.planetarium.v2', JSON.stringify({
        lat: 48.1486, lon: 17.1077, time: Date.parse('2026-11-20T21:00:00Z'),
        view: { mode: 'altaz', lon: 180, lat: 30, fov: 90 } }))""")
    pg.goto(server + "/")
    pg.wait_for_function("window.__dso && window.__dso.sky.drawn", timeout=30000)
    pg.errors = errors
    yield pg
    ctx.close()
