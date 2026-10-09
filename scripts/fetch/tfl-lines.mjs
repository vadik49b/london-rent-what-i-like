// Fetches route geometry and stations for every Tube, DLR, Elizabeth line and Overground line
// from the TfL Unified API. One raw file per line.
import { readFileSync, writeFileSync } from "node:fs";

const api = "https://api.tfl.gov.uk";
const headers = { "User-Agent": "london-rent-prototype" };

const linesRes = await fetch(`${api}/Line/Mode/tube,dlr,elizabeth-line,overground`, { headers });
if (!linesRes.ok) throw new Error(`TfL ${linesRes.status}`);
const lines = await linesRes.json();

let index = JSON.parse(readFileSync("data/index.json", "utf8"));

for (const line of lines) {
  const file = `tfl-line-${line.id}.json`;
  const url = `${api}/Line/${line.id}/Route/Sequence/all`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TfL ${res.status} for ${line.id}`);
  const json = await res.json();
  writeFileSync(`data/${file}`, JSON.stringify(json, null, 2));

  index = index.filter((e) => e.file !== file);
  index.push({
    file,
    title: `${line.name} route and stations (${line.modeName})`,
    source: "TfL Unified API",
    url,
    fetched_at: new Date().toISOString(),
    method: "script",
    script: "scripts/fetch/tfl-lines.mjs",
    format:
      "TfL RouteSequence JSON: lineId, lineName, mode, lineStrings[] (each a JSON-encoded string of [[[lon,lat],...]]), stations[] with stationId, name, lat, lon, zone",
    adapter: "tfl-route-sequence",
  });
  console.log(`${file}: ${json.lineStrings.length} line strings, ${json.stations.length} stations`);
}

writeFileSync("data/index.json", JSON.stringify(index, null, 2) + "\n");
