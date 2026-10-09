// Fetches the ONS "housing prices in your area" data for every London borough: monthly average
// private rents (Price Index of Private Rents) and house prices. One raw file per borough.
// ONS only publishes the rent levels as a large spreadsheet otherwise, these JSON files feed
// https://www.ons.gov.uk/visualisations/housingpriceslocal/E09000012/
import { readFileSync, writeFileSync } from "node:fs";

let index = JSON.parse(readFileSync("data/index.json", "utf8"));

// London boroughs are E09000002 to E09000033. E09000001 is the City of London, which ONS has no file for.
for (let n = 2; n <= 33; n++) {
  const code = "E090000" + String(n).padStart(2, "0");
  const file = `ons-housing-${code.toLowerCase()}.json`;
  const url = `https://www.ons.gov.uk/visualisations/housingpriceslocal/data/json/${code}.json`;
  const res = await fetch(url, { headers: { "User-Agent": "london-rent-prototype" } });
  if (!res.ok) throw new Error(`ONS ${res.status} for ${code}`);
  const text = await res.text();
  const json = JSON.parse(text);
  writeFileSync(`data/${file}`, text);

  index = index.filter((e) => e.file !== file);
  index.push({
    file,
    title: `Rents and house prices in ${json.place.areanm}`,
    source: "ONS, housing prices in your area (Price Index of Private Rents, UK House Price Index)",
    url,
    fetched_at: new Date().toISOString(),
    method: "script",
    script: "scripts/fetch/ons-rents.mjs",
    format:
      "JSON: place{areacd, areanm, rental_price_YYYY-MM, rental_price_one_bed_YYYY-MM (also two_bed, three_bed, four_or_more_bed), avg_price_YYYY-MM, ...}, region{}, ctry{}, sections[]",
    adapter: "ons-housing",
  });
  console.log(`${file}: ${json.place.areanm}`);
}

writeFileSync("data/index.json", JSON.stringify(index, null, 2) + "\n");
