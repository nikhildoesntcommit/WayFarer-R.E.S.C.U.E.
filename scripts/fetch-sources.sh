#!/usr/bin/env bash
# Downloads every source used by scripts/prepare-data.mjs into <dir> (default ./data-src).
# Downloaded files are untrusted data: nothing in them is ever executed.
#
#   bash scripts/fetch-sources.sh ./data-src
#   node scripts/extract-natural-earth.mjs <dir containing ne_50m_admin_0_countries.geojson + ne_50m_admin_1_states_provinces.geojson>   # admin-1 states
#   node scripts/prepare-data.mjs ./data-src
#
# FULL-RESOLUTION TIER (the specification's §3 list). These hosts were unreachable from the build sandbox, so the
# shipped data is the fallback tier. On a machine with open internet you can upgrade it by hand:
#   population : https://data.worldpop.org/GIS/Population/Global_2000_2020_1km/2020/IND/ind_ppp_2020_1km_Aggregated.tif
#   elevation  : Copernicus GLO-90 DEM tiles (https://registry.opendata.aws/copernicus-dem/)
#   roads      : https://download.geofabrik.de/asia/india-latest.osm.pbf  (highway=trunk|primary|secondary|tertiary)
#   shelters   : OSM Overpass, amenity=school|community_centre|hospital inside the India bounding box
#   rivers     : HydroRIVERS v10 (https://www.hydrosheds.org/products/hydrorivers), order >= 4
# and replace the corresponding blocks of prepare-data.mjs (the output file formats stay the same).
set -euo pipefail
D="${1:-./data-src}"
RAW=https://raw.githubusercontent.com
mkdir -p "$D/ne" "$D/ne-ind" "$D/census" "$D/districts" "$D/topo"
curl -fsSL -o "$D/topo/topo10.nc" https://github.com/fatiando-data/earth-topography-10arcmin/releases/download/v1/earth-topography-10arcmin.nc
curl -fsSL -o "$D/ne/ne_10m_roads.geojson" "$RAW/nvkelso/natural-earth-vector/master/geojson/ne_10m_roads.geojson"
curl -fsSL -o "$D/ne/ne_10m_rivers_lake_centerlines.geojson" "$RAW/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson"
curl -fsSL -o "$D/ne/ne_10m_populated_places_simple.geojson" "$RAW/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson"
curl -fsSL -o "$D/ne-ind/ne_10m_admin_0_countries_ind.geojson" "$RAW/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ind.geojson"
curl -fsSL -o "$D/census/india-districts-census-2011.csv" "$RAW/nishusharma1608/India-Census-2011-Analysis/master/india-districts-census-2011.csv"
curl -fsSL -o "$D/districts/india_district.geojson" "$RAW/geohacker/india/master/district/india_district.geojson"
echo "sources in $D"
