// Rebuilds data.json (the single file the frontend loads) from everything in data/.
// Output holds facts only: no categories, icons or colours. Those live in index.html.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const index = JSON.parse(readFileSync("data/index.json", "utf8"));

// The index must describe exactly what is in data/
const onDisk = readdirSync("data").filter((f) => f !== "index.json" && !f.startsWith("."));
const indexed = index.map((e) => e.file);
const unindexed = onDisk.filter((f) => !indexed.includes(f));
const missing = indexed.filter((f) => !onDisk.includes(f));
if (unindexed.length || missing.length) {
  if (unindexed.length) console.error("In data/ but not in data/index.json:", unindexed.join(", "));
  if (missing.length) console.error("In data/index.json but not in data/:", missing.join(", "));
  process.exit(1);
}

const points = [];
const lines = [];
const stations = new Map(); // station id -> point, shared across line files

// One adapter per raw format. Each reads a parsed raw file and pushes into points / lines.
const adapters = {
  // [{name, address, lat, lon}]
  points(raw, dataset) {
    raw.forEach((p, i) => {
      points.push({ id: `${dataset}-${i}`, dataset, name: p.name, lat: p.lat, lon: p.lon, props: { address: p.address } });
    });
  },

  // Overpass JSON
  "osm-pois"(raw, dataset) {
    for (const el of raw.elements) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null) continue;
      const t = el.tags ?? {};
      const address = [[t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "), t["addr:city"], t["addr:postcode"]]
        .filter(Boolean)
        .join(", ");
      points.push({
        id: `osm-${el.type}-${el.id}`,
        dataset,
        name: t.name ?? t.brand,
        lat,
        lon,
        props: { brand: t.brand, shop: t.shop, address, opening_hours: t.opening_hours },
      });
    }
  },

  // European Coffee Trip city guide: [{name, address, link, latitude, longitude, ...}]
  "ect-cafes"(raw, dataset) {
    for (const c of raw) {
      points.push({
        id: `${dataset}-${c.link.split("/").at(-2)}`,
        dataset,
        name: c.name,
        lat: parseFloat(c.latitude),
        lon: parseFloat(c.longitude),
        props: { address: c.address, website: c.link },
      });
    }
  },

  // TfL Line/{id}/Route/Sequence
  "tfl-route-sequence"(raw) {
    const seen = new Set();
    const paths = [];
    for (const str of raw.lineStrings) {
      if (seen.has(str)) continue; // inbound and outbound often repeat
      seen.add(str);
      for (const path of JSON.parse(str)) paths.push(path.map(([lon, lat]) => [lat, lon]));
    }
    lines.push({ id: raw.lineId, dataset: "tfl-lines", name: raw.lineName, mode: raw.mode, paths });

    for (const s of raw.stations) {
      const id = s.stationId ?? s.id;
      if (!stations.has(id)) {
        stations.set(id, {
          id,
          dataset: "tfl-stations",
          name: s.name.replace(/ (Underground|Rail|DLR) Station$/, ""),
          lat: s.lat,
          lon: s.lon,
          props: { zone: s.zone, lines: [], modes: [] },
        });
      }
      const props = stations.get(id).props;
      if (!props.lines.includes(raw.lineId)) props.lines.push(raw.lineId);
      if (!props.modes.includes(raw.mode)) props.modes.push(raw.mode);
    }
  },
};

for (const entry of index) {
  const adapter = adapters[entry.adapter];
  if (!adapter) throw new Error(`${entry.file}: unknown adapter "${entry.adapter}"`);
  const raw = JSON.parse(readFileSync(`data/${entry.file}`, "utf8"));
  adapter(raw, entry.file.replace(/\.json$/, ""));
}
points.push(...stations.values());

writeFileSync("data.json", JSON.stringify({ generated_at: new Date().toISOString(), points, lines }));

const counts = {};
for (const p of points) counts[p.dataset] = (counts[p.dataset] ?? 0) + 1;
console.log("data.json written");
console.log("points:", counts);
console.log("lines:", lines.length);
