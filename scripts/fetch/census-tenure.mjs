// Fetches Census 2021 household tenure (TS054) in Greater London from Nomis: all households and those
// renting socially (from the council or a housing association), per 2022 ward and per output area
// (about 130 households each, small enough to find estates). Output areas are placed on the map by their
// population weighted centroids from the ONS Open Geography Portal.
// Nomis returns at most 25,000 rows and ArcGIS 2,000 features per request, so those two come in pages,
// one raw file per page. London local authority codes run from E09000001 (City of London) to E09000033.
import { readFileSync, writeFileSync } from "node:fs";

const headers = { "User-Agent": "london-rent-prototype" };
const boroughs = (type) => Array.from({ length: 33 }, (_, i) => `E090000${String(i + 1).padStart(2, "0")}${type}`).join(",");
const nomis = "https://www.nomisweb.co.uk/api/v01/dataset/NM_2072_1.data.csv";
const tenureFormat = 'CSV: GEOGRAPHY_CODE, C2021_TENURE_9_NAME ("Total: All households" or "Social rented"), OBS_VALUE (households)';
let index = JSON.parse(readFileSync("data/index.json", "utf8"));

const save = (file, text, entry) => {
  writeFileSync(`data/${file}`, text);
  index = index.filter((e) => e.file !== file);
  index.push({ file, ...entry, fetched_at: new Date().toISOString(), method: "script", script: "scripts/fetch/census-tenure.mjs" });
};

// Wards, one request
{
  const file = "census-tenure-wards.csv";
  const query = `geography=${boroughs("TYPE153")}&measures=20100&c2021_tenure_9=0,1003&select=geography_code,geography_name,c2021_tenure_9_name,obs_value`;
  const res = await fetch(`${nomis}?${query}`, { headers });
  if (!res.ok) throw new Error(`Nomis ${res.status}`);
  const text = await res.text();
  const rows = text.trim().split("\n").length - 1;
  if (!rows) throw new Error("Nomis returned no ward rows");
  save(file, text, {
    title: "Census 2021 households and social renters per ward in Greater London (TS054 Tenure, 2022 wards)",
    source: "ONS Census 2021 via Nomis API",
    url: nomis,
    query,
    format: 'CSV: GEOGRAPHY_CODE, GEOGRAPHY_NAME, C2021_TENURE_9_NAME ("Total: All households" or "Social rented"), OBS_VALUE (households)',
    adapter: "census-tenure",
  });
  console.log(`${file}: ${rows} rows`);
}

// Output areas, in pages of 25,000 rows
for (let page = 1; ; page++) {
  const file = `census-tenure-oa-${page}.csv`;
  const query = `geography=${boroughs("TYPE150")}&measures=20100&c2021_tenure_9=0,1003&select=geography_code,c2021_tenure_9_name,obs_value&recordoffset=${(page - 1) * 25000}`;
  const res = await fetch(`${nomis}?${query}`, { headers });
  if (!res.ok) throw new Error(`Nomis ${res.status}`);
  const text = await res.text();
  const rows = text.trim().split("\n").length - 1;
  if (!rows) break;
  save(file, text, {
    title: `Census 2021 households and social renters per output area in Greater London (TS054 Tenure), page ${page}`,
    source: "ONS Census 2021 via Nomis API",
    url: nomis,
    query,
    format: tenureFormat,
    adapter: "census-tenure-oa",
  });
  console.log(`${file}: ${rows} rows`);
  if (rows < 25000) break;
}

// Output area centroids inside a box around London, in pages of 2,000; areas outside London have no tenure and are dropped by reindex
const arcgis = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/OA_December_2021_EW_PWC_V4/FeatureServer/0/query";
for (let page = 1; ; page++) {
  const file = `ons-oa-centroids-${String(page).padStart(2, "0")}.json`;
  const query = `where=1=1&geometry=-0.52,51.28,0.34,51.70&geometryType=esriGeometryEnvelope&inSR=4326&outFields=OA21CD&outSR=4326&geometryPrecision=5&orderByFields=FID&resultOffset=${(page - 1) * 2000}&resultRecordCount=2000&f=geojson`;
  const res = await fetch(`${arcgis}?${encodeURI(query)}`, { headers });
  if (!res.ok) throw new Error(`ONS ${res.status}`);
  const text = await res.text();
  const json = JSON.parse(text);
  if (!json.features) throw new Error(`ONS centroids: ${text.slice(0, 200)}`);
  if (!json.features.length) break;
  save(file, text, {
    title: `Output area (2021) population weighted centroids around Greater London, page ${page}`,
    source: "ONS Open Geography Portal (ArcGIS FeatureServer, OA_December_2021_EW_PWC_V4)",
    url: arcgis,
    query,
    format: "GeoJSON FeatureCollection of Point in [lon,lat]; properties OA21CD",
    adapter: "ons-oa-centroids",
  });
  console.log(`${file}: ${json.features.length} centroids`);
  if (!json.properties?.exceededTransferLimit && json.features.length < 2000) break;
}

writeFileSync("data/index.json", JSON.stringify(index, null, 2) + "\n");
