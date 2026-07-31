import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envText = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";

for (const line of envText.split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (!match) continue;
  process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
}

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
const tables = [
  "kobuks_units",
  "kobuks_producers",
  "kobuks_production",
  "cbs_units",
  "greenhouse_units",
  "inspection_history",
  "tasks",
  "profiles",
  "notifications",
];

for (const table of tables) {
  const result = await supabase.from(table).select("*", { count: "exact", head: true });
  console.log(
    `${table}: ${
      result.error ? `ERR ${result.error.code || ""} ${result.error.message || result.error}` : `OK count=${result.count}`
    }`,
  );
}

const polygonSchemaChecks = [
  [
    "cbs_units",
    "id,tkgm_parcel_id,unit_no,parcel_polygon,greenhouse_polygon,source_geometry,geometry_hash,created_by,updated_by",
  ],
  [
    "greenhouse_units",
    "id,unit_no,parcel_polygon,greenhouse_polygon,cbs_unit_id",
  ],
  [
    "tasks",
    "id,parcel_polygon,greenhouse_polygon,cbs_unit_id,greenhouse_unit_id,inspection_id,workflow_type",
  ],
  [
    "inspection_history",
    "id,greenhouse_unit_id,producer_id,inspector_user_id,unit_no,status",
  ],
  [
    "kobuks_units",
    "id,unit_no,cbs_unit_id,greenhouse_unit_id,parcel_polygon,greenhouse_polygon,latitude,longitude",
  ],
  [
    "tasks",
    "id,cancelled_at,cancelled_by,reactivated_at,reactivated_by",
  ],
];

for (const [table, columns] of polygonSchemaChecks) {
  const result = await supabase.from(table).select(columns).limit(1);
  console.log(
    `${table} polygon schema: ${
      result.error
        ? `ERR ${result.error.code || ""} ${result.error.message || result.error}`
        : "OK"
    }`,
  );
}

async function fetchAll(table, select) {
  const rows = [];

  for (let from = 0; ; from += 1000) {
    const result = await supabase
      .from(table)
      .select(select)
      .range(from, from + 999);

    if (result.error) {
      console.log(`${table} detail: ERR ${result.error.code || ""} ${result.error.message || result.error}`);
      return rows;
    }

    rows.push(...(result.data || []));

    if ((result.data || []).length < 1000) {
      return rows;
    }
  }
}

const localText = fs.existsSync("src/data/aksuSolakUnits.ts") ? fs.readFileSync("src/data/aksuSolakUnits.ts", "utf8") : "";
const localUnitNos = [...localText.matchAll(/"unitNo":\s*"([^"]+)"/g)].map((match) => match[1]);
const localUnitSet = new Set(localUnitNos);
const kobuksUnits = await fetchAll(
  "kobuks_units",
  "unit_no,producer_tc,ada_no,parcel_no,greenhouse_area,parcel_area,parcel_polygon,greenhouse_polygon",
);
const kobuksUnitNos = kobuksUnits.map((row) => String(row.unit_no || "").trim()).filter(Boolean);
const duplicateUnitNos = kobuksUnitNos.filter((unitNo, index) => kobuksUnitNos.indexOf(unitNo) !== index);
const overlapUnitNos = kobuksUnitNos.filter((unitNo) => localUnitSet.has(unitNo));

console.log(`local_qgis_units: ${localUnitNos.length}`);
console.log(`kobuks_duplicate_unit_no: ${new Set(duplicateUnitNos).size}`);
console.log(`qgis_kobuks_unit_no_overlap: ${new Set(overlapUnitNos).size}`);
const kobuksGeometryCount = kobuksUnits.filter(
  (row) => Array.isArray(row.parcel_polygon) || Array.isArray(row.greenhouse_polygon),
).length;
const tkgmParcelResult = await supabase
  .from("cbs_units")
  .select("id", { count: "exact", head: true })
  .in("source", ["tkgm", "tkgm_authorized", "megsis_authorized", "tkgm_public_approx"]);

console.log(`kobuks_units_with_any_geometry: ${kobuksGeometryCount}`);
console.log(
  `tkgm_parcel_rows: ${
    tkgmParcelResult.error
      ? `ERR ${tkgmParcelResult.error.code || ""} ${tkgmParcelResult.error.message || tkgmParcelResult.error}`
      : tkgmParcelResult.count || 0
  }`,
);
