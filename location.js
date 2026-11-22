import { marineAreas } from './assets/marine-areas.js';

function containsPoint(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const [xi, yi] = [ring[i], ring[i + 1]];
    const [xj, yj] = [ring[j], ring[j + 1]];
    if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Look up a named marine area, retaining the coordinates for unmapped coasts or inland water. */
export function locationName(lat, lon) {
  const x = ((lon + 180) % 360 + 360) % 360 - 180;
  for (const [name, [west, south, east, north], rings] of marineAreas) {
    if (x < west || x > east || lat < south || lat > north) continue;
    if (!containsPoint(rings[0], x, lat)) continue;
    if (rings.slice(1).some(hole => containsPoint(hole, x, lat))) continue;
    return name;
  }
  return `${Math.abs(lat).toFixed(1)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(x).toFixed(1)}° ${x < 0 ? 'W' : 'E'}`;
}
