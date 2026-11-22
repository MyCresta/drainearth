"""Build browser data from GMT's pixel-registered SRTM15+ v2.7.
Usage: python3 tools/build-spills.py CACHE_DIR OUTPUT_DIR
Requires GDAL command-line tools, C++17 and internet access for uncached tiles.
"""
import gzip
import math
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.request import urlopen
from urllib.parse import urlencode

cache, output = [Path(arg).resolve() for arg in sys.argv[1:]]
cache.mkdir(parents=True, exist_ok=True)
output.mkdir(parents=True, exist_ok=True)
# Bounds in degrees, aligned to the global 3′ grid. Windows include the entire
# passage and both mouths, replacing smoothed cells with the published 15″ DEM.
windows = [
    (-6.6, 35.5, -5.0, 36.5),      # Gibraltar
    (25.5, 39.7, 30.0, 41.6),     # Dardanelles, Marmara and Bosporus
    (41.0, 12.0, 44.5, 15.5),     # Bab el Mandeb and Hanish sill
    (54.5, 25.4, 58.0, 27.3),     # Strait of Hormuz
    (8.0, 54.25, 13.5, 58.0),     # Danish straits
    (10.5, 35.0, 14.0, 38.0),     # Sicily Channel
]

def cmd(*args):
    subprocess.run([str(a) for a in args], check=True)

def tile(res, x, y):
    key = f"{'S' if y<0 else 'N'}{abs(y):02d}{'W' if x<0 else 'E'}{abs(x):03d}.earth_relief_{res}_p.jp2"
    path = cache/key
    if not path.exists():
        url = f"https://oceania.generic-mapping-tools.org/server/earth/earth_relief/earth_relief_{res}_p/{key}"
        with urlopen(url) as src, path.with_suffix('.part').open('wb') as dst:
            shutil.copyfileobj(src, dst)
        path.with_suffix('.part').replace(path)
    return path

world = cache/'world.vrt'
global_tiles = [tile('03m',x,y) for x in range(-180,180,90) for y in (-90,0)]
cmd('gdalbuildvrt','-q','-overwrite',world,*global_tiles)
cmd('gdal_translate','-q','-of','ENVI',world,cache/'global.bin')
patches = []
for i,(west,south,east,north) in enumerate(windows):
    vrt, raw = cache/f'window{i}.vrt', cache/f'window{i}.bin'
    x,y,w,h = [round(v*20) for v in (west+180,90-north,east-west,north-south)]
    if i in (0,5):
        # EMODnet's regional DTM preserves the Gibraltar and Sicily sills.
        dtm = cache/f'emodnet-{i}.tif'
        if not dtm.exists():
            params = dict(service='wcs',version='1.0.0',request='getcoverage',
                          coverage='emodnet:mean',crs='EPSG:4326',BBOX=','.join(str(v) for v in (west,south,east,north)),
                          format='image/tiff',interpolation='nearest',width=w*12,height=h*12)
            with urlopen('https://ows.emodnet-bathymetry.eu/wcs?'+urlencode(params)) as src, dtm.open('wb') as dst:
                shutil.copyfileobj(src,dst)
        # The builder accepts raw elevations in half meters, matching GMT JP2 storage.
        cmd('gdal_translate','-q','-of','ENVI','-ot','Int16','-scale',0,1,0,2,dtm,raw)
    else:
        parts = [tile('15s',lon,lat)
                 for lon in range(10*math.floor(west/10),math.ceil(east),10)
                 for lat in range(10*math.floor(south/10),math.ceil(north),10)]
        cmd('gdalbuildvrt','-q','-overwrite',vrt,*parts)
        cmd('gdal_translate','-q','-of','ENVI','-projwin',west,north,east,south,vrt,raw)
    assert raw.stat().st_size == w*h*12*12*2
    patches.append(f'{x} {y} {w} {h} {raw}')
specs = cache/'windows.txt'
specs.write_text('\n'.join(patches))
builder = cache/'build-tree'
cmd('c++','-std=c++17','-O3',Path(__file__).with_name('spill-network.cpp'),'-o',builder)
# Deep-water anchors, lon/lat on either side, then negative measured sill (m).
# Observational references and vertical-datum limits are in EARTH-DATA.md.
gateways = cache/'surveyed-gateways.txt'
gateways.write_text('25.8 39.9 27.8 40.7 -65\n'  # Dardanelles: Aegean to Marmara
                    '28.9 40.9 29.25 41.35 -35\n' # Bosporus: Marmara to Black Sea
                    '42.0 14.95 43.9 12.35 -137\n') # Red Sea to Gulf of Aden
cmd(builder,cache/'global.bin',specs,gateways,output/'terrain.bin',cache/'spills.bin')
with (cache/'spills.bin').open('rb') as src, (output/'spills.gz').open('wb') as destination:
    with gzip.GzipFile(fileobj=destination,mode='wb',mtime=0) as encoded:
        shutil.copyfileobj(src,encoded)
