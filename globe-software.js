// Canvas projection keeps the same experiment usable when a GPU context is unavailable.
const clamp = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
const txWidth = 2048,
  txHeight = 1024;
function pixels(image) {
  const c = document.createElement('canvas');
  c.width = txWidth;
  c.height = txHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, txWidth, txHeight);
  return ctx.getImageData(0, 0, txWidth, txHeight).data;
}
export function createCanvasSurface(original, needsOverlay) {
  let canvas = original;
  if (needsOverlay) {
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
    original.after(canvas);
  }
  const ctx = canvas.getContext('2d');
  let sat, shade, clouds, terrain, floors;
  const gamma = Array.from({ length: 256 }, (_, i) => Math.pow(i / 255, 0.79) * 255);
  let image,
    oldKey = '',
    normals,
    illumination;
  return {
    setSatellite(im) {
      sat = pixels(im);
    },
    setShade(im) {
      shade = pixels(im);
    },
    setClouds(im) {
      clouds = pixels(im);
    },
    setTerrain(data) {
      terrain = data;
    },
    setFloors(data) {
      floors = data;
    },
    render({ layout, axes, zoom, level, grid }) {
      const scale = Math.min(1.4, devicePixelRatio || 1, 935 / (2 * layout.radius));
      const w = Math.max(1, Math.round(layout.width * scale)),
        h = Math.max(1, Math.round(layout.height * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const cx = layout.cx * scale,
        cy = layout.cy * scale,
        r = layout.radius * zoom * scale;
      const margin = Math.ceil(r * 1.085);
      const x0 = Math.max(0, Math.floor(cx - margin)),
        y0 = Math.max(0, Math.floor(cy - margin));
      const width = Math.min(w, Math.ceil(cx + margin)) - x0,
        height = Math.min(h, Math.ceil(cy + margin)) - y0;
      if (width <= 0 || height <= 0) return;
      const key = [w, h, r, cx, cy].join();
      if (key !== oldKey) {
        ctx.clearRect(0, 0, w, h);
        oldKey = key;
        image = ctx.createImageData(width, height);
        normals = new Float32Array(width * height * 3);
        illumination = new Float32Array(width * height * 2);
        for (let y = 0, i = 0; y < height; y++)
          for (let x = 0; x < width; x++, i++) {
            const a = (x + x0 + 0.5 - cx) / r,
              b = (cy - y - y0 - 0.5) / r,
              d = a * a + b * b;
            const z = d <= 1 ? Math.sqrt(1 - d) : -1;
            normals[i * 3] = a;
            normals[i * 3 + 1] = b;
            normals[i * 3 + 2] = z;
            const light = smooth(-0.67, 0.79, (-0.69 * a + 0.63 * b + 0.65 * z) / 1.138);
            illumination[i * 2] = light;
            const sun = smooth(-0.75, 0.85, (-0.65 * a + 0.76 * b) / Math.max(0.001, Math.sqrt(d)));
            illumination[i * 2 + 1] = sun;
            if (z < 0) {
              const dist = (Math.sqrt(d) - 1) * layout.radius * zoom;
              const alpha =
                Math.exp(-dist / Math.max(1.4, layout.radius * zoom * 0.009)) * (0.105 + 0.4 * sun) +
                Math.exp(-dist / Math.max(4, layout.radius * zoom * 0.026)) * 0.085 * sun;
              image.data.set(
                [lerp(41, 87, sun), lerp(110, 178, sun), lerp(171, 255, sun), 255 * alpha],
                i * 4,
              );
            }
          }
      }
      const [E, N, F] = axes;
      for (let i = 0, k = 0, t = 0; i < width * height; i++, k += 3, t += 4) {
        const a = normals[k],
          b = normals[k + 1],
          z = normals[k + 2];
        if (z < 0) continue;
        const nx = a * E[0] + b * N[0] + z * F[0],
          ny = a * E[1] + b * N[1] + z * F[1];
        const lat = Math.asin(Math.max(-1, Math.min(1, a * E[2] + b * N[2] + z * F[2])));
        const lon = Math.atan2(ny, nx);
        const u = Math.min(0.9999999, 0.5 + lon / (2 * Math.PI)),
          v = Math.min(0.9999999, 0.5 - lat / Math.PI);
        const j = (((v * txHeight) | 0) * txWidth + ((u * txWidth) | 0)) * 4;
        const index = terrain
          ? ((v * terrain.height) | 0) * terrain.width + ((u * terrain.width) | 0)
          : 0;
        const ground = terrain?.elevation[index] ?? -3000,
          surface = floors ? Math.max(level, floors[index]) : 0;
        const hs = (shade ? shade[j] / 255 : 0.5) - 0.5;
        const sr = sat?.[j] ?? 24,
          sg = sat?.[j + 1] ?? 66,
          sb = sat?.[j + 2] ?? 125;
        const waterSignal = sb - Math.max(sr * 1.18, sg * 1.12);
        const waterImage = smooth(2, 15, waterSignal);
        const originalWater = terrain
          ? Boolean(terrain.ocean ? terrain.ocean[index] : ground < 0)
          : waterImage;
        const wet = lerp(
          Number(originalWater),
          waterImage,
          0.92 * (1 - smooth(30, 320, Math.abs(ground))),
        );
        let red = gamma[sr] * 1.05 * (1 + hs * 0.41),
          green = gamma[sg] * 1.055 * (1 + hs * 0.41),
          blue = gamma[sb] * 1.025 * (1 + hs * 0.41);
        if (wet > 0) {
          const depth = Math.max(0, surface - ground),
            shelf = smooth(0, 470, depth),
            deep = smooth(470, 5600, depth),
            m = 1 + hs * 0.96;
          if (floors && level < -0.5 && surface > level + 1) {
            const retained = smooth(0, 2000, depth);
            red = lerp(red, lerp(64, 19, retained) * m, wet);
            green = lerp(green, lerp(156, 82, retained) * m, wet);
            blue = lerp(blue, lerp(135, 79, retained) * m, wet);
          } else {
            red = lerp(red, (lerp(lerp(22, 17, shelf), 9, deep) + sr * 0.22) * m, wet);
            green = lerp(green, (lerp(lerp(99, 63, shelf), 34, deep) + sg * 0.27) * m, wet);
            blue = lerp(blue, (lerp(lerp(120, 96, shelf), 60, deep) + sb * 0.31) * m, wet);
          }
        }
        if (level < -0.5 && floors && originalWater && surface <= ground) {
          const deep = smooth(0, 6000, -ground),
            m = 1 + hs * 1.35;
          red = lerp(176, 110, deep) * m;
          green = lerp(161, 92, deep) * m;
          blue = lerp(125, 77, deep) * m;
        }
        const light = illumination[i * 2],
          sun = illumination[i * 2 + 1];
        red *= lerp(0.4, 1.07, light);
        green *= lerp(0.45, 1.08, light);
        blue *= lerp(0.53, 1.085, light);
        if (clouds) {
          const opacity =
            smooth(0.14, 0.91, clouds[j] / 255) * 0.36 * Math.max(0.1, 1 - Math.abs(level) / 350);
          red = lerp(red, lerp(97, 224, light), opacity);
          green = lerp(green, lerp(120, 240, light), opacity);
          blue = lerp(blue, lerp(140, 250, light), opacity);
        }
        if (grid) {
          const spacing = Math.PI / 12,
            dx = Math.abs(lon - Math.round(lon / spacing) * spacing) * Math.max(0.06, Math.cos(lat));
          const dy = Math.abs(lat - Math.round(lat / spacing) * spacing);
          const line =
            (1 - smooth(0, 1.25 / Math.max(0.3, z) / r, Math.min(dx, dy))) *
            0.106 *
            smooth(0.03, 0.3, z);
          red = lerp(red, 168, line);
          green = lerp(green, 217, line);
          blue = lerp(blue, 232, line);
        }
        const rim = Math.pow(1 - z, 4.2) * (0.26 + 0.45 * sun);
        image.data[t] = lerp(red, lerp(36, 107, sun), rim);
        image.data[t + 1] = lerp(green, lerp(77, 176, sun), rim);
        image.data[t + 2] = lerp(blue, lerp(99, 225, sun), rim);
        image.data[t + 3] = 255;
      }
      ctx.putImageData(image, x0, y0);
    },
    destroy() {
      if (needsOverlay) canvas.remove();
    },
  };
}
