import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";

import { supabase } from "../lib/supabase";

const MAX_GPKG_BYTES = 50 * 1024 * 1024;
const MAX_FEATURES = 10000;
const QFIELD_MAP_CACHE_MS = 60_000;
let qfieldMapCache: { loadedAt: number; features: ReturnType<typeof normalizeQFieldMapRows> } | null = null;
let qfieldMapRequest: Promise<ReturnType<typeof normalizeQFieldMapRows>> | null = null;
let qfieldMapGeneration = 0;
const GEOJSON_FIELDS: Record<string, string> = {
  "Ünite Tipi": "unit_type",
  "Konstrüksiyon Yaşı": "construction_age",
  "Çevre Temel Betonu": "foundation_concrete",
  "Örtü Tipi": "cover_type",
  "Çatı Tipi": "roof_type",
  "Cati Genisligi": "roof_width",
  OlukAltiYuksekligi: "gutter_height",
  "OlukAlti Yuksekligi(m)": "gutter_height",
  "Havalandırma Şekli": "ventilation_type",
  "Profil Malzeme Türü": "profile_material",
  "Profil Yapısı": "profile_structure",
  "Isıtma Türü": "heating_type",
  "Otomasyon Tipi": "automation_type",
  "Yetiştirme Türü": "cultivation_type",
  "Üretim Şekli": "cultivation_type",
  "Puan": "score",
  Kanaat: "judgment",
  ilcead: "district",
  mahallead: "neighborhood",
  Alan: "area_m2",
};

export type GeoJsonGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type QFieldFeature = {
  source_fid: number;
  qfield_id: string | null;
  unit_no: string | null;
  area_m2: number | null;
  unit_type: string | null;
  construction_age: string | null;
  foundation_concrete: string | null;
  cover_type: string | null;
  roof_type: string | null;
  roof_width: number | null;
  gutter_height: number | null;
  ventilation_type: string | null;
  profile_material: string | null;
  profile_structure: string | null;
  heating_type: string | null;
  automation_type: string | null;
  cultivation_type: string | null;
  score: number | null;
  judgment: string | null;
  district: string | null;
  neighborhood: string | null;
  geometry_geojson: GeoJsonGeometry;
  matched_kobuks_unit_id: number | null;
};

export type QFieldImportPreview = {
  fileName: string;
  sha256: string;
  sourceLayer: string;
  featureCount: number;
  matchedCount: number;
  unmatchedCount: number;
  missingIdentifierCount: number;
  duplicateBatchId: string | null;
  features: QFieldFeature[];
};

type GpkgContentsRow = {
  table_name: string;
  data_type: string;
  srs_id: number;
};

type GeometryColumnRow = {
  table_name: string;
  column_name: string;
  geometry_type_name: string;
  srs_id: number;
};

type ColumnRow = { name: string };

type KobuksUnitRow = { id: number; unit_no: string };

function quoteIdentifier(identifier: string) {
  if (!identifier || identifier.includes("\u0000")) {
    throw new Error("GeoPackage tablo adı geçersiz.");
  }

  return `"${identifier.replace(/"/g, '""')}"`;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value).trim() || null;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new Error("GeoPackage içindeki geometri okunamadı.");
}

function readWkbPolygon(view: DataView, initialOffset: number) {
  const byteOrder = view.getUint8(initialOffset);
  if (byteOrder !== 0 && byteOrder !== 1) throw new Error("WKB koordinat byte sırası geçersiz.");
  const littleEndian = byteOrder === 1;
  const type = view.getUint32(initialOffset + 1, littleEndian);
  const baseType = type % 1000;
  if (baseType !== 3) throw new Error("GeoPackage katmanında Polygon olmayan geometri bulundu.");

  const dimensions = type >= 3000 ? 4 : type >= 1000 ? 3 : type >= 2000 ? 3 : 2;
  let offset = initialOffset + 5;
  const ringCount = view.getUint32(offset, littleEndian);
  offset += 4;
  if (ringCount > 10000) throw new Error("GeoPackage halkası beklenenden büyük.");
  const rings: number[][][] = [];

  for (let ring = 0; ring < ringCount; ring += 1) {
    const pointCount = view.getUint32(offset, littleEndian);
    offset += 4;
    if (pointCount > 100000) throw new Error("GeoPackage koordinat sayısı beklenenden büyük.");
    const points: number[][] = [];

    for (let point = 0; point < pointCount; point += 1) {
      const x = view.getFloat64(offset, littleEndian);
      const y = view.getFloat64(offset + 8, littleEndian);
      points.push([x, y]);
      offset += dimensions * 8;
    }
    rings.push(points);
  }

  return { rings, offset };
}

