// Fetches several kinds of independent places in Greater London from OpenStreetMap (Overpass API):
// climbing gyms, yoga and pilates studios, craft breweries, record shops, vintage clothing and
// independent bookshops. One raw file per kind, one request per kind.
import { readFileSync, writeFileSync } from "node:fs";

// filters: Overpass tag filters, each one is a separate statement and the results are unioned.
const places = [
  {
    file: "osm-climbing-london.json",
    title: "Climbing gyms in Greater London",
    filters: ['["sport"~"climbing"]["leisure"~"sports_centre|fitness_centre"]'],
  },
  {
    file: "osm-yoga-london.json",
    title: "Yoga and pilates studios in Greater London",
    filters: ['["sport"~"yoga|pilates"]'],
  },
  {
    file: "osm-breweries-london.json",
    title: "Craft breweries and microbrewery taprooms in Greater London",
    filters: ['["craft"="brewery"]', '["microbrewery"="yes"]'],
  },
  {
    file: "osm-record-shops-london.json",
    title: "Record and music shops without a brand in Greater London",
    filters: ['["shop"="music"][!"brand"]'],
  },
  {
    // Charity shops are shop=charity and are left out on purpose.
    file: "osm-vintage-london.json",
    title: "Second-hand and vintage clothing shops in Greater London",
    filters: ['["shop"="second_hand"]', '["shop"="clothes"]["second_hand"~"yes|only"]'],
  },
  {
    file: "osm-bookshops-london.json",
    title: "Independent bookshops in Greater London",
    filters: ['["shop"="books"][!"brand"]["name"!~"Waterstones|WHSmith|The Works|Blackwell"]'],
  },
];

// Public Overpass instances are often busy, so try a few in turn.
const urls = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

let index = JSON.parse(readFileSync("data/index.json", "utf8"));

for (const place of places) {
  const query = `[out:json][timeout:120];
area["name"="Greater London"]["boundary"="administrative"]->.london;
(
${place.filters.map((f) => `  nwr${f}(area.london);`).join("\n")}
);
out center tags;`;

  // Overpass rate-limits back-to-back queries (HTTP 429), so go round the instances a few times.
  let json, url;
  for (let round = 0; round < 4 && !json; round++) {
    if (round) await new Promise((r) => setTimeout(r, 30000));
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
  }
  if (!json) throw new Error(`${place.file}: all Overpass instances failed, try again later`);
  writeFileSync(`data/${place.file}`, JSON.stringify(json, null, 2));

  index = index.filter((e) => e.file !== place.file);
  index.push({
    file: place.file,
    title: place.title,
    source: "OpenStreetMap via Overpass API",
    url,
    query,
    fetched_at: new Date().toISOString(),
    method: "script",
    script: "scripts/fetch/osm-places.mjs",
    format: "Overpass JSON: elements[] of node/way/relation, each with lat/lon or center{lat,lon}, and tags",
    adapter: "osm-pois",
  });
  writeFileSync("data/index.json", JSON.stringify(index, null, 2) + "\n");

  console.log(`${place.file}: ${json.elements.length} elements`);
  await new Promise((r) => setTimeout(r, 10000));
}
