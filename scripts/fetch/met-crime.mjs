// Fetches Metropolitan Police recorded crime per ward and month (most recent 24 months) from the
// London Datastore. The download URL changes with every monthly release, so the newest one is
// looked up in the dataset's resource list first. City of London has its own force and is not in it.
import { readFileSync, writeFileSync } from "node:fs";

const file = "met-crime-wards.csv";
const dataset = "https://data.london.gov.uk/api/dataset/mps-recorded-crime-geographic-breakdown-exy3m";
const headers = { "User-Agent": "london-rent-prototype" };

const metaRes = await fetch(dataset, { headers });
if (!metaRes.ok) throw new Error(`London Datastore ${metaRes.status}`);
const releases = Object.values((await metaRes.json()).resources).filter((r) => r.title === "MPS Ward Level Crime.csv");
if (!releases.length) throw new Error("No ward level crime file in the dataset");
const latest = releases.sort((a, b) => b.check_timestamp.localeCompare(a.check_timestamp))[0];

const res = await fetch(latest.url, { headers });
if (!res.ok) throw new Error(`London Datastore ${res.status} for ${latest.url}`);
const text = await res.text();
writeFileSync(`data/${file}`, text);

const index = JSON.parse(readFileSync("data/index.json", "utf8")).filter((e) => e.file !== file);
index.push({
  file,
  title: `Met Police recorded crime per ward and month, ${latest.temporal_coverage_from} to ${latest.temporal_coverage_to}`,
  source: "Metropolitan Police Service via London Datastore (MPS Recorded Crime: Geographic Breakdown)",
  url: latest.url,
  fetched_at: new Date().toISOString(),
  method: "script",
  script: "scripts/fetch/met-crime.mjs",
  format: "CSV: Group, SubGroup, WardName, WardCode, LookUp_BoroughName, then one count column per month named YYYYMM",
  adapter: "met-crime-wards",
});
writeFileSync("data/index.json", JSON.stringify(index, null, 2) + "\n");

console.log(`${file}: ${text.trim().split("\n").length - 1} rows, ${latest.temporal_coverage_from} to ${latest.temporal_coverage_to}`);
