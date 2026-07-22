import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_CSV = "C:/Users/Dell/Downloads/RAPOR_KOBUKS_UNITE_ARAZI_URUN_BILGILERI.csv";
const TABLE_COLUMN_CANDIDATES = {
  kobuks_producers: [
    "tc_no",
    "full_name",
    "phone",
    "city",
    "district",
    "village",
    "status",
    "raw_payload",
  ],
  kobuks_units: [
    "unit_no",
    "producer_tc",
    "ada_no",
    "parcel_no",
    "greenhouse_area",
    "heating_type",
    "parcel_area",
    "city",
    "district_name",
    "district",
    "village",
    "unit_type",
    "unit_material",
    "heating_energy_type",
    "parcel_document_type",
    "building_no",
    "passive_year",
    "registration_status",
    "detected_crop",
    "crop_name",
    "source",
    "raw_payload",
  ],
  kobuks_production: [
    "unit_no",
    "crop_name",
    "crop_variety",
    "planting_date",
    "harvest_start_date",
    "harvest_end_date",
    "production_model",
    "production_material",
    "production_season",
    "usage_type",
    "production_amount",
    "production_unit",
    "status",
    "raw_payload",
  ],
};
const DEFAULT_EXPORT_COLUMNS = {
  kobuks_producers: ["tc_no", "full_name", "phone", "city", "district", "village"],
  kobuks_units: ["unit_no", "producer_tc", "ada_no", "parcel_no", "greenhouse_area", "heating_type", "parcel_area"],
  kobuks_production: [
    "unit_no",
    "crop_name",
    "planting_date",
    "harvest_start_date",
    "harvest_end_date",
    "production_material",
    "production_amount",
  ],
};

const args = parseArgs(process.argv.slice(2));
const csvPath = path.resolve(args.csv || DEFAULT_CSV);
const apply = Boolean(args.apply);
const replace = Boolean(args.replace);

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});

async function main() {
  const env = loadEnv(path.resolve(".env"));
  const parsed = parseKobuksReport(csvPath);

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        csv: csvPath,
        rows: parsed.sourceRows,
        producers: parsed.producers.length,
        units: parsed.units.length,
        productionRows: parsed.production.length,
        skippedRows: parsed.skippedRows,
        replace,
      },
      null,
      2,
    ),
  );

  if (args.exportDir) {
    const exportDir = path.resolve(args.exportDir);
    exportImportFiles(exportDir, parsed, DEFAULT_EXPORT_COLUMNS);
    console.log(`Export dosyalari hazir: ${exportDir}`);
  }

  if (!apply) {
    console.log("Dry-run tamamlandi. Yuklemek icin --apply kullanin.");
    return;
  }

  const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_IMPORT_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_IMPORT_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const usingServiceRole = Boolean(
    process.env.SUPABASE_IMPORT_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_IMPORT_SERVICE_ROLE_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase URL ve anon/service-role key bulunmali.");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const importEmail = process.env.SUPABASE_IMPORT_EMAIL || args.email;
  const importPassword = process.env.SUPABASE_IMPORT_PASSWORD || args.password;

  if (!usingServiceRole && importEmail && importPassword) {
    const login = await supabase.auth.signInWithPassword({
      email: importEmail,
      password: importPassword,
    });

    if (login.error) {
      throw new Error(`Supabase oturumu acilamadi: ${login.error.message}`);
    }
  }

  const tableColumns = {
    kobuks_producers: await existingColumns(supabase, "kobuks_producers", TABLE_COLUMN_CANDIDATES.kobuks_producers),
    kobuks_units: await existingColumns(supabase, "kobuks_units", TABLE_COLUMN_CANDIDATES.kobuks_units),
    kobuks_production: await existingColumns(supabase, "kobuks_production", TABLE_COLUMN_CANDIDATES.kobuks_production),
  };

  console.log(JSON.stringify({ tableColumns }, null, 2));

  if (replace) {
    await deleteTableRows(supabase, "kobuks_production");
    await deleteTableRows(supabase, "kobuks_units");
    await deleteTableRows(supabase, "kobuks_producers");
  } else {
    await assertTableEmpty(supabase, "kobuks_production");
    await assertTableEmpty(supabase, "kobuks_units");
    await assertTableEmpty(supabase, "kobuks_producers");
  }

  await insertRows(supabase, "kobuks_producers", parsed.producers, tableColumns.kobuks_producers);
  await insertRows(supabase, "kobuks_units", parsed.units, tableColumns.kobuks_units);
  await insertRows(supabase, "kobuks_production", parsed.production, tableColumns.kobuks_production);

  const counts = {};
  for (const table of Object.keys(tableColumns)) {
    const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`${table} sayimi alinamadi: ${error.message}`);
    counts[table] = count;
  }

  console.log(JSON.stringify({ imported: counts }, null, 2));
}

