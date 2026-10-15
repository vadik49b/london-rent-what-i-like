// Fetches Census 2021 household tenure (TS054) per 2022 ward in Greater London from Nomis:
// all households and those renting socially (from the council or a housing association).
// London local authority codes run from E09000001 (City of London) to E09000033 (Westminster).
import { readFileSync, writeFileSync } from "node:fs";

const file = "census-tenure-wards.csv";
const boroughs = Array.from({ length: 33 }, (_, i) => `E090000${String(i + 1).padStart(2, "0")}TYPE153`).join(",");
const url = "https://www.nomisweb.co.uk/api/v01/dataset/NM_2072_1.data.csv";
const query = `geography=${boroughs}&measures=20100&c2021_tenure_9=0,1003&select=geography_code,geography_name,c2021_tenure_9_name,obs_value`;

const res = await fetch(`${url}?${query}`, { headers: { "User-Agent": "london-rent-prototype" } });
if (!res.ok) throw new Error(`Nomis ${res.status}`);
const text = await res.text();
const rows = text.trim().split("\n").length - 1;
if (!rows) throw new Error("Nomis returned no rows");
writeFileSync(`data/${file}`, text);

const index = JSON.parse(readFileSync("data/index.json", "utf8")).filter((e) => e.file !== file);
index.push({
  file,
  title: "Census 2021 households and social renters per ward in Greater London (TS054 Tenure, 2022 wards)",
  source: "ONS Census 2021 via Nomis API",
  url,
  query,
  fetched_at: new Date().toISOString(),
  method: "script",
  script: "scripts/fetch/census-tenure.mjs",
  format: 'CSV: GEOGRAPHY_CODE, GEOGRAPHY_NAME, C2021_TENURE_9_NAME ("Total: All households" or "Social rented"), OBS_VALUE (households)',
  adapter: "census-tenure",
});
writeFileSync("data/index.json", JSON.stringify(index, null, 2) + "\n");

console.log(`${file}: ${rows} rows`);
