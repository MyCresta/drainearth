/** Coordinates in this module are [longitude, latitude] in degrees. */
export async function loadBottleRounds() {
  const response = await fetch(new URL('./assets/drifters.json', import.meta.url));
  if (!response.ok) throw new Error('Could not load the drifter archive.');
  const { rounds } = await response.json();
  return rounds;
}

export function bottleClue(round) {
  return round.track.slice(0, 8);
}

export function bottleResult(round, guess) {
  const target = round.track[30];
  const rad = Math.PI / 180;
  const [guessLon, guessLat] = guess;
  const [targetLon, targetLat] = target;
  const halfLat = (targetLat - guessLat) * rad / 2;
  const halfLon = (targetLon - guessLon) * rad / 2;
  const chord = Math.sin(halfLat) ** 2
    + Math.cos(guessLat * rad) * Math.cos(targetLat * rad) * Math.sin(halfLon) ** 2;
  const distance = 2 * 6371.0088 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, chord))));
  return {
    target,
    distanceKm: Math.round(distance),
    score: Math.round(1000 * Math.exp(-distance / 700)),
  };
}