function parseArgs(values) {
  const result = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === "--apply") result.apply = true;
    else if (value === "--replace") result.replace = true;
    else if (value === "--csv") result.csv = values[++index];
    else if (value === "--export-dir") result.exportDir = values[++index];
    else if (value === "--email") result.email = values[++index];
    else if (value === "--password") result.password = values[++index];
  }

  return result;
}

function loadEnv(filePath) {
  const env = {};

  if (!fs.existsSync(filePath)) {
    return env;
  }

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }

  return env;
}

function parseKobuksReport(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith("Isletme_No1,"));

  if (headerIndex === -1) {
    throw new Error("CSV icinde Isletme_No1 ile baslayan tablo basligi bulunamadi.");
  }

  const headers = parseCsvLine(lines[headerIndex]);
  const producers = new Map();
  const units = new Map();
  const production = new Map();
  let sourceRows = 0;
  let skippedRows = 0;

  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim()) continue;

    sourceRows += 1;
    const record = toRecord(headers, parseCsvLine(line));
    const unitNo = cleanText(record.Unite_No);

    if (!unitNo) {
      skippedRows += 1;
      continue;
    }

    const unit = units.get(unitNo) || {
      unit_no: unitNo,
      registration_status: "Aktif",
      source: "kobuks_csv",
    };

    const producerTc = cleanText(record.Isletme_No1);
    const producerName = parseProducerName(record.Isletme_Adi1, producerTc);
    const location = splitLocation(record.Yerlesim);
    const parcel = splitAdaParsel(record.AdaParsel);
    const cropName = cleanCrop(record.Unite_Malzemesi3);

    assignIfFilled(unit, "producer_tc", producerTc);
    assignIfFilled(unit, "unit_type", cleanText(record.Unite_Tipi));
    assignIfFilled(unit, "unit_material", cleanText(record.Unite_Malzemesi1));
    assignIfFilled(unit, "heating_type", joinParts([record.Isitma_Tipi1, record.Isitmada_Kullanilan_Enerji_Tipi1], " / "));
    assignIfFilled(unit, "heating_energy_type", cleanText(record.Isitmada_Kullanilan_Enerji_Tipi1));
    assignIfFilled(unit, "parcel_document_type", cleanText(record.ParcelDocumentType));
    assignIfFilled(unit, "city", location.city);
    assignIfFilled(unit, "district_name", location.district);
    assignIfFilled(unit, "district", location.district);
    assignIfFilled(unit, "village", location.village);
    assignIfFilled(unit, "ada_no", parcel.adaNo);
    assignIfFilled(unit, "parcel_no", parcel.parcelNo);
    assignIfFilled(unit, "building_no", cleanDash(record.BuildingNo));
    assignIfFilled(unit, "passive_year", parseDate(record.PassiveYear));
    assignIfFilled(unit, "greenhouse_area", parseAreaM2(record.UniteAlani || record.Toplam_Unite_Alani));
    assignIfFilled(unit, "parcel_area", parseAreaM2(record.Area));
    assignIfFilled(unit, "detected_crop", cropName);
    assignIfFilled(unit, "crop_name", cropName);
    unit.raw_payload = record;
    units.set(unitNo, unit);

    if (producerTc) {
      const producer = producers.get(producerTc) || {
        tc_no: producerTc,
        full_name: producerName || `Isletme ${producerTc}`,
      };

      if (producerName && !producer.full_name.startsWith("Isletme ")) {
        producer.full_name = producerName;
      }
      assignIfFilled(producer, "city", location.city);
      assignIfFilled(producer, "district", location.district);
      assignIfFilled(producer, "village", location.village);
      producer.raw_payload = record;
      producers.set(producerTc, producer);
    }

    if (cropName) {
      const productionRecord = {
        unit_no: unitNo,
        crop_name: cropName,
        crop_variety: cropName.includes(" / ") ? cropName.split(" / ").slice(1).join(" / ") : "",
        planting_date: parseDate(record.Unite_Malzemesi4),
        harvest_start_date: parseDate(record.Unite_Malzemesi5),
        harvest_end_date: parseDate(record.Unite_Malzemesi6),
        production_model: cleanText(record.Unite_Malzemesi7),
        production_material: cleanText(record.Unite_Malzemesi8),
        production_season: cleanText(record.Uretim_Periyodu),
        usage_type: cleanText(record.Unite_Malzemesi9),
        production_amount: parseQuantity(record.Unite_Malzemesi10),
        production_unit: cleanText(record.Unite_Malzemesi11),
        status: "Aktif",
        raw_payload: record,
      };
      const key = [
        productionRecord.unit_no,
        productionRecord.crop_name,
        productionRecord.planting_date,
        productionRecord.harvest_start_date,
        productionRecord.harvest_end_date,
        productionRecord.production_amount,
      ].join("|");
      production.set(key, productionRecord);
    }
  }

  return {
    sourceRows,
    skippedRows,
    producers: [...producers.values()],
    units: [...units.values()],
    production: [...production.values()],
  };
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function toRecord(headers, values) {
  const record = {};
  headers.forEach((header, index) => {
    record[header] = values[index] ?? "";
  });
  return record;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanDash(value) {
  const text = cleanText(value);
  return text === "---" ? "" : text;
}

function assignIfFilled(target, key, value) {
  if (value === null || value === undefined || value === "") return;
  target[key] = value;
}

function joinParts(values, separator) {
  return values.map(cleanText).filter(Boolean).join(separator);
}

function parseProducerName(value, producerTc) {
  const text = cleanText(value)
    .replace(/\s*\(Arazi Kayit Yeri:.*\)\s*/gi, "")
    .replace(/\s*\(Arazi Kayıt Yeri:.*\)\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return text || (producerTc ? `Isletme ${producerTc}` : "");
}

function splitLocation(value) {
  const [city = "", district = "", village = ""] = cleanText(value)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  return { city, district, village };
}

function splitAdaParsel(value) {
  const [adaNo = "", parcelNo = ""] = cleanText(value)
    .split("/")
    .map((part) => part.trim());

  return { adaNo, parcelNo };
}

function cleanCrop(value) {
  return cleanText(value)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" / ");
}

function parseAreaM2(value) {
  const text = cleanText(value);
  if (!text) return "";

  const normalized = text.replace(/\./g, ".").replace(",", ".");
  const number = Number(normalized);
  if (!Number.isFinite(number)) return "";

  return Math.round(number * 1000);
}

function parseQuantity(value) {
  const text = cleanText(value);
  if (!text) return "";

  const normalized = text.match(/^[0-9]+,[0-9]{3}$/)
    ? text.replace(",", "")
    : text.replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : "";
}

function parseDate(value) {
  const text = cleanText(value);
  if (!text) return "";

  const match = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (!match) return "";

  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

async function existingColumns(supabase, table, candidates) {
  const columns = [];

  for (const column of candidates) {
    const { error } = await supabase.from(table).select(column).limit(0);
    if (!error) columns.push(column);
  }

  if (!columns.length) {
    throw new Error(`${table} icin kullanilabilir kolon bulunamadi.`);
  }

  return columns;
}

async function assertTableEmpty(supabase, table) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table} sayimi alinamadi: ${error.message}`);
  if (count) {
    throw new Error(`${table} bos degil (${count} kayit). Degistirmek icin --replace kullanin.`);
  }
}

async function deleteTableRows(supabase, table) {
  const { count, error: countError } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (countError) throw new Error(`${table} sayimi alinamadi: ${countError.message}`);
  if (!count) return;

  const { error } = await supabase.from(table).delete().gte("created_at", "1900-01-01T00:00:00Z");
  if (error) throw new Error(`${table} temizlenemedi: ${error.message}`);
}

async function insertRows(supabase, table, rows, allowedColumns) {
  const filteredRows = rows
    .map((row) => filterColumns(row, allowedColumns))
    .filter((row) => Object.keys(row).length);
  const chunkSize = 500;

  for (let index = 0; index < filteredRows.length; index += chunkSize) {
    const chunk = filteredRows.slice(index, index + chunkSize);
    const { error } = await supabase.from(table).insert(chunk);

    if (error) {
      throw new Error(`${table} yuklenemedi (${index + 1}-${index + chunk.length}): ${error.message}`);
    }

    console.log(`${table}: ${Math.min(index + chunk.length, filteredRows.length)}/${filteredRows.length}`);
  }
}

function filterColumns(row, allowedColumns) {
  const filtered = {};

  for (const column of allowedColumns) {
    const value = row[column];
    if (value !== undefined && value !== "") {
      filtered[column] = value;
    }
  }

  return filtered;
}

function exportImportFiles(exportDir, parsed, columnsByTable) {
  fs.mkdirSync(exportDir, { recursive: true });

  const tableRows = {
    kobuks_producers: parsed.producers,
    kobuks_units: parsed.units,
    kobuks_production: parsed.production,
  };

  for (const [table, rows] of Object.entries(tableRows)) {
    writeCsv(path.join(exportDir, `${table}.csv`), rows, columnsByTable[table]);
  }

  writeSql(path.join(exportDir, "kobuks_import.sql"), tableRows, columnsByTable);
  fs.writeFileSync(
    path.join(exportDir, "summary.json"),
    JSON.stringify(
      {
        sourceRows: parsed.sourceRows,
        skippedRows: parsed.skippedRows,
        producers: parsed.producers.length,
        units: parsed.units.length,
        productionRows: parsed.production.length,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

function writeCsv(filePath, rows, columns) {
  const lines = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")),
  ];

  fs.writeFileSync(filePath, `\uFEFF${lines.join("\n")}\n`, "utf8");
}

function csvValue(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeSql(filePath, tableRows, columnsByTable) {
  const lines = [
    "begin;",
    "delete from public.kobuks_production;",
    "delete from public.kobuks_units;",
    "delete from public.kobuks_producers;",
  ];

  for (const table of ["kobuks_producers", "kobuks_units", "kobuks_production"]) {
    const columns = columnsByTable[table];
    const rows = tableRows[table].map((row) => filterColumns(row, columns));
    const chunkSize = 500;

    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunk = rows.slice(index, index + chunkSize);
      const values = chunk.map((row) => `(${columns.map((column) => sqlValue(row[column])).join(", ")})`);
      lines.push(`insert into public.${table} (${columns.join(", ")}) values`);
      lines.push(`${values.join(",\n")};`);
    }
  }

  lines.push("commit;");
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function sqlValue(value) {
  if (value === undefined || value === null || value === "") {
    return "null";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }

  return `'${String(value).replace(/'/g, "''")}'`;
}