function parseGeoPackageGeometry(value: unknown): GeoJsonGeometry {
  const bytes = toUint8Array(value);
  if (bytes.byteLength < 13 || bytes[0] !== 0x47 || bytes[1] !== 0x50 || bytes[2] !== 0) {
    throw new Error("Dosyada geçerli GeoPackage geometrisi bulunamadı.");
  }

  const flags = bytes[3];
  if ((flags & 0x10) !== 0) throw new Error("Boş geometri içeren kayıt içe aktarılamıyor.");
  const littleEndian = (flags & 1) === 1;
  const envelopeType = (flags >> 1) & 7;
  const srsId = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(4, littleEndian);
  if (srsId !== 4326) {
    throw new Error(`GeoPackage EPSG:${srsId} kullanıyor. Bu aktarım EPSG:4326 bekliyor.`);
  }

  const envelopeBytes = envelopeType === 0 ? 0 : envelopeType === 1 ? 32 : envelopeType === 2 || envelopeType === 3 ? 48 : 64;
  const wkbOffset = 8 + envelopeBytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteOrder = view.getUint8(wkbOffset);
  const wkbType = view.getUint32(wkbOffset + 1, byteOrder === 1);
  const baseType = wkbType % 1000;

  if (baseType === 3) {
    const polygon = readWkbPolygon(view, wkbOffset);
    return { type: "Polygon", coordinates: polygon.rings };
  }

  if (baseType === 6) {
    let offset = wkbOffset + 5;
    const polygonCount = view.getUint32(offset, byteOrder === 1);
    offset += 4;
    if (polygonCount > 10000) throw new Error("GeoPackage çok fazla çoklu poligon içeriyor.");
    const coordinates: number[][][][] = [];

    for (let index = 0; index < polygonCount; index += 1) {
      const polygon = readWkbPolygon(view, offset);
      coordinates.push(polygon.rings);
      offset = polygon.offset;
    }
    return { type: "MultiPolygon", coordinates };
  }

  throw new Error(`GeoPackage geometri türü desteklenmiyor (WKB ${baseType}).`);
}

function mapFeature(row: Record<string, unknown>, available: Set<string>): Omit<QFieldFeature, "matched_kobuks_unit_id"> {
  const idValue = available.has("id") ? row.id : null;
  const unitValue = available.has("uniteno") ? row.uniteno : null;
  const feature: Record<string, unknown> = {
    source_fid: asNumber(row.fid),
    qfield_id: asText(idValue),
    unit_no: asText(unitValue),
    geometry_geojson: parseGeoPackageGeometry(row.geom),
  };

  for (const [sourceName, targetName] of Object.entries(GEOJSON_FIELDS)) {
    if (!available.has(sourceName) || feature[targetName] !== undefined) continue;
    const value = row[sourceName];
    feature[targetName] =
      targetName === "area_m2" || targetName === "score" || targetName === "roof_width" || targetName === "gutter_height"
        ? asNumber(value)
        : asText(value);
  }

  return feature as unknown as Omit<QFieldFeature, "matched_kobuks_unit_id">;
}

async function findMatchingKobuksUnits(unitNos: string[]) {
  const matches = new Map<string, number>();
  const uniqueUnitNos = [...new Set(unitNos.filter(Boolean))];

  for (let offset = 0; offset < uniqueUnitNos.length; offset += 100) {
    const part = uniqueUnitNos.slice(offset, offset + 100);
    const result = await supabase.from("kobuks_units").select("id,unit_no").in("unit_no", part);
    if (result.error) throw result.error;
    (result.data || []).forEach((unit: KobuksUnitRow) => matches.set(String(unit.unit_no), Number(unit.id)));
  }

  return matches;
}

