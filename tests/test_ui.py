"""The planetarium in a headless browser: horizon, selection, panel, geometry on screen, speed and memory."""
import math

import pytest

LOOKS = [0, 90, 180, 270]


def test_loads_without_errors(app_page):
    assert app_page.errors == []
    n = app_page.evaluate("window.__dso.sky.drawn.length")
    assert n > 20


@pytest.mark.parametrize("az", LOOKS)
@pytest.mark.parametrize("hour", ["18:00", "23:00", "04:00"])
def test_nothing_shows_through_the_ground(app_page, az, hour):
    """With the ground on, no label, selection or clickable object lies below the horizon."""
    r = app_page.evaluate(f"""(() => {{
      const s = window.__dso.sky, P = s.proj;
      s.time = new Date('2026-11-21T{hour}:00Z'); P.lon = {az}; P.lat = 5; P.fov = 120; P.update(); s.draw();
      const below = s.drawn.filter((L) => L.v && L.v[2] < 0).map((L) => L.text);
      // every pickable point below the horizon must be rejected
      const picked = [];
      for (let y = P.h / 2; y < P.h; y += 23) for (let x = 0; x < P.w; x += 31) {{
        const v = P.unproject(x, y); if (v[2] > -0.002) continue;
        const o = s.pick(x, y); if (o) {{ const w = s.viewVectorOf(o); if (w && w[2] < -0.01) picked.push(o.id || o.name || o.index); }}
      }}
      return {{ below, picked }};
    }})()""")
    assert r["below"] == [], r["below"][:10]
    assert r["picked"] == [], r["picked"][:10]


def test_ground_is_opaque(app_page):
    """A pixel well below the horizon has the ground colour even where a bright star / planet is behind it."""
    rgb = app_page.evaluate("""(() => {
      const s = window.__dso.sky, P = s.proj; P.lon = 180; P.lat = 0; P.fov = 60; P.update(); s.draw();
      const d = s.ctx.getImageData(Math.round(P.w / 2 * s.dpr), Math.round((P.h - 5) * s.dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    })()""")
    assert rgb == [0x12, 0x16, 0x10]


def test_panel_toggle(app_page):
    w0 = app_page.evaluate("document.querySelector('#sky').clientWidth")
    assert app_page.is_visible("#panel")
    app_page.click("#panelToggle")
    assert not app_page.is_visible("#panel")
    app_page.wait_for_timeout(100)
    assert app_page.evaluate("document.querySelector('#sky').clientWidth") > w0 + 300
    app_page.keyboard.press("p")
    assert app_page.is_visible("#panel")


def test_search_centres_and_draws_true_size(app_page):
    app_page.fill("#search", "andromeda galaxy")
    app_page.press("#search", "Enter")
    assert "M 31" in app_page.inner_text("#info h2")
    r = app_page.evaluate("""(() => {
      const s = window.__dso.sky, P = s.proj; s.draw();
      const o = s.selected, c = P.project(s.viewVectorOf(o));
      // ends of the major axis from the outline (points 0 and 36 of 72), as drawn
      const pts = s.dsoOutline(o).map((u) => P.project(s.toView(window.__dso.A.aberrate(u, s.F.vEarth))));
      return { cx: c[0], cy: c[1], w: P.w, h: P.h, len: Math.hypot(pts[0][0] - pts[36][0], pts[0][1] - pts[36][1]), scale: P.scale };
    })()""")
    assert abs(r["cx"] - r["w"] / 2) < 0.5 and abs(r["cy"] - r["h"] / 2) < 0.5
    # stereographic: a radius θ from the centre is 2·tan(θ/2)·scale pixels
    th = math.radians(177.83 / 120)
    expected = 2 * 2 * math.tan(th / 2) * r["scale"]
    assert abs(r["len"] - expected) / expected < 0.002   # refraction stretches it a little near the zenith only


def test_mode_switch_keeps_centre(app_page):
    app_page.fill("#search", "M 42")
    app_page.press("#search", "Enter")
    app_page.select_option("#mode", "eq")
    r = app_page.evaluate("""(() => { const s = window.__dso.sky; s.draw(); const q = s.proj.project(s.viewVectorOf(s.selected));
      return [q[0] - s.proj.w / 2, q[1] - s.proj.h / 2]; })()""")
    assert abs(r[0]) < 1 and abs(r[1]) < 1


def test_east_left_in_equatorial_view(app_page):
    app_page.select_option("#mode", "eq")
    r = app_page.evaluate("""(() => { const s = window.__dso.sky, A = window.__dso.A; s.draw();
      // Betelgeuse (east of Rigel-Bellatrix line) must be to the left of Bellatrix in the equatorial view
      const st = s.data.stars.stars, idx = (h) => st.findIndex((x) => x[0] === h);
      s.proj.lookAt(s.starView(idx(25336))); s.proj.fov = 30; s.proj.update(); s.draw();
      const b = s.proj.project(s.starView(idx(27989))), g = s.proj.project(s.starView(idx(25336)));
      return b[0] < g[0]; })()""")
    assert r is True


def test_speed_and_memory(app_page):
    """300 frames with the time jumping a day and the view moving: fast, and the heap does not grow."""
    r = app_page.evaluate("""(() => {
      const s = window.__dso.sky, P = s.proj;
      const run = (n) => { for (let i = 0; i < n; i++) { s.time = new Date(s.time.getTime() + 86400e3); P.lon += 7; P.fov = [120, 30, 5, 0.5][i % 4]; P.update(); s.draw(); } };
      run(40); gc(); const m0 = performance.memory.usedJSHeapSize;
      const t = performance.now(); run(300); const dt = (performance.now() - t) / 300;
      gc(); const m1 = performance.memory.usedJSHeapSize;
      return { ms: dt, grow: (m1 - m0) / 1e6 };
    })()""")
    assert r["ms"] < 60, r
    assert r["grow"] < 5, r


def test_pointer_before_first_frame(browser, server):
    """A pointer move right after loading (before the first animation frame) must not throw (regression)."""
    pg = browser.new_page(); errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script("""new MutationObserver((_, o) => { if (document.getElementById('sky') && !document.getElementById('loading')) {
        o.disconnect(); document.getElementById('sky').dispatchEvent(new PointerEvent('pointermove', {clientX: 300, clientY: 300})); }
      }).observe(document, {childList: true, subtree: true});""")
    pg.goto(server + "/"); pg.wait_for_function("window.__dso"); pg.wait_for_timeout(300)
    pg.close()
    assert not errors, errors
