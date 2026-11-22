const EARTH_RADIUS_KM = 6371.0088;

// Pixel edges span the full sphere. The first cell is at the northwest corner.
export function cellAt({ width, height }, latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return -1;
  const degreesEast = ((longitude + 180) % 360 + 360) % 360;
  const x = Math.min(width - 1, Math.floor(degreesEast * width / 360));
  const y = Math.max(0, Math.min(height - 1, Math.floor((90 - latitude) * height / 180)));
  return y * width + x;
}

export async function loadTerrain(url, width, height) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load the elevation grid.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== width * height * 2) throw new Error('Unexpected elevation grid size.');
  const data = new DataView(bytes);
  const elevations = new Int16Array(width * height);
  for (let i = 0; i < elevations.length; i++) elevations[i] = data.getInt16(i * 2, true);
  return createTerrain(elevations, width, height);
}

function visitNeighbors(index, width, count, visit) {
  const x = index % width;
  visit(x === 0 ? index + width - 1 : index - 1);
  visit(x === width - 1 ? index - width + 1 : index + 1);
  if (index >= width) visit(index - width);
  if (index < count - width) visit(index + width);
}

export function createTerrain(elevation, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      !(elevation instanceof Int16Array) || elevation.length !== width * height) {
    throw new Error('Invalid elevation grid.');
  }
  // Below-datum land depressions can look like ocean by depth alone. Only the
  // largest four-connected patch of negative cells participates in drainage.
  const labels = new Int32Array(elevation.length);
  const queue = new Int32Array(elevation.length);
  let label = 0;
  let largest = 0;
  let largestSize = 0;
  let tail = 0;
  function enqueue(index) {
    if (labels[index] || elevation[index] >= 0) return;
    labels[index] = label;
    queue[tail++] = index;
  }
  for (let i = 0; i < elevation.length; i++) {
    if (labels[i] || elevation[i] >= 0) continue;
    label++;
    tail = 0;
    enqueue(i);
    for (let head = 0; head < tail; head++) {
      visitNeighbors(queue[head], width, elevation.length, enqueue);
    }
    if (tail > largestSize) {
      largestSize = tail;
      largest = label;
    }
  }
  const ocean = new Uint8Array(elevation.length);
  if (largestSize) {
    for (let i = 0; i < ocean.length; i++) ocean[i] = Number(labels[i] === largest);
  }
  const rowArea = new Float64Array(height);
  const longitudeSpan = 2 * Math.PI / width;
  for (let y = 0; y < height; y++) {
    const north = Math.PI * (0.5 - y / height);
    const south = Math.PI * (0.5 - (y + 1) / height);
    rowArea[y] = EARTH_RADIUS_KM ** 2 * longitudeSpan * (Math.sin(north) - Math.sin(south));
  }
  return { width, height, elevation, ocean, rowArea };
}

export function computeDrainage(terrain, plugIndex) {
  const { elevation, width, ocean, rowArea } = terrain;
  if (!Number.isInteger(plugIndex) || ocean[plugIndex] !== 1) {
    throw new RangeError('Place the plug in a connected ocean cell.');
  }
  const plugDepth = -elevation[plugIndex];
  const floor = new Int16Array(elevation.length);
  // For every cell, find the lowest possible maximum bed elevation on any path
  // to the plug. That saddle is the waterline at which the cell loses access.
  // Integer elevations permit a monotone bucket queue. Store a cell index + 1
  // in each link so the typed arrays' initial zero can represent an empty list.
  const heads = new Int32Array(plugDepth + 1);
  const next = new Int32Array(elevation.length);
  let waterline = -plugDepth;
  floor[plugIndex] = waterline;
  heads[0] = plugIndex + 1;
  function visit(index) {
    if (!ocean[index] || floor[index] !== 0) return;
    const saddle = Math.max(waterline, elevation[index]);
    const bucket = saddle + plugDepth;
    // Every later predecessor has a waterline at least this high.
    floor[index] = saddle;
    next[index] = heads[bucket];
    heads[bucket] = index + 1;
  }
  for (let bucket = 0; bucket < heads.length; bucket++) {
    waterline = bucket - plugDepth;
    while (heads[bucket]) {
      const index = heads[bucket] - 1;
      heads[bucket] = next[index];
      visitNeighbors(index, width, elevation.length, visit);
    }
  }

  // Integrate actual spherical cell areas into one-meter cutoff bands. The
  // slider reads a pair of bands instead of traversing a global grid per frame.
  const dryArea = new Float64Array(plugDepth + 1);
  const retainedArea = new Float64Array(plugDepth + 1);
  const activeArea = new Float64Array(plugDepth + 1);
  const removedVolume = new Float64Array(plugDepth + 1);
  let oceanKm2 = 0;
  for (let y = 0, i = 0; y < rowArea.length; y++) {
    const area = rowArea[y];
    for (let x = 0; x < width; x++, i++) {
      if (!ocean[i]) continue;
      const cutoff = -floor[i];
      oceanKm2 += area;
      activeArea[cutoff] += area;
      if (floor[i] === elevation[i]) dryArea[cutoff] += area;
      else retainedArea[cutoff] += area;
    }
  }
  activeArea[0] = oceanKm2;
  for (let d = 1; d <= plugDepth; d++) {
    dryArea[d] += dryArea[d - 1];
    retainedArea[d] += retainedArea[d - 1];
    removedVolume[d] = removedVolume[d - 1] + activeArea[d - 1] / 1000;
    activeArea[d] = Math.max(0, activeArea[d - 1] - activeArea[d]);
  }
  return { floor, plugIndex, plugDepth, oceanKm2, dryArea, retainedArea, activeArea, removedVolume };
}

export function getMetrics(model, requestedDrop) {
  const { plugDepth, oceanKm2, dryArea, activeArea, removedVolume, retainedArea } = model;
  const drop = Math.min(plugDepth, Math.max(0, Number(requestedDrop) || 0));
  const band = Math.floor(drop);
  const exposedKm2 = dryArea[band];
  const firstDisconnected = Math.max(0, Math.ceil(drop) - 1);
  return {
    drop,
    exposedKm2,
    retainedKm2: retainedArea[firstDisconnected],
    removedKm3: removedVolume[band] + (drop - band) * activeArea[band] / 1000,
    oceanKm2,
    exposedPercent: 100 * exposedKm2 / oceanKm2
  };
}
