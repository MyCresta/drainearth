# Earth imagery and elevations

All four assets use a global equirectangular grid. The west edge is 180° W, the north edge is 90° N, and rows progress south. Geolocations within raster cells refer to their centers.

| Asset | Source and processing |
| --- | --- |
| `dist/assets/earth.jpg` | NASA Earth Observatory, Blue Marble Next Generation, August 2004 composite with topographic and bathymetric shading. The original 5400 × 2700 JPEG was resampled to 4096 × 2048. [NASA catalog](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/) · [Original image](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/august/world.topo.bathy.200408.3x5400x2700.jpg) |
| `dist/assets/clouds.jpg` | NASA Earth Observatory, The Blue Marble (2002), global cloud composite. The 2048 × 1024 image was converted to grayscale. It combines satellite observations spanning several days. [NASA catalog](https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/) · [Original image](https://assets.science.nasa.gov/content/dam/science/esd/eo/content-feature/bluemarble/images/cloud_combined_2048.jpg) |
| `dist/assets/terrain.bin` | SRTM15+ v2.7 via Generic Mapping Tools. The pixel-registered 15 arc-minute raster has 1440 columns and 720 rows. GDAL applied the source scale factor (0.5 m per stored unit) and rounded to meters. Raw signed 16-bit little-endian integers, row-major, no header or missing values. [Elevation dataset](https://doi.org/10.1029/2019EA000658) · [GMT source grid](https://oceania.generic-mapping-tools.org/server/earth/earth_relief/earth_relief_15m_p.grd) |
| `dist/assets/bathy.jpg` | Visualization-only hillshade from the pixel-registered GMT 3 arc-minute SRTM15+ tiles. The tiles were mosaicked, averaged to 4096 × 2048, and illuminated from the northwest. Vertical exaggeration is 8× offshore and 2× on land. A level surface has a gray value of 128. [GMT source tiles](https://oceania.generic-mapping-tools.org/server/earth/earth_relief/earth_relief_03m_p/) |

The terrain model smooths local topography. Its 0.25° cell spans about 28 km north to south. Narrow passages can close prematurely or disappear entirely. The elevation extremes in this reduced grid are −9242 m and +5986 m.

Marine place names use Natural Earth's public-domain 1:50m geography marine polygons. The boundaries are simplified to 0.075° for regional labeling. Where named areas overlap, the more local mapped feature takes precedence. [Source polygons](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_geography_marine_polys.geojson) · [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/)
