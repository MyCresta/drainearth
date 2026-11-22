import { createCanvasSurface } from './globe-software.js';

const vertexSource = `
attribute vec2 a_position;
varying vec2 v_sphere;
uniform vec2 u_origin;
uniform vec2 u_extent;
void main() {
  v_sphere = a_position * 1.085;
  gl_Position = vec4(u_origin + v_sphere * u_extent, 0., 1.);
}`;

const fragmentSource = `
precision highp float;
varying vec2 v_sphere;
uniform vec3 u_east, u_north, u_front;
uniform vec2 u_terrain_size;
uniform sampler2D u_earth, u_terrain, u_floor, u_shade, u_clouds;
uniform float u_radius, u_level, u_grid, u_has_terrain, u_has_floors;
const float PI = 3.14159265;
float elevation(vec4 packedHeight) { return packedHeight.r * 65280. + packedHeight.g * 255. - 32768.; }
void main() {
  vec2 p = v_sphere;
  float rr = dot(p, p);
  float r = sqrt(rr);
  float edge = 1. / u_radius;
  float orientation = dot(p / max(r, .001), vec2(-.65, .76));
  float sunward = smoothstep(-.75, .85, orientation);
  if (r > 1.) {
    float d = (r - 1.) * u_radius;
    float haze = exp(-d / max(1.4, u_radius * .009)) * (.105 + .4 * sunward)
               + exp(-d / max(4., u_radius * .026)) * .085 * sunward;
    if (haze < .003) discard;
    vec3 hue = mix(vec3(.16, .43, .67), vec3(.34, .7, 1.), sunward);
    gl_FragColor = vec4(hue, haze);
    return;
  }
  float z = sqrt(max(0., 1.-rr));
  vec3 normal = normalize(u_east * p.x + u_north * p.y + u_front * z);
  float lon = atan(normal.y, normal.x);
  float lat = asin(clamp(normal.z, -1., 1.));
  vec2 uv = vec2(.5 + lon / (2.*PI), .5 - lat / PI);
  vec3 satellite = texture2D(u_earth, uv).rgb;
  vec2 cellUV = (floor(uv * u_terrain_size) + .5) / max(u_terrain_size, vec2(1.));
  vec4 heights = texture2D(u_terrain, uv);
  vec4 cell = texture2D(u_terrain, cellUV);
  float ground = elevation(heights);
  float hshade = texture2D(u_shade, uv).r - .5;
  float signal = satellite.b - max(satellite.r * 1.18, satellite.g * 1.12);
  float oceanImage = smoothstep(.008, .06, signal);
  float originalOcean = u_has_terrain > .5 ? heights.a : oceanImage;
  float modelOcean = u_has_terrain > .5 ? step(.5, cell.a) : oceanImage;
  float coastBlend = 1. - smoothstep(30., 320., abs(ground));
  float water = mix(originalOcean, oceanImage, coastBlend * .92);
  vec3 land = pow(satellite, vec3(.79)) * vec3(1.05, 1.055, 1.025);
  land *= 1. + hshade * .41;
  float depth = max(0., -ground);
  if (u_has_terrain < .5) depth = 3000.;
  float surface = 0.;
  if (u_has_floors > .5) surface = max(u_level, elevation(texture2D(u_floor, cellUV)));
  float dry = 0.;
  if (u_level < -.5 && u_has_floors > .5) {
    float exposed = smoothstep(surface - 5., surface + .01, ground + 1.);
    dry = modelOcean * exposed * smoothstep(.5, 5., -u_level);
    depth = max(0., surface - ground);
  }
  vec3 shelf = vec3(.085, .39, .47);
  vec3 slope = vec3(.067, .249, .378);
  vec3 deep = vec3(.034, .133, .235);
  vec3 waterColor = mix(shelf, slope, smoothstep(0., 470., depth));
  waterColor = mix(waterColor, deep, smoothstep(470., 5600., depth));
  waterColor += satellite * vec3(.22, .27, .31);
  if (modelOcean > .5 && u_level < -.5 && surface > u_level + 1.) {
    vec3 trapped = mix(vec3(.25,.61,.53), vec3(.073,.32,.31), smoothstep(0.,2000.,depth));
    waterColor = mix(waterColor, trapped, .82);
  }
  waterColor *= 1. + hshade * .96;
  vec3 rock = mix(vec3(.69, .63, .49), vec3(.43, .36, .30), smoothstep(0., 6000., -ground));
  rock *= 1. + hshade * 1.35;
  float band = 1.-smoothstep(.0, .04, abs(fract(ground/500.+.5)-.5));
  rock *= 1.-.045 * band;
  vec3 color = mix(land, waterColor, water);
  color = mix(color, rock, dry);

  float key = dot(vec3(p, z), normalize(vec3(-.69,.63,.65)));
  float daylight = smoothstep(-.67, .79, key);
  color *= mix(vec3(.40,.45,.53),vec3(1.07,1.08,1.085),daylight);
  float cloud = texture2D(u_clouds, uv).r;
  float cloudOpacity = smoothstep(.14,.91,cloud) * .36 * max(.1, 1. - abs(u_level) / 350.);
  color = mix(color, mix(vec3(.38,.47,.55),vec3(.88,.94,.98),daylight), cloudOpacity);
  if (u_grid > .5) {
    vec2 angle = vec2(lon,lat);
    vec2 dist = abs(fract(angle / (PI/12.) + .5) - .5) * (PI/12.);
    dist.x *= max(.06,cos(lat));
    float line = 1. - smoothstep(0., edge * 1.25 / max(.3,z), min(dist.x,dist.y));
    color = mix(color, vec3(.66,.85,.91), line * .106 * smoothstep(.03,.3,z));
  }
  float rim = pow(1.-z, 4.2);
  color = mix(color, mix(vec3(.14,.30,.39), vec3(.42,.69,.88), sunward),
              rim * (.26 + .45 * sunward));
  color += vec3(.16,.29,.38) * exp(-(1.-r) * u_radius * .66) * (.15 + .85 * sunward);
  gl_FragColor = vec4(color, 1.);
}`;

