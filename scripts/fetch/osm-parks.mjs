// Fetches the outlines of parks, commons and nature reserves in Greater London from OpenStreetMap
// (Overpass API). Private ones (residents-only garden squares) are left out.
import { readFileSync, writeFileSync } from "node:fs";

const file = "osm-parks-london.json";
// Public Overpass instances are often busy, so try a few in turn.
const urls = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const query = `[out:json][timeout:180];
area["name"="Greater London"]["boundary"="administrative"]->.london;
wr["leisure"~"^(park|common|nature_reserve)$"]["access"!~"private|no"](area.london);
out geom;`;

let json, url;
for (url of urls) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "User-Agent": "london-rent-prototype", "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });
  if (res.ok) {
    json = await res.json();
    break;
  }
  console.error(`${url}: HTTP ${res.status}, trying next`);
}
if (!json) throw new Error("All Overpass instances failed, try again later");
writeFileSync(`data/${file}`, JSON.stringify(json));

const index = JSON.parse(readFileSync("data/index.json", "utf8")).filter((e) => e.file !== file);
index.push({
  file,
  title: "Parks, commons and nature reserves in Greater London",
  source: "OpenStreetMap via Overpass API",
  url,
  query,
  fetched_at: new Date().toISOString(),
  method: "script",
  script: "scripts/fetch/osm-parks.mjs",
  format:
    "Overpass JSON: elements[] of way (geometry[] of {lat, lon}) and relation (members[] with role outer/inner, each with geometry[]), with tags",
  adapter: "osm-areas",
});
writeFileSync("data/index.json", JSON.stringify(index, null, 2) + "\n");

console.log(`${file}: ${json.elements.length} elements`);
