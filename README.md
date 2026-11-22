# Pelagic

[Explore the fullscreen Earth on GitHub Pages](https://mycresta.github.io/drainearth/)

**Drain Plug** simulates a falling ocean over real seafloor terrain. Place a plug, move the sea-level slider and click a patch of water to inspect its local surface, bed elevation and depth. Basins retain water once a ridge cuts them off from the plug.

**Message in a Bottle** shows the first week of a recorded NOAA buoy journey. Place your guess and reveal where the buoy was on day 30.

The site is static and keeps its data, imagery and fonts in this repository. To run it locally, start `python3 -m http.server 8000` in the repository root and open `http://localhost:8000`. Run the drainage checks with `node tests/drainage.mjs` on Node.js 22.7 or later.

The globe uses fixed present-day topography. Its animation compresses time, and small straits remain sensitive to elevation errors. [Data sources, model benchmarks and rebuild instructions](EARTH-DATA.md)
