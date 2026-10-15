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
const areas = new Map(); // ONS code -> area
const areaProps = [];
const oaTenure = new Map(); // output area code -> {households, social_rented}, placed on the map by its centroid once all files are read
const oaCentroids = new Map(); // output area code -> [lat, lon] // [ONS code, props] from the files that describe areas, attached once all files are read

// One adapter per raw format. Each reads a parsed raw file (the text, for CSV) and pushes into points / lines / areas.
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
      // One place is sometimes mapped as several nodes (Canary Wall has one per railway arch): keep the first
      const name = t.name ?? t.brand;
      if (name && points.some((p) => p.dataset === dataset && p.name === name && Math.hypot(p.lat - lat, (p.lon - lon) * 0.62) < 0.001)) continue;
      const address = [[t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "), t["addr:city"], t["addr:postcode"]]
        .filter(Boolean)
        .join(", ");
      points.push({
        id: `osm-${el.type}-${el.id}`,
        dataset,
        name,
        lat,
        lon,
        props: { brand: t.brand, shop: t.shop, address, opening_hours: t.opening_hours },
      });
    }
  },

  // Overpass JSON with geometry: ways are one ring, relations are outer ways to be joined end to end into rings.
  // Holes (inner ways) are ignored.
  "osm-areas"(raw, dataset) {
    for (const el of raw.elements) {
      const parts = (el.members ? el.members.filter((m) => m.role === "outer" && m.geometry) : [el]).map((m) =>
        m.geometry.map((g) => [Math.round(g.lat * 1e5) / 1e5, Math.round(g.lon * 1e5) / 1e5]),
      );
      const rings = [];
      while (parts.length) {
        const ring = parts.shift();
        while (String(ring[0]) !== String(ring.at(-1))) {
          const i = parts.findIndex((p) => String(p[0]) === String(ring.at(-1)) || String(p.at(-1)) === String(ring.at(-1)));
          if (i < 0) break;
          const [next] = parts.splice(i, 1);
          ring.push(...(String(next[0]) === String(ring.at(-1)) ? next : next.reverse()).slice(1));
        }
        if (String(ring[0]) === String(ring.at(-1)) && ring.length > 3) rings.push(ring);
      }
      if (!rings.length) continue;
      // Shoelace area on a local metre grid
      let area = 0;
      for (const ring of rings) {
        let sum = 0;
        for (let i = 1; i < ring.length; i++) sum += ring[i - 1][1] * ring[i][0] - ring[i][1] * ring[i - 1][0];
        area += Math.abs(sum / 2) * 111320 * 111320 * Math.cos((ring[0][0] * Math.PI) / 180);
      }
      areas.set(`osm-${el.type}-${el.id}`, {
        id: `osm-${el.type}-${el.id}`,
        dataset,
        name: el.tags.name,
        lat: (el.bounds.minlat + el.bounds.maxlat) / 2,
        lon: (el.bounds.minlon + el.bounds.maxlon) / 2,
        polygons: rings.map((ring) => [ring]),
        props: { leisure: el.tags.leisure, area_km2: Math.round(area / 1e2) / 1e4 },
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
    // Station ids in running order, one list per branch; interchanges go by their hub id, like the stations below
    const routes = raw.stopPointSequences.map((seq) => seq.stopPoint.map((s) => s.topMostParentId ?? s.stationId ?? s.id));
    lines.push({ id: raw.lineId, dataset: "tfl-lines", name: raw.lineName, mode: raw.mode, paths, routes });

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

  // ONS boundaries as GeoJSON, wards or local authority districts
  "ons-areas"(raw, dataset) {
    for (const f of raw.features) {
      const p = f.properties;
      const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      areas.set(p.WD24CD ?? p.LAD24CD, {
        id: p.WD24CD ?? p.LAD24CD,
        dataset,
        name: p.WD24NM ?? p.LAD24NM,
        lat: p.LAT,
        lon: p.LONG,
        polygons: polygons.map((rings) => rings.map((ring) => ring.map(([lon, lat]) => [lat, lon]))),
        props: { borough: p.WD24CD ? p.LAD24NM : undefined, area_km2: Math.round(p.Shape__Area / 1e4) / 100 },
      });
    }
  },

  // Met crime CSV: Group, SubGroup, WardName, WardCode, LookUp_BoroughName, then a count per month.
  // Kept per ward: the total of the last 12 months for every SubGroup.
  "met-crime-wards"(raw) {
    const rows = raw.trim().split(/\r?\n/).map((line) => line.match(/"[^"]*"|[^,]+|(?<=,)(?=,)/g).map((v) => v.replace(/^"|"$/g, "")));
    const months = rows[0].slice(5);
    const byWard = {};
    for (const row of rows.slice(1)) {
      const crime = (byWard[row[3]] ??= {});
      crime[row[1]] = (crime[row[1]] ?? 0) + row.slice(-12).reduce((sum, v) => sum + Number(v), 0);
    }
    for (const code in byWard) areaProps.push([code, { crime: byWard[code], crime_months: [months.at(-12), months.at(-1)] }]);
  },

  // Census tenure CSV: GEOGRAPHY_CODE, C2021_TENURE_9_NAME, OBS_VALUE (households), per output area, one page per file
  "census-tenure-oa"(raw) {
    for (const line of raw.trim().split(/\r?\n/).slice(1)) {
      const [code, kind, count] = line.split(",").map((v) => v.replace(/^"|"$/g, ""));
      if (!oaTenure.has(code)) oaTenure.set(code, {});
      oaTenure.get(code)[kind.startsWith("Total") ? "households" : "social_rented"] = Number(count);
    }
  },

  // ONS output area centroids as GeoJSON points
  "ons-oa-centroids"(raw) {
    for (const f of raw.features) oaCentroids.set(f.properties.OA21CD, [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
  },

  // ONS housing prices in your area, one local authority per file. Rents are monthly averages in pounds.
  "ons-housing"(raw) {
    const month = Object.keys(raw.place).filter((k) => /^rental_price_\d{4}-\d{2}$/.test(k)).sort().at(-1).slice(-7);
    const rent = { month, all: raw.place[`rental_price_${month}`] };
    for (const size of ["one_bed", "two_bed", "three_bed", "four_or_more_bed"]) rent[size] = raw.place[`rental_price_${size}_${month}`];
    areaProps.push([raw.place.areacd, { rent }]);
  },
};

for (const entry of index) {
  const adapter = adapters[entry.adapter];
  if (!adapter) throw new Error(`${entry.file}: unknown adapter "${entry.adapter}"`);
  const text = readFileSync(`data/${entry.file}`, "utf8");
  adapter(entry.file.endsWith(".json") ? JSON.parse(text) : text, entry.file.replace(/\.\w+$/, ""));
}
points.push(...stations.values());

// Output areas become points at their centroid; centroids outside London have no tenure and are dropped
for (const [code, tenure] of oaTenure) {
  const at = oaCentroids.get(code);
  if (!at) throw new Error(`Output area ${code} has tenure but no centroid`);
  points.push({ id: code, dataset: "census-tenure-oa", name: code, lat: at[0], lon: at[1], props: tenure });
}

const noArea = [];
for (const [code, props] of areaProps) {
  if (areas.has(code)) Object.assign(areas.get(code).props, props);
  else noArea.push(code);
}
if (noArea.length) console.warn(`${noArea.length} area codes have data but no boundary and are dropped:`, noArea.join(", "));

writeFileSync("data.json", JSON.stringify({ generated_at: new Date().toISOString(), points, lines, areas: [...areas.values()] }));

const counts = {};
for (const p of points) counts[p.dataset] = (counts[p.dataset] ?? 0) + 1;
console.log("data.json written");
console.log("points:", counts);
console.log("lines:", lines.length);
console.log("areas:", areas.size);
