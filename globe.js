import { createSurfaceRenderer } from './globe-surface.js';

const RAD = Math.PI / 180;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const wrap = (v) => ((((v + 180) % 360) + 360) % 360) - 180;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load ' + file));
    image.src = new URL('./assets/' + file, import.meta.url).href;
  });
}

function basis(lat, lon) {
  const a = lat * RAD,
    b = lon * RAD;
  const ca = Math.cos(a),
    sa = Math.sin(a),
    cb = Math.cos(b),
    sb = Math.sin(b);
  return [
    [-sb, cb, 0],
    [-sa * cb, -sa * sb, ca],
    [ca * cb, ca * sb, sa],
  ];
}

/** Orbitable orthographic Earth. Screen coordinates use CSS pixels relative to canvas. */
export function createGlobe(canvas, options = {}) {
  let view = { lat: 20, lon: -28, zoom: 1 };
  let axes = basis(view.lat, view.lon);
  let fixedLayout = null;
  let layout = { cx: 0, cy: 0, radius: 1, width: 1, height: 1 };
  let level = 0,
    grid = true,
    frame = 0,
    disposed = false;
  let pinch = null,
    drag = null,
    cursor = 'grab';
  let terrain = null,
    floors = null,
    satellite = null,
    shade = null,
    clouds = null;
  const pointers = new Map();
  const events = new AbortController();
  const renderer = createSurfaceRenderer(canvas);

  function invalidate() {
    if (!frame && !disposed) frame = requestAnimationFrame(draw);
  }
  function dimensions() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const small = width <= 720;
    const medium = width > 720 && width < 1040;
    const defaults = small
      ? { cx: width * 0.5, cy: height * 0.315, radius: Math.min(width * 0.432, height * 0.205) }
      : {
          cx: width * (medium ? 0.665 : 0.61),
          cy: height * 0.48,
          radius: Math.min(width * (medium ? 0.3 : 0.31), height * 0.405),
        };
    layout = { width, height, ...defaults, ...fixedLayout };
  }
  function draw() {
    frame = 0;
    dimensions();
    renderer.render({ layout, axes, zoom: view.zoom, level, grid });
    options.onRender?.();
  }
  function setView(lat, lon, zoom = view.zoom) {
    view = { lat: clamp(lat, -88, 88), lon: wrap(lon), zoom: clamp(zoom, 0.65, 5) };
    axes = basis(view.lat, view.lon);
    invalidate();
    options.onViewChange?.({ ...view });
  }
  function project(lat, lon) {
    const a = lat * RAD,
      b = lon * RAD;
    const p = [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)];
    const dot = (v) => v[0] * p[0] + v[1] * p[1] + v[2] * p[2];
    const r = layout.radius * view.zoom;
    return {
      x: layout.cx + r * dot(axes[0]),
      y: layout.cy - r * dot(axes[1]),
      visible: dot(axes[2]) > 0.018,
    };
  }
  function unproject(x, y) {
    const r = layout.radius * view.zoom;
    const e = (x - layout.cx) / r,
      n = (layout.cy - y) / r;
    const z2 = 1 - e * e - n * n;
    if (z2 < 0) return null;
    const f = Math.sqrt(z2);
    const coord = (i) => e * axes[0][i] + n * axes[1][i] + f * axes[2][i];
    return { lat: Math.asin(clamp(coord(2), -1, 1)) / RAD, lon: Math.atan2(coord(1), coord(0)) / RAD };
  }
  function position(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function separation() {
    const [a, b] = Array.from(pointers.values());
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function listen(name, callback, extra = {}) {
    canvas.addEventListener(name, callback, { signal: events.signal, ...extra });
  }
  listen('pointerdown', (event) => {
    if (event.button !== 0) return;
    const point = position(event);
    if (!pointers.size && !unproject(point.x, point.y)) return;
    pointers.set(event.pointerId, point);
    canvas.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      pinch = { initial: Math.max(1, separation()), zoom: view.zoom };
      drag = null;
    } else if (pointers.size === 1) {
      drag = { point, moved: false, start: point };
      canvas.style.cursor = 'grabbing';
    }
  });
  listen('pointermove', (event) => {
    const point = position(event);
    if (!pointers.has(event.pointerId)) {
      canvas.style.cursor = unproject(point.x, point.y) ? cursor : 'default';
      return;
    }
    pointers.set(event.pointerId, point);
    if (pinch && pointers.size === 2) {
      setView(view.lat, view.lon, (pinch.zoom * separation()) / pinch.initial);
    } else if (drag && pointers.size === 1) {
      const dx = point.x - drag.point.x,
        dy = point.y - drag.point.y;
      if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 4) drag.moved = true;
      if (drag.moved) {
        const speed = 65 / (layout.radius * view.zoom);
        setView(
          view.lat + dy * speed,
          view.lon - (dx * speed) / Math.max(0.48, Math.cos(view.lat * RAD)),
        );
        drag.point = point;
      }
    }
  });
  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    const point = position(event);
    if (event.type === 'pointerup' && drag && !pinch && !drag.moved) {
      const picked = unproject(point.x, point.y);
      if (picked) options.onPick?.(picked);
    }
    pointers.delete(event.pointerId);
    drag = null;
    if (!pointers.size) {
      pinch = null;
      canvas.style.cursor = cursor;
    }
  }
  listen('pointerup', endPointer);
  listen('pointercancel', endPointer);
  listen(
    'wheel',
    (event) => {
      const point = position(event);
      if (!unproject(point.x, point.y)) return;
      event.preventDefault();
      const distance = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      setView(view.lat, view.lon, view.zoom * Math.exp(-distance * 0.0014));
    },
    { passive: false },
  );
  listen('keydown', (event) => {
    const step = 7 / view.zoom;
    const actions = {
      ArrowLeft: () => setView(view.lat, view.lon - step),
      ArrowRight: () => setView(view.lat, view.lon + step),
      ArrowUp: () => setView(view.lat + step, view.lon),
      ArrowDown: () => setView(view.lat - step, view.lon),
      '+': () => setView(view.lat, view.lon, view.zoom * 1.2),
      '=': () => setView(view.lat, view.lon, view.zoom * 1.2),
      '-': () => setView(view.lat, view.lon, view.zoom / 1.2),
      Enter: () => options.onPick?.({ lat: view.lat, lon: view.lon }),
    };
    if (actions[event.key]) {
      event.preventDefault();
      actions[event.key]();
    }
  });
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
  if (!canvas.hasAttribute('aria-label'))
    canvas.setAttribute(
      'aria-label',
      'Interactive Earth. Use arrow keys to rotate, plus or minus to zoom, and Enter to select the center.',
    );
  canvas.style.touchAction = 'none';
  const resizeObserver = new ResizeObserver(invalidate);
  resizeObserver.observe(canvas);
  dimensions();
  const ready = loadImage('earth.jpg').then((image) => {
    satellite = image;
    renderer.setSatellite(image);
    invalidate();
  });
  loadImage('bathy.jpg')
    .then((image) => {
      if (disposed) return;
      shade = image;
      renderer.setShade(image);
      invalidate();
    })
    .catch(() => {});
  loadImage('clouds.jpg')
    .then((image) => {
      if (disposed) return;
      clouds = image;
      renderer.setClouds(image);
      invalidate();
    })
    .catch(() => {});
  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      if (clouds) renderer.setClouds(clouds);
      if (satellite) renderer.setSatellite(satellite);
      if (shade) renderer.setShade(shade);
      if (terrain) renderer.setTerrain(terrain);
      if (floors) renderer.setFloors(floors, terrain.width, terrain.height);
      invalidate();
    },
    { signal: events.signal },
  );
  invalidate();
  return {
    ready,
    project,
    unproject,
    setView,
    invalidate,
    setLayout(values) {
      fixedLayout = values;
      dimensions();
      invalidate();
    },
    get layout() {
      return { ...layout, radius: layout.radius * view.zoom };
    },
    get view() {
      return { ...view };
    },
    setTerrain(data) {
      terrain = data;
      renderer.setTerrain(data);
      invalidate();
    },
    setDrainage(data) {
      floors = data;
      if (terrain) renderer.setFloors(data, terrain.width, terrain.height);
      invalidate();
    },
    setLevel(meters) {
      level = Math.min(0, meters);
      invalidate();
    },
    setGrid(on) {
      grid = Boolean(on);
      invalidate();
    },
    setCursor(value = 'grab') {
      cursor = value;
      canvas.style.cursor = value;
    },
    zoomBy(factor) {
      setView(view.lat, view.lon, view.zoom * factor);
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      events.abort();
      renderer.destroy?.();
    },
  };
}