function shader(gl, type, source) {
  const obj = gl.createShader(type);
  gl.shaderSource(obj, source);
  gl.compileShader(obj);
  if (!gl.getShaderParameter(obj, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(obj));
  return obj;
}

function buildGL(canvas, gl) {
  let program, buffer, uniforms, textures, drawLocation;
  let hasTerrain = false,
    hasFloors = false,
    lost = false;
  function setup() {
    const vs = shader(gl, gl.VERTEX_SHADER, vertexSource),
      fs = shader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    uniforms = {};
    for (const name of [
      'terrain_size',
      'origin',
      'extent',
      'radius',
      'east',
      'north',
      'front',
      'earth',
      'terrain',
      'floor',
      'shade',
      'clouds',
      'has_terrain',
      'has_floors',
      'level',
      'grid',
    ]) {
      uniforms[name] = gl.getUniformLocation(program, 'u_' + name);
    }
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    drawLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(drawLocation);
    gl.vertexAttribPointer(drawLocation, 2, gl.FLOAT, false, 0, 0);
    const names = ['earth', 'terrain', 'floor', 'shade', 'clouds'];
    const pixels = [
      [18, 54, 78, 255],
      [128, 0, 0, 255],
      [128, 0, 0, 255],
      [128, 128, 128, 255],
      [0, 0, 0, 255],
    ];
    textures = names.map((name, index) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(pixels[index]),
      );
      gl.uniform1i(uniforms[name], index);
      return t;
    });
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.clearColor(0, 0, 0, 0);
    lost = false;
    hasTerrain = false;
    hasFloors = false;
  }
  setup();
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', setup);
  function select(i) {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, textures[i]);
  }
  function uploadImage(index, image) {
    if (lost) return;
    select(index);
    const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (image.width > limit || image.height > limit) {
      const small = document.createElement('canvas');
      const scale = Math.min(limit / image.width, limit / image.height);
      small.width = Math.round(image.width * scale);
      small.height = Math.round(image.height * scale);
      small.getContext('2d').drawImage(image, 0, 0, small.width, small.height);
      image = small;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    const pot = (n) => (n & (n - 1)) === 0;
    if (pot(image.width) && pot(image.height)) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    }
  }
  function uploadHeights(index, heights, ocean, width, height) {
    if (lost) return;
    const bytes = new Uint8Array(width * height * 4);
    for (let i = 0, j = 0; i < heights.length; i++, j += 4) {
      const h = heights[i] + 32768;
      bytes[j] = h >> 8;
      bytes[j + 1] = h & 255;
      bytes[j + 3] = ocean ? (ocean[i] ? 255 : 0) : heights[i] < 0 ? 255 : 0;
    }
    select(index);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  }
  return {
    setSatellite(image) {
      uploadImage(0, image);
    },
    setShade(image) {
      uploadImage(3, image);
    },
    setClouds(image) {
      uploadImage(4, image);
    },
    setTerrain({ elevation, ocean, width, height }) {
      if (!lost) gl.uniform2f(uniforms.terrain_size, width, height);
      uploadHeights(1, elevation, ocean, width, height);
      hasTerrain = true;
    },
    setFloors(floors, width, height) {
      hasFloors = Boolean(floors);
      if (floors) uploadHeights(2, floors, null, width, height);
    },
    render({ layout, axes, zoom, level, grid }) {
      if (lost) return;
      const { width, height, cx, cy } = layout;
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(width * pixelRatio),
        h = Math.round(height * pixelRatio);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      const r = layout.radius * zoom;
      gl.uniform2f(uniforms.origin, (2 * cx) / width - 1, 1 - (2 * cy) / height);
      gl.uniform2f(uniforms.extent, (2 * r) / width, (2 * r) / height);
      gl.uniform1f(uniforms.radius, r);
      gl.uniform1f(uniforms.level, level);
      gl.uniform1f(uniforms.grid, grid ? 1 : 0);
      gl.uniform1f(uniforms.has_terrain, hasTerrain ? 1 : 0);
      gl.uniform1f(uniforms.has_floors, hasFloors ? 1 : 0);
      gl.uniform3fv(uniforms.east, axes[0]);
      gl.uniform3fv(uniforms.north, axes[1]);
      gl.uniform3fv(uniforms.front, axes[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    destroy() {
      textures.forEach((t) => gl.deleteTexture(t));
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}

export function createSurfaceRenderer(canvas) {
  const options = {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: 'low-power',
  };
  const gl = canvas.getContext('webgl', options);
  if (gl) {
    try {
      return buildGL(canvas, gl);
    } catch (error) {
      console.warn('Using software globe rendering.', error);
    }
  }
  return createCanvasSurface(canvas, Boolean(gl));
}