export async function inspectQFieldGeoPackage(file: File): Promise<QFieldImportPreview> {
  if (!file.name.toLowerCase().endsWith(".gpkg")) {
    throw new Error("Lütfen .gpkg uzantılı GeoPackage dosyası seçin.");
  }
  if (file.size > MAX_GPKG_BYTES) {
    throw new Error("GeoPackage boyutu 50 MB sınırını aşıyor.");
  }

  const bytes = await file.bytes();
  const shaBuffer = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  const sha256 = [...new Uint8Array(shaBuffer)].map((part) => part.toString(16).padStart(2, "0")).join("");
  const db = await SQLite.deserializeDatabaseAsync(bytes);

  try {
    const integrity = await db.getFirstAsync<{ quick_check: string }>("PRAGMA quick_check");
    if (integrity?.quick_check !== "ok") throw new Error("GeoPackage SQLite bütünlük kontrolünden geçemedi.");

    const layers = await db.getAllAsync<GpkgContentsRow>(
      "SELECT table_name, data_type, srs_id FROM gpkg_contents WHERE data_type = 'features' ORDER BY table_name",
    );
    const candidates: { tableName: string; geom: GeometryColumnRow }[] = [];

    for (const layer of layers) {
      const geom = await db.getFirstAsync<GeometryColumnRow>(
        "SELECT table_name, column_name, geometry_type_name, srs_id FROM gpkg_geometry_columns WHERE table_name = ?",
        layer.table_name,
      );
      if (geom && ["POLYGON", "MULTIPOLYGON"].includes(geom.geometry_type_name.toUpperCase()) && geom.srs_id === 4326) {
        candidates.push({ tableName: layer.table_name, geom });
      }
    }

    if (candidates.length !== 1) {
      throw new Error(
        candidates.length === 0
          ? "EPSG:4326 Polygon/MultiPolygon katmanı bulunamadı."
          : "Dosyada birden fazla uygun katman var; lütfen yalnızca sınıflandırma katmanını içeren GeoPackage seçin.",
      );
    }

    const { tableName, geom } = candidates[0];
    const columns = await db.getAllAsync<ColumnRow>(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
    const available = new Set(columns.map((column) => column.name));
    if (!available.has("fid") || !available.has(geom.column_name)) {
      throw new Error("Sınıflandırma katmanında GeoPackage fid/geometri alanı eksik.");
    }

    const sourceColumns = ["fid", geom.column_name, ...Object.keys(GEOJSON_FIELDS), "id", "uniteno"];
    const selectColumns = [...new Set(sourceColumns)].filter((name) => available.has(name));
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT ${selectColumns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(tableName)} ORDER BY ${quoteIdentifier("fid")}`,
    );
    if (rows.length === 0) throw new Error("Sınıflandırma katmanında kayıt yok.");
    if (rows.length > MAX_FEATURES) throw new Error("GeoPackage 10.000 kayıt sınırını aşıyor.");

    const sourceFeatures = rows.map((row) => mapFeature({ ...row, geom: row[geom.column_name] }, available));
    const matches = await findMatchingKobuksUnits(sourceFeatures.map((feature) => feature.unit_no || ""));
    const missingIdentifierCount = sourceFeatures.filter((feature) => !feature.unit_no && !feature.qfield_id).length;
    const features: QFieldFeature[] = sourceFeatures.map((feature) => ({
      ...feature,
      matched_kobuks_unit_id: feature.unit_no ? matches.get(feature.unit_no) || null : null,
    }));
    const matchedCount = features.filter((feature) => feature.matched_kobuks_unit_id !== null).length;
    const duplicate = await supabase
      .from("qfield_import_batches")
      .select("id")
      .eq("file_sha256", sha256)
      .maybeSingle();
    if (duplicate.error) throw duplicate.error;

    return {
      fileName: file.name,
      sha256,
      sourceLayer: tableName,
      featureCount: features.length,
      matchedCount,
      unmatchedCount: features.length - matchedCount,
      missingIdentifierCount,
      duplicateBatchId: duplicate.data?.id || null,
      features,
    };
  } finally {
    await db.closeAsync();
  }
}

export async function saveQFieldImport(preview: QFieldImportPreview) {
  if (preview.duplicateBatchId) {
    throw new Error("Bu GeoPackage sürümü daha önce içe aktarılmış.");
  }

  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error("İçe aktarmak için oturum açmanız gerekiyor.");

  const batchResult = await supabase
    .from("qfield_import_batches")
    .insert({
      file_sha256: preview.sha256,
      file_name: preview.fileName.slice(0, 255),
      source_layer: preview.sourceLayer.slice(0, 255),
      feature_count: preview.featureCount,
      matched_count: preview.matchedCount,
      unmatched_count: preview.unmatchedCount,
      missing_identifier_count: preview.missingIdentifierCount,
      imported_by: userResult.user.id,
    })
    .select("id")
    .single();

  if (batchResult.error || !batchResult.data) throw batchResult.error || new Error("İçe aktarma kaydı oluşturulamadı.");

  try {
    for (let offset = 0; offset < preview.features.length; offset += 50) {
      const rows = preview.features.slice(offset, offset + 50).map((feature) => ({
        ...feature,
        import_batch_id: batchResult.data.id,
      }));
      const insertResult = await supabase.from("qfield_classifications").insert(rows);
      if (insertResult.error) throw insertResult.error;
    }
  } catch (error) {
    await supabase.from("qfield_import_batches").delete().eq("id", batchResult.data.id);
    throw error;
  }

  qfieldMapGeneration += 1;
  qfieldMapCache = null;
  qfieldMapRequest = null;
  return batchResult.data.id as string;
}

export type QFieldUnmatchedRecord = {
  id: string;
  source_fid: number;
  qfield_id: string | null;
  unit_no: string | null;
};

export async function loadLatestQFieldBatchId(): Promise<string | null> {
  const result = await supabase
    .from("qfield_import_batches")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data?.id || null;
}

export async function loadQFieldUnmatchedRecords(batchId: string): Promise<QFieldUnmatchedRecord[]> {
  const result = await supabase
    .from("qfield_classifications")
    .select("id,source_fid,qfield_id,unit_no")
    .eq("import_batch_id", batchId)
    .is("matched_kobuks_unit_id", null)
    .order("source_fid", { ascending: true });
  if (result.error) throw result.error;
  return (result.data || []) as QFieldUnmatchedRecord[];
}

export async function searchKobuksUnits(query: string): Promise<KobuksUnitRow[]> {
  const normalized = query.trim();
  if (normalized.length < 2) return [];
  const result = await supabase
    .from("kobuks_units")
    .select("id,unit_no")
    .ilike("unit_no", `%${normalized.replace(/[%_]/g, "\\$&")}%`)
    .order("unit_no", { ascending: true })
    .limit(20);
  if (result.error) throw result.error;
  return (result.data || []) as KobuksUnitRow[];
}

export async function resolveQFieldUnit(featureId: string, unitId: number) {
  const result = await supabase
    .from("qfield_classifications")
    .update({ matched_kobuks_unit_id: unitId })
    .eq("id", featureId)
    .is("matched_kobuks_unit_id", null);
  if (result.error) throw result.error;
}

export type QFieldExportRecord = {
  source_fid: number;
  qfield_id: string | null;
  unit_no: string | null;
  area_m2: number | null;
  unit_type: string | null;
  score: number | null;
  judgment: string | null;
  district: string | null;
  neighborhood: string | null;
  geometry_geojson: GeoJsonGeometry;
  kobuks_unit_no: string | null;
  kobuks_ada_no: string | null;
  kobuks_parcel_no: string | null;
  kobuks_greenhouse_area: number | null;
  kobuds_task_id: number | null;
  kobuds_task_status: string | null;
};

function wkbPolygon(geometry: GeoJsonGeometry): Uint8Array {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const multi = geometry.type === "MultiPolygon";
  const sizeOfPolygon = (rings: number[][][]) => 1 + 4 + 4 + rings.reduce((sum, ring) => sum + 4 + ring.length * 16, 0);
  const size = multi ? 1 + 4 + 4 + polygons.reduce((sum, polygon) => sum + sizeOfPolygon(polygon), 0) : sizeOfPolygon(polygons[0]);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let offset = 0;

  const writePolygon = (rings: number[][][]) => {
    view.setUint8(offset, 1);
    view.setUint32(offset + 1, 3, true);
    view.setUint32(offset + 5, rings.length, true);
    offset += 9;
    for (const ring of rings) {
      view.setUint32(offset, ring.length, true);
      offset += 4;
      for (const [x, y] of ring) {
        view.setFloat64(offset, x, true);
        view.setFloat64(offset + 8, y, true);
        offset += 16;
      }
    }
  };

  if (multi) {
    view.setUint8(offset, 1);
    view.setUint32(offset + 1, 6, true);
    view.setUint32(offset + 5, polygons.length, true);
    offset += 9;
    polygons.forEach(writePolygon);
  } else {
    writePolygon(polygons[0]);
  }

  return bytes;
}

function gpkgGeometry(geometry: GeoJsonGeometry) {
  const wkb = wkbPolygon(geometry);
  const bytes = new Uint8Array(8 + wkb.length);
  bytes[0] = 0x47;
  bytes[1] = 0x50;
  bytes[2] = 0;
  bytes[3] = 1;
  new DataView(bytes.buffer).setInt32(4, 4326, true);
  bytes.set(wkb, 8);
  return bytes;
}

export async function loadLatestQFieldExportRecords(): Promise<QFieldExportRecord[]> {
  const batchResult = await supabase
    .from("qfield_import_batches")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (batchResult.error) throw batchResult.error;
  if (!batchResult.data) throw new Error("Önce bir QGIS GeoPackage içe aktarın.");

  const featuresResult = await supabase
    .from("qfield_classifications")
    .select("source_fid,qfield_id,unit_no,area_m2,unit_type,score,judgment,district,neighborhood,geometry_geojson,matched_kobuks_unit_id")
    .eq("import_batch_id", batchResult.data.id)
    .not("matched_kobuks_unit_id", "is", null)
    .order("source_fid", { ascending: true });
  if (featuresResult.error) throw featuresResult.error;

  const kobuksIds = [...new Set((featuresResult.data || []).map((feature) => feature.matched_kobuks_unit_id).filter(Boolean))] as number[];
  const kobuksById = new Map<number, any>();
  for (let offset = 0; offset < kobuksIds.length; offset += 100) {
    const result = await supabase
      .from("kobuks_units")
      .select("id,unit_no,ada_no,parcel_no,greenhouse_area")
      .in("id", kobuksIds.slice(offset, offset + 100));
    if (result.error) throw result.error;
    (result.data || []).forEach((unit) => kobuksById.set(Number(unit.id), unit));
  }

  const unitNos = [...new Set((featuresResult.data || []).map((feature) => feature.unit_no).filter(Boolean))] as string[];
  const tasksByUnitNo = new Map<string, any>();
  for (let offset = 0; offset < unitNos.length; offset += 100) {
    const result = await supabase
      .from("tasks")
      .select("id,unit_no,status,workflow_status,created_at")
      .in("unit_no", unitNos.slice(offset, offset + 100))
      .order("created_at", { ascending: false });
    if (result.error) throw result.error;
    (result.data || []).forEach((task) => {
      if (!tasksByUnitNo.has(String(task.unit_no))) tasksByUnitNo.set(String(task.unit_no), task);
    });
  }

  return (featuresResult.data || []).map((feature: any) => {
    const kobuks = kobuksById.get(Number(feature.matched_kobuks_unit_id));
    const task = feature.unit_no ? tasksByUnitNo.get(String(feature.unit_no)) : null;
    return {
      source_fid: Number(feature.source_fid),
      qfield_id: feature.qfield_id,
      unit_no: feature.unit_no,
      area_m2: feature.area_m2 === null ? null : Number(feature.area_m2),
      unit_type: feature.unit_type,
      score: feature.score === null ? null : Number(feature.score),
      judgment: feature.judgment,
      district: feature.district,
      neighborhood: feature.neighborhood,
      geometry_geojson: feature.geometry_geojson as GeoJsonGeometry,
      kobuks_unit_no: kobuks?.unit_no || null,
      kobuks_ada_no: kobuks?.ada_no || null,
      kobuks_parcel_no: kobuks?.parcel_no || null,
      kobuks_greenhouse_area: kobuks?.greenhouse_area === null || kobuks?.greenhouse_area === undefined ? null : Number(kobuks.greenhouse_area),
      kobuds_task_id: task ? Number(task.id) : null,
      kobuds_task_status: task?.workflow_status || task?.status || null,
    };
  });
}

function normalizeQFieldMapRows(rows: any[]) {
  return (rows || []).flatMap((row: any) => {
    const geometry = row.geometry_geojson as GeoJsonGeometry | null;
    if (!geometry) return [];
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return polygons.flatMap((rings, partIndex) => {
      const toPoints = (ring: number[][]) => ring.map(([longitude, latitude]) => ({ latitude: Number(latitude), longitude: Number(longitude) }))
        .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
      const polygon = toPoints(rings?.[0] || []);
      if (polygon.length < 4) return [];
      const holes = (rings || []).slice(1).map(toPoints).filter((ring) => ring.length >= 4);
      return [{ id: `${row.id}:${partIndex}`, polygon, holes, label: [row.unit_no, row.score, row.judgment].filter(Boolean).join(" · ") }];
    });
  });
}

export async function loadLatestQFieldMapFeatures() {
  if (qfieldMapCache && Date.now() - qfieldMapCache.loadedAt < QFIELD_MAP_CACHE_MS) return qfieldMapCache.features;
  if (qfieldMapRequest) return qfieldMapRequest;
  const generation = qfieldMapGeneration;
  const request = loadLatestQFieldMapFeaturesFresh();
  qfieldMapRequest = request;
  try {
    const features = await request;
    if (generation === qfieldMapGeneration) qfieldMapCache = { loadedAt: Date.now(), features };
    return features;
  } finally {
    if (qfieldMapRequest === request) qfieldMapRequest = null;
  }
}

async function loadLatestQFieldMapFeaturesFresh() {
  const batch = await supabase.from("qfield_import_batches").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (batch.error) throw batch.error;
  if (!batch.data) return [];
  const result = await supabase.from("qfield_classifications")
    .select("id,unit_no,score,judgment,geometry_geojson")
    .eq("import_batch_id", batch.data.id)
    .limit(1500);
  if (result.error) throw result.error;
  return normalizeQFieldMapRows(result.data || []);
}

export async function createQFieldFeedbackGeoPackage(records: QFieldExportRecord[]) {
  if (!records.length) throw new Error("Dışa aktarılacak sera verisi bulunamadı.");

  const outputName = `kobuds-qfield-feedback-${new Date().toISOString().slice(0, 10)}.gpkg`;
  const outputDirectory = new Directory(Paths.cache, "qfield-exports");
  outputDirectory.create({ intermediates: true, idempotent: true });
  const outputFile = new File(outputDirectory, outputName);
  outputFile.create({ intermediates: true, overwrite: true });
  const db = await SQLite.openDatabaseAsync(outputName, {}, outputDirectory.uri);

  try {
    await db.execAsync(`
      PRAGMA application_id = 1196444487;
      PRAGMA user_version = 10300;
      CREATE TABLE gpkg_spatial_ref_sys (
        srs_name TEXT NOT NULL,
        srs_id INTEGER NOT NULL PRIMARY KEY,
        organization TEXT NOT NULL,
        organization_coordsys_id INTEGER NOT NULL,
        definition TEXT NOT NULL,
        description TEXT
      );
      INSERT INTO gpkg_spatial_ref_sys VALUES
        ('Undefined Cartesian SRS',-1,'NONE',-1,'undefined','undefined Cartesian coordinate reference system'),
        ('Undefined Geographic SRS',0,'NONE',0,'undefined','undefined geographic coordinate reference system'),
        ('WGS 84 geodetic',4326,'EPSG',4326,'GEOGCS["WGS 84",DATUM["World Geodetic System 1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AXIS["Latitude",NORTH],AXIS["Longitude",EAST],AUTHORITY["EPSG","4326"]]','longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid');
      CREATE TABLE gpkg_contents (
        table_name TEXT NOT NULL PRIMARY KEY,
        data_type TEXT NOT NULL,
        identifier TEXT UNIQUE,
        description TEXT DEFAULT '',
        last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE,
        srs_id INTEGER,
        FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
      );
      CREATE TABLE gpkg_geometry_columns (
        table_name TEXT NOT NULL,
        column_name TEXT NOT NULL,
        geometry_type_name TEXT NOT NULL,
        srs_id INTEGER NOT NULL,
        z TINYINT NOT NULL,
        m TINYINT NOT NULL,
        PRIMARY KEY (table_name, column_name),
        FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
        FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
      );
      CREATE TABLE kobuds_feedback (
        fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        geom MULTIPOLYGON,
        qfield_fid INTEGER,
        qfield_id TEXT,
        unit_no TEXT,
        unit_type TEXT,
        area_m2 REAL,
        score REAL,
        judgment TEXT,
        district TEXT,
        neighborhood TEXT,
        kobuks_unit_no TEXT,
        kobuks_ada_no TEXT,
        kobuks_parcel_no TEXT,
        kobuks_greenhouse_area REAL,
        kobuds_task_id INTEGER,
        kobuds_task_status TEXT
      );
      INSERT INTO gpkg_contents (table_name,data_type,identifier,description,srs_id)
        VALUES ('kobuds_feedback','features','KOBÜDS geri bildirim','KOBÜDS tarafından dışa aktarılan eşleştirilmiş sera bilgileri',4326);
      INSERT INTO gpkg_geometry_columns (table_name,column_name,geometry_type_name,srs_id,z,m)
        VALUES ('kobuds_feedback','geom','MULTIPOLYGON',4326,0,0);
    `);

    const insert = await db.prepareAsync(
      `INSERT INTO kobuds_feedback (geom,qfield_fid,qfield_id,unit_no,unit_type,area_m2,score,judgment,district,neighborhood,kobuks_unit_no,kobuks_ada_no,kobuks_parcel_no,kobuks_greenhouse_area,kobuds_task_id,kobuds_task_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    try {
      await db.withTransactionAsync(async () => {
        for (const record of records) {
          const polygons = record.geometry_geojson.type === "Polygon" ? [record.geometry_geojson.coordinates] : record.geometry_geojson.coordinates;
          const allPoints = polygons.flat(2);
          allPoints.forEach(([x, y]) => {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          });
          const multi: GeoJsonGeometry = record.geometry_geojson.type === "Polygon"
            ? { type: "MultiPolygon", coordinates: [record.geometry_geojson.coordinates] }
            : record.geometry_geojson;
          await insert.executeAsync(
            gpkgGeometry(multi),
            record.source_fid,
            record.qfield_id,
            record.unit_no,
            record.unit_type,
            record.area_m2,
            record.score,
            record.judgment,
            record.district,
            record.neighborhood,
            record.kobuks_unit_no,
            record.kobuks_ada_no,
            record.kobuks_parcel_no,
            record.kobuks_greenhouse_area,
            record.kobuds_task_id,
            record.kobuds_task_status,
          );
        }
        await db.runAsync(
          "UPDATE gpkg_contents SET min_x=?,min_y=?,max_x=?,max_y=?,last_change=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE table_name='kobuds_feedback'",
          minX,
          minY,
          maxX,
          maxY,
        );
      });
    } finally {
      await insert.finalizeAsync();
    }
  } finally {
    await db.closeAsync();
  }

  return outputFile;
}
