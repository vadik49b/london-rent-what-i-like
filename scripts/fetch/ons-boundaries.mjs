// Fetches ward and borough boundaries for Greater London from the ONS Open Geography Portal
// (generalised 20m, December 2024). London local authority codes all start with E09.
import { readFileSync, writeFileSync } from "node:fs";

const api = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services";
const query = "where=LAD24CD LIKE 'E09%'&outFields=*&outSR=4326&geometryPrecision=5&f=geojson";
const layers = [
  {
    file: "ons-wards-london.json",
    title: "Ward boundaries in Greater London (December 2024, generalised)",
    service: "Wards_December_2024_Boundaries_UK_BGC",
    format:
      "GeoJSON FeatureCollection of Polygon/MultiPolygon in [lon,lat]; properties WD24CD, WD24NM, LAD24CD, LAD24NM, LAT, LONG, Shape__Area (m2)",
  },
  {
    file: "ons-boroughs-london.json",
    title: "Borough boundaries in Greater London (December 2024, generalised)",
    service: "Local_Authority_Districts_December_2024_Boundaries_UK_BGC",
    format:
      "GeoJSON FeatureCollection of Polygon/MultiPolygon in [lon,lat]; properties LAD24CD, LAD24NM, LAT, LONG, Shape__Area (m2)",
  },
];

let index = JSON.parse(readFileSync("data/index.json", "utf8"));

for (const layer of layers) {
  const url = `${api}/${layer.service}/FeatureServer/0/query`;
  const res = await fetch(`${url}?${encodeURI(query)}`, { headers: { "User-Agent": "london-rent-prototype" } });
  if (!res.ok) throw new Error(`ONS ${res.status} for ${layer.service}`);
  const text = await res.text();
  const json = JSON.parse(text);
  // ArcGIS reports errors and truncated results with HTTP 200
  if (!json.features?.length || json.properties?.exceededTransferLimit) throw new Error(`ONS ${layer.service}: ${text.slice(0, 200)}`);
  writeFileSync(`data/${layer.file}`, text);

  index = index.filter((e) => e.file !== layer.file);
  index.push({
    file: layer.file,
    title: layer.title,
    source: "ONS Open Geography Portal (ArcGIS FeatureServer)",
    url,
    query,
    fetched_at: new Date().toISOString(),
    method: "script",
    script: "scripts/fetch/ons-boundaries.mjs",
    format: layer.format,
    adapter: "ons-areas",
  });
  console.log(`${layer.file}: ${json.features.length} features`);
}

writeFileSync("data/index.json", JSON.stringify(index, null, 2) + "\n");
