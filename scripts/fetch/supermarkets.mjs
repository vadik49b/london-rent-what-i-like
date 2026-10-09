// Fetches big supermarkets of selected chains in Greater London from OpenStreetMap (Overpass API).
// Only shop=supermarket is requested, which leaves out convenience formats (Tesco Express,
// Sainsbury's Local, Little Waitrose...). A few of those are mis-tagged as supermarkets, so
// they are also excluded by name.
import { readFileSync, writeFileSync } from "node:fs";

const file = "osm-supermarkets-london.json";
const chains = "Lidl|Sainsbury|Waitrose|Tesco|M&S|Marks & Spencer|Marks and Spencer";
const small = "Express|Local|Little";
// Public Overpass instances are often busy, so try a few in turn.
const urls = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const query = `[out:json][timeout:120];
area["name"="Greater London"]["boundary"="administrative"]->.london;
nwr["shop"="supermarket"]["name"~"${chains}"]["name"!~"${small}"](area.london);
out center tags;`;

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
writeFileSync(`data/${file}`, JSON.stringify(json, null, 2));

const index = JSON.parse(readFileSync("data/index.json", "utf8")).filter((e) => e.file !== file);
index.push({
  file,
  title: "Big supermarkets in Greater London: Lidl, Sainsbury's, Waitrose, Tesco, M&S Food",
  source: "OpenStreetMap via Overpass API",
  url,
  query,
  fetched_at: new Date().toISOString(),
  method: "script",
  script: "scripts/fetch/supermarkets.mjs",
  format: "Overpass JSON: elements[] of node/way/relation, each with lat/lon or center{lat,lon}, and tags",
  adapter: "osm-pois",
});
writeFileSync("data/index.json", JSON.stringify(index, null, 2) + "\n");

console.log(`${file}: ${json.elements.length} elements`);
