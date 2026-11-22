const EARTH_RADIUS_KM = 6371.0088;

// Pixel edges span the full sphere. The first cell is at the northwest corner.
export function cellAt({ width, height }, latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return -1;
  const degreesEast = (((longitude + 180) % 360) + 360) % 360;
  const x = Math.min(width - 1, Math.floor((degreesEast * width) / 360));
  const y = Math.max(0, Math.min(height - 1, Math.floor(((90 - latitude) * height) / 180)));
  return y * width + x;
}

export async function loadTerrain(url, width, height) {
  const spillUrl = new URL('spills.gz', new URL(url, document.baseURI));
  const [elevationFile, spillFile] = await Promise.all([fetch(url), fetch(spillUrl)]);
  if (!elevationFile.ok || !spillFile.ok) throw new Error('Could not load the ocean model.');
  const [bytes, spillData] = await Promise.all([elevationFile.arrayBuffer(), spillFile.arrayBuffer()]);
  const signature = new Uint8Array(spillData, 0, Math.min(2, spillData.byteLength));
  const isGzip = signature[0] === 0x1f && signature[1] === 0x8b;
  const spillBytes = isGzip
    ? await new Response(
        new Blob([spillData]).stream().pipeThrough(new DecompressionStream('gzip')),
      ).arrayBuffer()
    : spillData;
  if (bytes.byteLength !== width * height * 2) throw new Error('Unexpected elevation grid size.');
  return createTerrain(new Int16Array(bytes), width, height, spillBytes);
}

export function createTerrain(elevation, width, height, spillBytes) {
  const count = width * height;
  const header = new Int32Array(spillBytes, 4, 4);
  if (
    new DataView(spillBytes).getUint32(0) !== 0x53504c31 ||
    header[0] !== width ||
    header[1] !== height ||
    spillBytes.byteLength !== 20 + count * 6 ||
    elevation.length !== count
  )
    throw new Error('Unexpected spill network dimensions.');
  const root = header[2],
    oceanCount = header[3];
  const parent = new Int32Array(spillBytes, 20, count);
  const sill = new Int16Array(spillBytes, 20 + count * 4, count);
  const ocean = new Uint8Array(count);
  const head = new Int32Array(count),
    next = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    if (sill[i] === 32767) continue; // Present-day land or an isolated inland depression.
    ocean[i] = 1;
    parent[i] += i; // The on-disk parent index is relative.
    if (i !== root) {
      next[i] = head[parent[i]];
      head[parent[i]] = i + 1;
    }
  }
  // Parents precede children. This ordering is shared by every plug selection.
  const order = new Int32Array(oceanCount);
  order[0] = root;
  let used = 1;
  for (let i = 0; i < used; i++) {
    for (let link = head[order[i]]; link; link = next[link - 1]) order[used++] = link - 1;
  }
  if (used !== oceanCount) throw new Error('Incomplete spill network.');
  const rowArea = new Float64Array(height);
  const longitudeSpan = (2 * Math.PI) / width;
  for (let y = 0; y < height; y++) {
    const north = Math.PI * (0.5 - y / height);
    const south = Math.PI * (0.5 - (y + 1) / height);
    rowArea[y] = EARTH_RADIUS_KM ** 2 * longitudeSpan * (Math.sin(north) - Math.sin(south));
  }
  return { width, height, elevation, ocean, rowArea, parent, sill, root, order };
}

export function computeDrainage(terrain, plugIndex) {
  const { elevation, width, ocean, rowArea, parent, sill, root, order } = terrain;
  if (!Number.isInteger(plugIndex) || ocean[plugIndex] !== 1) {
    throw new RangeError('Place the plug in a connected ocean cell.');
  }
  const plugDepth = -elevation[plugIndex];
  const floor = new Int16Array(elevation.length);
  // The maximum edge height on a minimum-spanning-tree path is the lowest
  // possible saddle between the two sites in the original bathymetry graph.
  // Seed the plug-to-root branch, then sweep outward into all its side branches.
  floor[plugIndex] = -plugDepth;
  for (let i = plugIndex; i !== root; i = parent[i]) {
    floor[parent[i]] = Math.max(floor[i], sill[i]);
  }
  for (const i of order) {
    if (floor[i] === 0) floor[i] = Math.max(floor[parent[i]], sill[i]);
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
    removedKm3: removedVolume[band] + ((drop - band) * activeArea[band]) / 1000,
    oceanKm2,
    exposedPercent: (100 * exposedKm2) / oceanKm2,
  };
}
