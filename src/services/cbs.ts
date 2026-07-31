import { AKSU_SOLAK_UNITS } from "../data/aksuSolakUnits";
import { supabase } from "../lib/supabase";
import { fixMojibake, fixRecordText } from "../utils/text";
import { getTaskWorkflowKind, isTaskCancelled, isTaskCompleted, type TaskWorkflowKind } from "./workflowGuard";

export type UnitStatus = "aktif" | "inceleme" | "ihlal" | "taslak";

export type MapPoint = {
  latitude: number;
  longitude: number;
};

export type CbsUnit = {
  id: string;
  origin?: "qgis" | "kobuks" | "greenhouse" | "task" | "manual";
  cbsUnitId?: string;
  cbsStorageId?: string;
  greenhouseUnitId?: string;
  parcelOnly?: boolean;
  producerId?: string;
  producerName: string;
  producerTc: string;
  producerPhone?: string;
  registrationNo: string;
  unitNo: string;
  city: string;
  district: string;
  village: string;
  adaNo: string;
  parcelNo: string;
  crop: string;
  greenhouseArea: number;
  status: UnitStatus;
  violationNote?: string;
  qgisRule?: "Veri Yok" | "Kötü" | string;
  qgisPuan?: number | string | null;
  parcelPolygon: MapPoint[];
  greenhousePolygon: MapPoint[];
};

export type CbsParcel = {
  id: string;
  tkgmParcelId?: string;
  city: string;
  district: string;
  village: string;
  adaNo: string;
  parcelNo: string;
  source: string;
  sourceAccuracy?: string;
  polygon: MapPoint[];
};

export type CbsLookupHint = {
  label: string;
  value: string;
};

export type LoadCbsUnitsOptions = {
  includeKobuks?: boolean;
  kobuksQuery?: string;
  kobuksLimit?: number;
};

export type SaveCbsPolygonOptions = {
  taskId?: string | number | null;
  taskDescription?: string | null;
};

export type StartInspectionOptions = {
  unassigned?: boolean;
};

export const AKSU_SOLAK_QGIS_PROJECT = {
  title: "Aksu-Solak-Sera-Sınıflandırma",
  crs: "EPSG:4326",
  extent: {
    xmin: 30.87886238098145,
    ymin: 36.93894195556641,
    xmax: 30.92728233337402,
    ymax: 36.97416305541992,
  },
  satelliteLayerName: "Google Maps",
  satelliteLayerUrl: "http://mt0.google.com/vt/lyrs=s&hl=en&x={x}&y={y}&z={z}",
  labelField: "Puan",
  rules: {
    noData: {
      label: "Veri Yok",
      filter: '"Ünite Tipi" is null',
      color: "#e30c36",
    },
    poor: {
      label: "Kötü",
      filter: '"Ünite Tipi" is not null',
      color: "#1b44d9",
    },
  },
};

export const ANTALYA_REGION = {
  latitude: 36.95655250549316,
  longitude: 30.903072357177735,
  latitudeDelta: 0.044,
  longitudeDelta: 0.056,
};

export const STATUS_LABEL: Record<UnitStatus, string> = {
  aktif: "Kayıtlı sera",
  inceleme: "Denetime gidilecek",
  ihlal: "Riskli sera",
  taslak: "Eksik bilgi",
};

export const STATUS_COLOR: Record<UnitStatus, string> = {
  aktif: "#22c55e",
  inceleme: "#38bdf8",
  ihlal: "#ef4444",
  taslak: "#f59e0b",
};

const SAMPLE_UNITS: CbsUnit[] = [
  {
    id: "sample-1",
    producerName: "Örnek Üretici",
    producerTc: "00000000000",
    producerPhone: "05321234567",
    registrationNo: "KOBUKS-2026-001",
    unitNo: "KU-001",
    city: "Antalya",
    district: "Aksu",
    village: "Kundu",
    adaNo: "215",
    parcelNo: "14",
    crop: "Domates",
    greenhouseArea: 12840,
    status: "aktif",
    parcelPolygon: [
      { latitude: 36.86855, longitude: 30.85855 },
      { latitude: 36.86858, longitude: 30.86225 },
      { latitude: 36.86662, longitude: 30.8623 },
      { latitude: 36.86658, longitude: 30.8586 },
    ],
    greenhousePolygon: [
      { latitude: 36.86812, longitude: 30.85918 },
      { latitude: 36.86812, longitude: 30.86142 },
      { latitude: 36.86705, longitude: 30.86145 },
      { latitude: 36.86703, longitude: 30.85922 },
    ],
  },
  {
    id: "sample-2",
    producerName: "KOBÜKS Sera İşletmesi",
    producerTc: "11111111111",
    producerPhone: "05329876543",
    registrationNo: "KOBUKS-2026-002",
    unitNo: "KU-002",
    city: "Antalya",
    district: "Aksu",
    village: "Altıntaş",
    adaNo: "218",
    parcelNo: "21",
    crop: "Biber",
    greenhouseArea: 9200,
    status: "ihlal",
    violationNote: "CBS sınırı ile beyan edilen kapalı alan uyumsuz.",
    parcelPolygon: [
      { latitude: 36.91865, longitude: 30.82435 },
      { latitude: 36.9187, longitude: 30.82895 },
      { latitude: 36.91642, longitude: 30.829 },
      { latitude: 36.91638, longitude: 30.82442 },
    ],
    greenhousePolygon: [
      { latitude: 36.91808, longitude: 30.82518 },
      { latitude: 36.9181, longitude: 30.82828 },
      { latitude: 36.91702, longitude: 30.8283 },
      { latitude: 36.917, longitude: 30.82522 },
    ],
  },
  {
    id: "sample-3",
    producerName: "Aksu Sera Kooperatifi",
    producerTc: "22222222222",
    producerPhone: "05335551122",
    registrationNo: "KOBUKS-2026-003",
    unitNo: "KU-003",
    city: "Antalya",
    district: "Aksu",
    village: "Solak",
    adaNo: "310",
    parcelNo: "27",
    crop: "Salatalık",
    greenhouseArea: 7600,
    status: "inceleme",
    parcelPolygon: [
      { latitude: 36.95408, longitude: 30.8712 },
      { latitude: 36.9541, longitude: 30.87615 },
      { latitude: 36.9519, longitude: 30.87618 },
      { latitude: 36.95188, longitude: 30.87125 },
    ],
    greenhousePolygon: [
      { latitude: 36.95348, longitude: 30.87205 },
      { latitude: 36.9535, longitude: 30.8752 },
      { latitude: 36.95245, longitude: 30.87522 },
      { latitude: 36.95243, longitude: 30.87208 },
    ],
  },
  {
    id: "sample-4",
    producerName: "Aksu Merkez Üretici",
    producerTc: "33333333333",
    producerPhone: "05337778899",
    registrationNo: "KOBUKS-2026-004",
    unitNo: "KU-004",
    city: "Antalya",
    district: "Aksu",
    village: "Kurşunlu",
    adaNo: "148",
    parcelNo: "6",
    crop: "Patlıcan",
    greenhouseArea: 5400,
    status: "taslak",
    parcelPolygon: [
      { latitude: 36.96695, longitude: 30.81425 },
      { latitude: 36.96698, longitude: 30.81845 },
      { latitude: 36.96492, longitude: 30.81848 },
      { latitude: 36.9649, longitude: 30.8143 },
    ],
    greenhousePolygon: [
      { latitude: 36.96642, longitude: 30.81502 },
      { latitude: 36.96643, longitude: 30.81762 },
      { latitude: 36.96545, longitude: 30.81765 },
      { latitude: 36.96543, longitude: 30.81505 },
    ],
  },
];

export function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toStatus(value: unknown): UnitStatus {
  const text = String(value || "").toLocaleLowerCase("tr-TR");
  if (text.includes("ihlal")) return "ihlal";
  if (text.includes("inceleme") || text.includes("saha")) return "inceleme";
  if (text.includes("aktif")) return "aktif";
  return "taslak";
}

export function buildFallbackPolygon(center: MapPoint): MapPoint[] {
  const delta = 0.00012;
  return [
    { latitude: center.latitude + delta, longitude: center.longitude - delta },
    { latitude: center.latitude + delta, longitude: center.longitude + delta },
    { latitude: center.latitude - delta, longitude: center.longitude + delta },
    { latitude: center.latitude - delta, longitude: center.longitude - delta },
  ];
}

export function isDefaultCbsFallbackPolygon(points?: MapPoint[]) {
  if (!isValidPolygon(points)) {
    return false;
  }

  const center = getCenter(points);
  return (
    Math.abs(center.latitude - ANTALYA_REGION.latitude) < 0.00001 &&
    Math.abs(center.longitude - ANTALYA_REGION.longitude) < 0.00001
  );
}

export function parsePolygon(value: unknown, center: MapPoint): MapPoint[] {
  if (typeof value === "string") {
    try {
      return parsePolygon(JSON.parse(value), center);
    } catch {
      return buildFallbackPolygon(center);
    }
  }

  if (Array.isArray(value)) {
    const points = value
      .map((item) => ({
        latitude: toNumber(item?.latitude ?? item?.lat, NaN),
        longitude: toNumber(item?.longitude ?? item?.lng, NaN),
      }))
      .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));

    if (points.length >= 3) return points;
  }

  return buildFallbackPolygon(center);
}

export function getCenter(points: MapPoint[]) {
  if (!points.length) {
    return {
      latitude: ANTALYA_REGION.latitude,
      longitude: ANTALYA_REGION.longitude,
    };
  }

  const total = points.reduce(
    (sum, point) => ({
      latitude: sum.latitude + point.latitude,
      longitude: sum.longitude + point.longitude,
    }),
    { latitude: 0, longitude: 0 },
  );

  return {
    latitude: total.latitude / points.length,
    longitude: total.longitude / points.length,
  };
}

function distanceMeters(first: MapPoint, second: MapPoint) {
  const earthRadius = 6371000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(second.latitude - first.latitude);
  const dLng = toRadians(second.longitude - first.longitude);
  const lat1 = toRadians(first.latitude);
  const lat2 = toRadians(second.latitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculatePolygonArea(points: MapPoint[]) {
  if (points.length < 3) {
    return 0;
  }

  const earthRadius = 6378137;
  const originLatitude = (points.reduce((sum, point) => sum + point.latitude, 0) / points.length) * (Math.PI / 180);
  const projected = points.map((point) => ({
    x: earthRadius * point.longitude * (Math.PI / 180) * Math.cos(originLatitude),
    y: earthRadius * point.latitude * (Math.PI / 180),
  }));

  const twiceArea = projected.reduce((sum, point, index) => {
    const next = projected[(index + 1) % projected.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);

  return Math.abs(twiceArea) / 2;
}

function getPolygonRadiusMeters(center: MapPoint, points: MapPoint[]) {
  return points.reduce((maxDistance, point) => Math.max(maxDistance, distanceMeters(center, point)), 0);
}

function isValidPolygon(points?: MapPoint[]) {
  return Array.isArray(points) && points.length >= 3;
}

function isPolygonUnsafeAgainstReference(candidate: MapPoint[], reference: MapPoint[]) {
  if (!isValidPolygon(candidate) || !isValidPolygon(reference)) {
    return false;
  }

  const referenceCenter = getCenter(reference);
  const candidateCenter = getCenter(candidate);
  const referenceRadius = Math.max(getPolygonRadiusMeters(referenceCenter, reference), 15);
  const candidateRadius = getPolygonRadiusMeters(referenceCenter, candidate);
  const referenceArea = calculatePolygonArea(reference);
  const candidateArea = calculatePolygonArea(candidate);
  const centerLimit = Math.max(140, referenceRadius * 1.75);
  const radiusLimit = Math.max(350, referenceRadius * 2.4);
  const areaLimit = Math.max(referenceArea * 1.9, referenceArea + 700);
  const minimumAreaLimit = referenceArea > 120 ? referenceArea * 0.22 : 0;

  return (
    distanceMeters(referenceCenter, candidateCenter) > centerLimit ||
    candidateRadius > radiusLimit ||
    (referenceArea > 0 && candidateArea > areaLimit) ||
    (minimumAreaLimit > 0 && candidateArea < minimumAreaLimit)
  );
}

function chooseSyncedPolygon(reference: MapPoint[], candidate: MapPoint[]) {
  if (isValidPolygon(reference) && !isValidPolygon(candidate)) {
    return reference;
  }

  if (!isValidPolygon(reference) && isValidPolygon(candidate)) {
    return candidate;
  }

  if (isDefaultCbsFallbackPolygon(reference) && isValidPolygon(candidate)) {
    return candidate;
  }

  if (isValidPolygon(reference) && isValidPolygon(candidate) && isPolygonUnsafeAgainstReference(candidate, reference)) {
    return reference;
  }

  return candidate;
}

function hasLookupValue(value: unknown) {
  const text = fixMojibake(value).trim();
  return Boolean(text && text !== "-" && text.toLocaleLowerCase("tr-TR") !== "null");
}

function isDatabaseUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );
}

function isDatabaseRecordId(value: unknown) {
  const normalized = String(value || "").trim();
  return isDatabaseUuid(normalized) || /^[1-9]\d*$/.test(normalized);
}

function joinLookupParts(values: unknown[], separator = " / ") {
  return values.map((value) => fixMojibake(value).trim()).filter(hasLookupValue).join(separator);
}

export function getCbsLookupHints(unit: CbsUnit): CbsLookupHint[] {
  const administrativePath = joinLookupParts([unit.city, unit.district, unit.village]);
  const parcelQuery = joinLookupParts([
    administrativePath,
    hasLookupValue(unit.adaNo) ? `Ada ${unit.adaNo}` : "",
    hasLookupValue(unit.parcelNo) ? `Parsel ${unit.parcelNo}` : "",
  ]);
  const unitQuery = joinLookupParts([
    hasLookupValue(unit.unitNo) ? `Ünite ${unit.unitNo}` : "",
    hasLookupValue(unit.producerTc) ? `Üretici ${unit.producerTc}` : "",
  ], " - ");

  return [
    { label: "Harita", value: "Bakanlık CBS parsel/sera katmanı" },
    parcelQuery ? { label: "CBS parsel araması", value: parcelQuery } : null,
    unitQuery ? { label: "KOBÜKS ünite araması", value: unitQuery } : null,
    hasLookupValue(unit.crop) ? { label: "Ürün eşleşmesi", value: fixMojibake(unit.crop) } : null,
  ].filter(Boolean) as CbsLookupHint[];
}

export function formatArea(value: number) {
  return `${Math.round(value).toLocaleString("tr-TR")} m²`;
}

export function formatCoord(value: number) {
  return value.toFixed(6);
}

export function getQgisRuleColor(unit: CbsUnit) {
  return unit.qgisRule === AKSU_SOLAK_QGIS_PROJECT.rules.poor.label
    ? AKSU_SOLAK_QGIS_PROJECT.rules.poor.color
    : AKSU_SOLAK_QGIS_PROJECT.rules.noData.color;
}

export function getQgisPuanLabel(unit: CbsUnit) {
  const value = unit.qgisPuan;

  if (value === null || value === undefined || value === "") {
    return "";
  }

  return String(value);
}

export function getQgisStatusLabel(unit: CbsUnit) {
  const score = Number(unit.qgisPuan);

  if (!Number.isFinite(score)) {
    return "Veri yok";
  }

  if (score < 50) return "Çok kötü";
  if (score < 100) return "Kötü";
  if (score < 200) return "Normal";
  if (score < 300) return "İyi";
  return "Çok iyi";
}

const KOBUKS_UNIT_SELECT = [
  "id",
  "created_at",
  "producer_tc",
  "unit_no",
  "ada_no",
  "parcel_no",
  "greenhouse_area",
  "parcel_area",
  "heating_type",
  "energy_type",
  "structure_type",
  "cover_material",
].join(",");

const KOBUKS_MAP_UNIT_SELECT = [
  KOBUKS_UNIT_SELECT,
  "cbs_unit_id",
  "greenhouse_unit_id",
  "parcel_polygon",
  "greenhouse_polygon",
  "latitude",
  "longitude",
].join(",");

const KOBUKS_PRODUCER_SELECT = [
  "id",
  "tc_no",
  "full_name",
  "phone",
  "city",
  "district",
  "village",
].join(",");

const KOBUKS_PRODUCTION_SELECT = [
  "unit_no",
  "crop_name",
].join(",");

const DEFAULT_KOBUKS_SEARCH_LIMIT = 120;
const CBS_REQUEST_TIMEOUT_MS = 8000;

async function runCbsQuery<T = any>(query: any, timeoutMs = CBS_REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await query.abortSignal(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeSearchToken(value: unknown) {
  return fixMojibake(value).trim();
}

function getSearchDigits(value: unknown) {
  return normalizeSearchToken(value).replace(/\D/g, "");
}

function splitParcelSearch(value: unknown) {
  const parts = normalizeSearchToken(value)
    .replace("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length >= 2 ? { adaNo: parts[0], parcelNo: parts[1] } : null;
}

function getStableRowKey(row: any) {
  return String(row?.id || row?.unit_no || `${row?.producer_tc || ""}-${row?.ada_no || ""}-${row?.parcel_no || ""}`);
}

async function addKobuksRowsFromQuery(
  rowsByKey: Map<string, any>,
  query: any,
  limit: number,
) {
  const result: any = await runCbsQuery(query.limit(limit));

  if (result.error) {
    throw result.error;
  }

  (result.data || []).forEach((row: any) => {
    rowsByKey.set(getStableRowKey(row), row);
  });
}

async function fetchKobuksRowsBySearch(query: string, limit: number) {
  const trimmed = normalizeSearchToken(query);
  const digits = getSearchDigits(trimmed);
  const parcelSearch = splitParcelSearch(trimmed);
  const rowsByKey = new Map<string, any>();

  if (!trimmed) {
    return [];
  }

  if (digits.length >= 10) {
    await addKobuksRowsFromQuery(
      rowsByKey,
      supabase.from("kobuks_units").select(KOBUKS_UNIT_SELECT).eq("producer_tc", digits),
      limit,
    );
  }

  await addKobuksRowsFromQuery(
    rowsByKey,
    supabase.from("kobuks_units").select(KOBUKS_UNIT_SELECT).eq("unit_no", trimmed),
    limit,
  );

  if (parcelSearch) {
    await addKobuksRowsFromQuery(
      rowsByKey,
      supabase
        .from("kobuks_units")
        .select(KOBUKS_UNIT_SELECT)
        .eq("ada_no", parcelSearch.adaNo)
        .eq("parcel_no", parcelSearch.parcelNo),
      limit,
    );
  } else if (trimmed.length >= 2 && rowsByKey.size < limit) {
    await addKobuksRowsFromQuery(
      rowsByKey,
      supabase
        .from("kobuks_units")
        .select(KOBUKS_UNIT_SELECT)
        .or(`unit_no.ilike.%${trimmed}%,ada_no.eq.${trimmed},parcel_no.eq.${trimmed}`),
      limit,
    ).catch(() => undefined);
  }

  if (trimmed.length >= 3 && rowsByKey.size < limit) {
    const producerResult: any = await runCbsQuery(
      supabase
        .from("kobuks_producers")
        .select(KOBUKS_PRODUCER_SELECT)
        .ilike("full_name", `%${trimmed}%`)
        .limit(25),
    );
    const producerTcs = uniqueFilledValues((producerResult.data || []).map((item: any) => item.tc_no));

    if (producerTcs.length) {
      await addKobuksRowsFromQuery(
        rowsByKey,
        supabase.from("kobuks_units").select(KOBUKS_UNIT_SELECT).in("producer_tc", producerTcs),
        Math.max(10, limit - rowsByKey.size),
      );
    }
  }

  return [...rowsByKey.values()].slice(0, limit);
}

async function fetchAllRows<T>(table: string, pageSize = 1000, select = "*"): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const result: any = await runCbsQuery(supabase.from(table).select(select).range(from, to));

    if (result.error) {
      if (select !== "*") {
        return fetchAllRows<T>(table, pageSize, "*");
      }

      throw result.error;
    }

    const page = (result.data || []) as T[];
    rows.push(...page);

    if (page.length < pageSize) {
      return rows;
    }
  }
}

async function fetchRowsByValues<T>(
  table: string,
  column: string,
  values: unknown[],
  select = "*",
  batchSize = 200,
): Promise<T[]> {
  const normalizedValues = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  const rows: T[] = [];

  for (let index = 0; index < normalizedValues.length; index += batchSize) {
    const result: any = await runCbsQuery(
      supabase.from(table).select(select).in(column, normalizedValues.slice(index, index + batchSize)),
      12000,
    );

    if (result.error) {
      throw result.error;
    }

    rows.push(...(result.data || []));
  }

  return rows;
}

const TKGM_PARCEL_SELECT = "id,tkgm_parcel_id,city,district,village,ada_no,parcel_no,parcel_polygon,latitude,longitude,source,source_accuracy";

function normalizeTkgmParcelRows(rows: any[]): CbsParcel[] {
  const parcels = new Map<string, CbsParcel>();

  rows.forEach((row) => {
    const source = String(row?.source || "").trim().toLocaleLowerCase("tr-TR");

    if (
      !hasStoredPolygonValue(row?.parcel_polygon) ||
      !["tkgm", "tkgm_authorized", "megsis_authorized", "tkgm_public_approx"].includes(source)
    ) {
      return;
    }

    const center = {
      latitude: toNumber(row.latitude, ANTALYA_REGION.latitude),
      longitude: toNumber(row.longitude, ANTALYA_REGION.longitude),
    };
    const polygon = parsePolygon(row.parcel_polygon, center);
    const key = String(
      row.tkgm_parcel_id ||
        [
          fixMojibake(row.city).trim().toLocaleLowerCase("tr-TR"),
          fixMojibake(row.district).trim().toLocaleLowerCase("tr-TR"),
          fixMojibake(row.village).trim().toLocaleLowerCase("tr-TR"),
          row.ada_no,
          row.parcel_no,
        ].join("|"),
    );

    parcels.set(key, {
      id: String(row.id || key),
      tkgmParcelId: row.tkgm_parcel_id ? String(row.tkgm_parcel_id) : undefined,
      city: fixMojibake(row.city || "-"),
      district: fixMojibake(row.district || "-"),
      village: fixMojibake(row.village || "-"),
      adaNo: String(row.ada_no || "-"),
      parcelNo: String(row.parcel_no || "-"),
      source,
      sourceAccuracy: row.source_accuracy ? String(row.source_accuracy) : undefined,
      polygon,
    });
  });

  return [...parcels.values()];
}

export async function loadTkgmParcels(): Promise<CbsParcel[]> {
  const rows = await fetchAllRows<any>("cbs_units", 1000, TKGM_PARCEL_SELECT).catch(async (error) => {
    if (!isCbsStorageSchemaError(error)) {
      throw error;
    }

    return fetchAllRows<any>("cbs_units");
  });

  return normalizeTkgmParcelRows(rows);
}

export async function loadTkgmParcelsForRegion(
  region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number },
  limit = 2500,
): Promise<CbsParcel[]> {
  const latitudePadding = Math.max(region.latitudeDelta * 0.12, 0.002);
  const longitudePadding = Math.max(region.longitudeDelta * 0.12, 0.002);
  const minLatitude = region.latitude - region.latitudeDelta / 2 - latitudePadding;
  const maxLatitude = region.latitude + region.latitudeDelta / 2 + latitudePadding;
  const minLongitude = region.longitude - region.longitudeDelta / 2 - longitudePadding;
  const maxLongitude = region.longitude + region.longitudeDelta / 2 + longitudePadding;
  const result: any = await runCbsQuery(
    supabase
      .from("cbs_units")
      .select(TKGM_PARCEL_SELECT)
      .in("source", ["tkgm", "tkgm_authorized", "megsis_authorized", "tkgm_public_approx"])
      .gte("latitude", minLatitude)
      .lte("latitude", maxLatitude)
      .gte("longitude", minLongitude)
      .lte("longitude", maxLongitude)
      .order("id", { ascending: true })
      .limit(limit),
    12000,
  );

  if (result.error) {
    throw result.error;
  }

  return normalizeTkgmParcelRows(result.data || []);
}

function normalizeLegacyUnit(raw: any): CbsUnit {
  const center = {
    latitude: toNumber(raw.latitude ?? raw.lat ?? raw.unit_latitude, ANTALYA_REGION.latitude),
    longitude: toNumber(raw.longitude ?? raw.lng ?? raw.unit_longitude, ANTALYA_REGION.longitude),
  };

  return {
    id: String(raw.id ?? raw.unit_no ?? raw.task_id ?? Date.now()),
    cbsUnitId: raw.cbs_unit_id ? String(raw.cbs_unit_id) : undefined,
    cbsStorageId: raw.cbs_storage_id ?? raw.cbs_unit_id
      ? String(raw.cbs_storage_id ?? raw.cbs_unit_id)
      : undefined,
    greenhouseUnitId: raw.greenhouse_unit_id ? String(raw.greenhouse_unit_id) : undefined,
    producerName: fixMojibake(raw.producer_name ?? raw.full_name ?? raw.name ?? "Üretici"),
    producerTc: String(raw.tc_no ?? raw.producer_tc ?? raw.producer_identity ?? "-"),
    producerPhone: String(raw.phone ?? raw.producer_phone ?? ""),
    registrationNo: String(raw.registration_no ?? raw.kobuks_no ?? raw.unit_no ?? "-"),
    unitNo: String(raw.unit_no ?? raw.greenhouse_no ?? "-"),
    city: fixMojibake(raw.city ?? raw.province ?? raw.il ?? "-"),
    district: fixMojibake(raw.district_name ?? raw.district ?? raw.ilce ?? "-"),
    village: fixMojibake(raw.village ?? raw.neighborhood ?? raw.mahalle ?? "-"),
    adaNo: String(raw.ada_no ?? raw.block_no ?? raw.ada ?? "-"),
    parcelNo: String(raw.parcel_no ?? raw.parsel ?? "-"),
    crop: fixMojibake(raw.detected_crop ?? raw.crop_name ?? raw.crop ?? "-"),
    greenhouseArea: toNumber(raw.greenhouse_area ?? raw.area_m2 ?? raw.area),
    status: toStatus(raw.registration_status ?? raw.workflow_status ?? raw.status),
    violationNote: raw.violation_note || raw.violationNote ? fixMojibake(raw.violation_note ?? raw.violationNote) : undefined,
    parcelPolygon: parsePolygon(raw.parcel_polygon ?? raw.parcelPolygon ?? raw.polygon, center),
    greenhousePolygon: parsePolygon(raw.greenhouse_polygon ?? raw.greenhousePolygon ?? raw.unit_polygon, center),
  };
}

function normalizeGreenhouseUnit(raw: any, parcel: any, producer: any, crop: any): CbsUnit {
  const center = {
    latitude: toNumber(raw.latitude ?? raw.lat, ANTALYA_REGION.latitude),
    longitude: toNumber(raw.longitude ?? raw.lng, ANTALYA_REGION.longitude),
  };

  return {
    id: String(raw.id ?? raw.unit_no),
    origin: "greenhouse",
    cbsUnitId: raw.cbs_unit_id ? String(raw.cbs_unit_id) : undefined,
    cbsStorageId: raw.cbs_unit_id ? String(raw.cbs_unit_id) : undefined,
    greenhouseUnitId: raw.id ? String(raw.id) : undefined,
    producerId: raw.producer_id ? String(raw.producer_id) : undefined,
    producerName: fixMojibake(producer?.full_name ?? raw.producer_name ?? "Üretici"),
    producerTc: String(producer?.tc_no ?? raw.producer_tc ?? "-"),
    producerPhone: String(producer?.phone ?? raw.phone ?? ""),
    registrationNo: String(raw.registration_no ?? raw.unit_no ?? "-"),
    unitNo: String(raw.unit_no ?? "-"),
    city: fixMojibake(parcel?.city ?? producer?.city ?? raw.city ?? "-"),
    district: fixMojibake(parcel?.district ?? producer?.district ?? raw.district ?? "-"),
    village: fixMojibake(parcel?.village ?? producer?.village ?? raw.village ?? "-"),
    adaNo: String(parcel?.ada_no ?? raw.ada_no ?? "-"),
    parcelNo: String(parcel?.parcel_no ?? raw.parcel_no ?? "-"),
    crop: fixMojibake(crop?.crop_name ?? raw.crop_name ?? "-"),
    greenhouseArea: toNumber(raw.greenhouse_area ?? raw.area_m2),
    status: toStatus(raw.status),
    parcelPolygon: parsePolygon(parcel?.parcel_polygon ?? raw.parcel_polygon, center),
    greenhousePolygon: parsePolygon(raw.greenhouse_polygon ?? raw.unit_polygon, center),
  };
}

function getUnitMergeAliases(unit: CbsUnit) {
  const aliases = [
    unit.greenhouseUnitId ? `greenhouse:${unit.greenhouseUnitId}` : "",
    hasLookupValue(unit.unitNo) ? `unit:${fixMojibake(unit.unitNo).trim().toLocaleLowerCase("tr-TR")}` : "",
    unit.id ? `id:${unit.id}` : "",
  ].filter(Boolean);

  if (!aliases.length && unit.cbsUnitId) {
    aliases.push(`cbs:${unit.cbsUnitId}`);
  }

  return aliases;
}

function mergeCbsUnit(existing: CbsUnit, incoming: CbsUnit): CbsUnit {
  const greenhousePolygon = chooseSyncedPolygon(existing.greenhousePolygon, incoming.greenhousePolygon);
  const parcelPolygon = chooseSyncedPolygon(existing.parcelPolygon, incoming.parcelPolygon);
  const keepingExistingGreenhouse = greenhousePolygon === existing.greenhousePolygon;

  return {
    ...existing,
    ...incoming,
    parcelPolygon,
    greenhousePolygon,
    greenhouseArea: keepingExistingGreenhouse ? existing.greenhouseArea : incoming.greenhouseArea || existing.greenhouseArea,
  };
}

export function mergeCbsUnits(...groups: CbsUnit[][]) {
  const unitsByKey = new Map<string, CbsUnit>();
  const aliasToKey = new Map<string, string>();
  let sequence = 0;

  groups.flat().forEach((unit) => {
    const aliases = getUnitMergeAliases(unit);
    const existingKey = aliases.map((alias) => aliasToKey.get(alias)).find(Boolean);
    const key = existingKey || `unit-${sequence++}`;
    const existing = unitsByKey.get(key);
    const merged = existing ? mergeCbsUnit(existing, unit) : unit;

    unitsByKey.set(key, merged);
    getUnitMergeAliases(merged).forEach((alias) => aliasToKey.set(alias, key));
  });

  return [...unitsByKey.values()];
}

function uniqueFilledValues(values: unknown[]) {
  const seen = new Set<string>();

  return values
    .map((value) => fixMojibake(value).trim())
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }

      seen.add(value);
      return true;
    });
}

function getProductionCropText(rows: any[] = []) {
  return uniqueFilledValues(rows.map((row) => row?.crop_name || row?.detected_crop || row?.crop)).join(", ");
}

function getParcelStorageKey(values: {
  city?: unknown;
  district?: unknown;
  district_name?: unknown;
  village?: unknown;
  ada_no?: unknown;
  parcel_no?: unknown;
  adaNo?: unknown;
  parcelNo?: unknown;
}) {
  return [
    fixMojibake(values.city).trim().toLocaleLowerCase("tr-TR"),
    fixMojibake(values.district ?? values.district_name).trim().toLocaleLowerCase("tr-TR"),
    fixMojibake(values.village).trim().toLocaleLowerCase("tr-TR"),
    String(values.ada_no ?? values.adaNo ?? "").trim(),
    String(values.parcel_no ?? values.parcelNo ?? "").trim(),
  ].join("|");
}

function normalizeKobuksImportedUnit(raw: any, producer: any, productionRows: any[], cbsParcel?: any): CbsUnit {
  const savedUnitPolygon = raw.greenhouse_polygon || raw.unit_polygon;
  const savedParcelPolygon = raw.parcel_polygon || cbsParcel?.parcel_polygon || cbsParcel?.polygon;

  return {
    ...normalizeLegacyUnit({
    ...raw,
    tc_no: producer?.tc_no || raw.producer_tc || raw.tc_no,
    producer_name: producer?.full_name || raw.producer_name || raw.full_name,
    phone: producer?.phone || raw.phone,
    city: producer?.city || raw.city || cbsParcel?.city || raw.province || raw.il,
    district: producer?.district || raw.district_name || raw.district || cbsParcel?.district || raw.ilce,
    village: producer?.village || raw.village || cbsParcel?.village || raw.neighborhood || raw.mahalle,
    producer_id: producer?.id || raw.producer_id,
    cbs_unit_id: raw.cbs_unit_id || cbsParcel?.id,
    cbs_storage_id: raw.cbs_storage_id || cbsParcel?.id,
    crop_name: getProductionCropText(productionRows) || raw.detected_crop || raw.crop_name || raw.crop,
    parcel_polygon: savedParcelPolygon,
    greenhouse_polygon: savedUnitPolygon,
    }),
    origin: "kobuks",
  };
}

export async function loadKobuksMapUnitsForParcels(parcels: CbsParcel[]) {
  if (!parcels.length) {
    return [];
  }

  const storedCbsParcels = parcels.map((parcel) => ({
    id: parcel.id,
    city: parcel.city,
    district: parcel.district,
    village: parcel.village,
    ada_no: parcel.adaNo,
    parcel_no: parcel.parcelNo,
    parcel_polygon: parcel.polygon,
  }));
  const rawByKey = new Map<string, any>();
  const parcelIds = storedCbsParcels.map((parcel) => parcel.id).filter(isDatabaseRecordId);
  const adaNos = uniqueFilledValues(storedCbsParcels.map((parcel) => parcel.ada_no));

  if (parcelIds.length) {
    await fetchRowsByValues<any>("kobuks_units", "cbs_unit_id", parcelIds, KOBUKS_MAP_UNIT_SELECT)
      .then((rows) => rows.forEach((row) => rawByKey.set(getStableRowKey(row), fixRecordText(row))))
      .catch(() => undefined);
  }

  if (adaNos.length) {
    await fetchRowsByValues<any>("kobuks_units", "ada_no", adaNos, KOBUKS_MAP_UNIT_SELECT)
      .then((rows) => rows.forEach((row) => rawByKey.set(getStableRowKey(row), fixRecordText(row))))
      .catch(() => undefined);
  }

  const storedCbsParcelByKey = new Map(storedCbsParcels.map((item) => [getParcelStorageKey(item), item]));
  const storedCbsParcelById = new Map(storedCbsParcels.map((item) => [String(item.id), item]));
  const linkedRows = [...rawByKey.values()].filter(
    (row) => storedCbsParcelById.has(String(row.cbs_unit_id || "")) || storedCbsParcelByKey.has(getParcelStorageKey(row)),
  );

  if (!linkedRows.length) {
    return [];
  }

  const producerTcs = uniqueFilledValues(linkedRows.map((row) => row.producer_tc || row.tc_no));
  const unitNos = uniqueFilledValues(linkedRows.map((row) => row.unit_no));
  const [producerResult, productionResult] = await Promise.allSettled([
    producerTcs.length
      ? runCbsQuery(supabase.from("kobuks_producers").select(KOBUKS_PRODUCER_SELECT).in("tc_no", producerTcs), 12000)
      : Promise.resolve({ data: [] }),
    unitNos.length
      ? runCbsQuery(supabase.from("kobuks_production").select(KOBUKS_PRODUCTION_SELECT).in("unit_no", unitNos), 12000)
      : Promise.resolve({ data: [] }),
  ]);
  const producers = new Map(
    ((producerResult.status === "fulfilled" ? producerResult.value : { data: [] }) as any).data?.map((item: any) => [String(item.tc_no), item]) || [],
  );
  const productionByUnit = (((productionResult.status === "fulfilled" ? productionResult.value : { data: [] }) as any).data || []).reduce(
    (map: Map<string, any[]>, item: any) => {
      const key = String(item.unit_no || "");
      if (key) map.set(key, [...(map.get(key) || []), item]);
      return map;
    },
    new Map<string, any[]>(),
  );

  return linkedRows.map((row) => {
    const parcel = storedCbsParcelById.get(String(row.cbs_unit_id || "")) || storedCbsParcelByKey.get(getParcelStorageKey(row));
    return normalizeKobuksImportedUnit(
      row,
      producers.get(String(row.producer_tc || row.tc_no || "")),
      productionByUnit.get(String(row.unit_no || "")) || [],
      parcel,
    );
  });
}

async function loadKobuksSearchUnits(query: string, storedCbsParcels: any[], limit: number) {
  const rawRows = (await fetchKobuksRowsBySearch(query, limit)).map((item) => fixRecordText(item));

  if (!rawRows.length) {
    return [];
  }

  const producerTcs = uniqueFilledValues(rawRows.map((row) => row.producer_tc || row.tc_no));
  const unitNos = uniqueFilledValues(rawRows.map((row) => row.unit_no));
  const [producerResult, productionResult] = await Promise.allSettled([
    producerTcs.length
      ? supabase.from("kobuks_producers").select(KOBUKS_PRODUCER_SELECT).in("tc_no", producerTcs)
      : Promise.resolve({ data: [] }),
    unitNos.length
      ? supabase.from("kobuks_production").select(KOBUKS_PRODUCTION_SELECT).in("unit_no", unitNos)
      : Promise.resolve({ data: [] }),
  ]);
  const producers = new Map(
    (producerResult.status === "fulfilled" ? producerResult.value.data || [] : []).map((item: any) => [String(item.tc_no), item]),
  );
  const productionRows = productionResult.status === "fulfilled" ? productionResult.value.data || [] : [];
  const productionByUnit = productionRows.reduce((map: Map<string, any[]>, item: any) => {
    const key = String(item.unit_no || "");
    if (!key) return map;
    map.set(key, [...(map.get(key) || []), item]);
    return map;
  }, new Map<string, any[]>());
  const storedCbsParcelByKey = new Map(storedCbsParcels.map((item) => [getParcelStorageKey(item), item]));

  return rawRows.map((unit) =>
    normalizeKobuksImportedUnit(
      unit,
      producers.get(String(unit.producer_tc || unit.tc_no || "")),
      productionByUnit.get(String(unit.unit_no || "")) || [],
      storedCbsParcelByKey.get(getParcelStorageKey(unit)),
    ),
  );
}

function isCbsStorageSchemaError(error: any) {
  const text = [error?.code, error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("tr-TR");

  return (
    text.includes("schema cache") ||
    text.includes("pgrst204") ||
    text.includes("does not exist") ||
    text.includes("could not find") ||
    text.includes("column") ||
    text.includes("relation")
  );
}

function isMissingPolygonSyncRpc(error: any) {
  const text = [error?.code, error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("tr-TR");

  return (
    text.includes("sync_cbs_polygon") ||
    text.includes("pgrst202") ||
    (text.includes("could not find") && text.includes("function"))
  );
}

async function saveCbsPolygonWithLegacySchema(
  unit: CbsUnit,
  normalizedParcelPolygon: MapPoint[],
  normalizedPolygon: MapPoint[],
  center: MapPoint,
  area: number,
  options: SaveCbsPolygonOptions,
) {
  const existingCbsId = String(unit.cbsStorageId || "").trim();
  let cbsRecord: any = null;

  if (existingCbsId) {
    const existingResult: any = await runCbsQuery(
      supabase.from("cbs_units").select("id").eq("id", existingCbsId).maybeSingle(),
      12000,
    );

    if (existingResult.error) {
      throw existingResult.error;
    }

    cbsRecord = existingResult.data;
  }

  if (!cbsRecord && hasLookupValue(unit.cbsUnitId)) {
    const existingResult: any = await runCbsQuery(
      supabase.from("cbs_units").select("id").eq("tkgm_parcel_id", unit.cbsUnitId).maybeSingle(),
      12000,
    );

    if (existingResult.error && !isCbsStorageSchemaError(existingResult.error)) {
      throw existingResult.error;
    }

    cbsRecord = existingResult.data || null;
  }

  const parcelPayload = {
    tkgm_parcel_id: hasLookupValue(unit.cbsUnitId) ? unit.cbsUnitId : null,
    city: unit.city,
    district: unit.district,
    village: unit.village,
    ada_no: unit.adaNo,
    parcel_no: unit.parcelNo,
    parcel_polygon: normalizedParcelPolygon.length >= 3 ? normalizedParcelPolygon : null,
    latitude: center.latitude,
    longitude: center.longitude,
    source: "manual_cbs_polygon",
    source_accuracy: "field_drawn_greenhouse",
    updated_at: new Date().toISOString(),
  };
  let cbsResult: any;

  if (cbsRecord?.id) {
    cbsResult = await runCbsQuery(
      supabase.from("cbs_units").update(parcelPayload).eq("id", cbsRecord.id).select("id").single(),
      12000,
    );
  } else {
    cbsResult = await runCbsQuery(
      supabase
        .from("cbs_units")
        .insert({
          ...parcelPayload,
          unit_no: unit.unitNo,
          greenhouse_polygon: normalizedPolygon,
          greenhouse_area: area,
        })
        .select("id")
        .single(),
      12000,
    );
  }

  if (cbsResult.error) {
    throw cbsResult.error;
  }

  const cbsUnitId = String(cbsResult.data?.id || cbsRecord?.id || "");
  if (!cbsUnitId) {
    throw new Error("CBS parsel kaydı oluşturulamadı.");
  }

  const greenhouseResult: any = await runCbsQuery(
    supabase
      .from("greenhouse_units")
      .upsert(
        {
          cbs_unit_id: cbsUnitId,
          producer_id: unit.producerId || null,
          unit_no: unit.unitNo,
          registration_no: hasLookupValue(unit.registrationNo) ? unit.registrationNo : null,
          greenhouse_area: area,
          parcel_polygon: normalizedParcelPolygon.length >= 3 ? normalizedParcelPolygon : null,
          greenhouse_polygon: normalizedPolygon,
          latitude: center.latitude,
          longitude: center.longitude,
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "unit_no" },
      )
      .select("id")
      .single(),
    12000,
  );

  if (greenhouseResult.error) {
    throw greenhouseResult.error;
  }

  const greenhouseUnitId = String(greenhouseResult.data?.id || "");
  const numericTaskId = isDatabaseRecordId(options.taskId) ? Number(options.taskId) : null;
  let inspectionId: string | undefined;

  if (numericTaskId) {
    const taskPayload: Record<string, unknown> = {
      cbs_unit_id: cbsUnitId,
      greenhouse_unit_id: greenhouseUnitId || null,
      parcel_polygon: normalizedParcelPolygon.length >= 3 ? normalizedParcelPolygon : null,
      greenhouse_polygon: normalizedPolygon,
      latitude: center.latitude,
      longitude: center.longitude,
    };

    if (options.taskDescription) {
      taskPayload.description = options.taskDescription;
    }

    let taskResult: any = await runCbsQuery(
      supabase.from("tasks").update(taskPayload).eq("id", numericTaskId).select("*").single(),
      12000,
    );

    if (taskResult.error && isCbsStorageSchemaError(taskResult.error)) {
      const { cbs_unit_id: _cbsUnitId, greenhouse_unit_id: _greenhouseUnitId, ...legacyTaskPayload } = taskPayload;
      taskResult = await runCbsQuery(
        supabase.from("tasks").update(legacyTaskPayload).eq("id", numericTaskId).select("*").single(),
        12000,
      );
    }

    if (taskResult.error) {
      throw taskResult.error;
    }

    if (taskResult.data?.inspection_id) {
      inspectionId = String(taskResult.data.inspection_id);
      const inspectionResult: any = await runCbsQuery(
        supabase
          .from("inspection_history")
          .update({
            greenhouse_unit_id: greenhouseUnitId || null,
            producer_id: unit.producerId || null,
            unit_no: unit.unitNo,
            latitude: center.latitude,
            longitude: center.longitude,
          })
          .eq("id", inspectionId),
        12000,
      );

      if (inspectionResult.error) {
        throw inspectionResult.error;
      }
    } else {
      const inspectionResult: any = await runCbsQuery(
        supabase
          .from("inspection_history")
          .insert({
            greenhouse_unit_id: greenhouseUnitId || null,
            producer_id: unit.producerId || null,
            task_id: numericTaskId,
            unit_no: unit.unitNo,
            status: "Sahada",
            latitude: center.latitude,
            longitude: center.longitude,
          })
          .select("id")
          .single(),
        12000,
      );

      if (inspectionResult.error) {
        throw inspectionResult.error;
      }

      inspectionId = inspectionResult.data?.id ? String(inspectionResult.data.id) : undefined;

      if (inspectionId) {
        const linkResult: any = await runCbsQuery(
          supabase.from("tasks").update({ inspection_id: inspectionId }).eq("id", numericTaskId),
          12000,
        );

        if (linkResult.error && !isCbsStorageSchemaError(linkResult.error)) {
          throw linkResult.error;
        }
      }
    }
  }

  return {
    saved: true,
    targets: [
      "cbs_units",
      "greenhouse_units",
      ...(numericTaskId ? ["tasks", "inspection_history"] : []),
    ],
    ids: {
      cbsUnitId,
      greenhouseUnitId: greenhouseUnitId || undefined,
      inspectionId,
    },
    kobuksLinked: false,
    errors: [],
  };
}

export async function saveCbsUnitPolygon(
  unit: CbsUnit,
  greenhousePolygon: MapPoint[],
  options: SaveCbsPolygonOptions = {},
) {
  const normalizedPolygon = greenhousePolygon.map((point, index) => ({
    corner: index + 1,
    latitude: Number(point.latitude.toFixed(8)),
    longitude: Number(point.longitude.toFixed(8)),
  }));
  const normalizedParcelPolygon = unit.parcelPolygon.map((point, index) => ({
    corner: index + 1,
    latitude: Number(point.latitude.toFixed(8)),
    longitude: Number(point.longitude.toFixed(8)),
  }));
  const center = getCenter(normalizedPolygon);
  const area = Math.round(calculatePolygonArea(normalizedPolygon));
  const numericTaskId = isDatabaseRecordId(options.taskId) ? Number(options.taskId) : null;
  const numericCbsId = isDatabaseRecordId(unit.cbsStorageId)
    ? Number(unit.cbsStorageId)
    : isDatabaseRecordId(unit.cbsUnitId)
      ? Number(unit.cbsUnitId)
      : null;
  const numericProducerId = isDatabaseRecordId(unit.producerId) ? Number(unit.producerId) : null;
  const result: any = await runCbsQuery(
    supabase.rpc("sync_cbs_polygon", {
      p_task_id: numericTaskId,
      p_cbs_unit_id: numericCbsId,
      p_tkgm_parcel_id: numericCbsId ? null : unit.cbsUnitId || null,
      p_city: unit.city,
      p_district: unit.district,
      p_village: unit.village,
      p_ada_no: unit.adaNo,
      p_parcel_no: unit.parcelNo,
      p_unit_no: unit.unitNo,
      p_registration_no: hasLookupValue(unit.registrationNo) ? unit.registrationNo : null,
      p_producer_id: numericProducerId,
      p_parcel_polygon: normalizedParcelPolygon.length >= 3 ? normalizedParcelPolygon : null,
      p_greenhouse_polygon: normalizedPolygon,
      p_latitude: center.latitude,
      p_longitude: center.longitude,
      p_greenhouse_area: area,
      p_task_description: options.taskDescription || null,
    }),
    15000,
  );

  if (result.error) {
    if (isMissingPolygonSyncRpc(result.error)) {
      return saveCbsPolygonWithLegacySchema(
        unit,
        normalizedParcelPolygon,
        normalizedPolygon,
        center,
        area,
        options,
      );
    }

    throw result.error;
  }

  const data = result.data || {};
  return {
    saved: true,
    targets: Array.isArray(data.targets) ? data.targets : ["cbs_units", "greenhouse_units"],
    ids: {
      cbsUnitId: data.cbs_unit_id ? String(data.cbs_unit_id) : undefined,
      greenhouseUnitId: data.greenhouse_unit_id ? String(data.greenhouse_unit_id) : undefined,
      inspectionId: data.inspection_id ? String(data.inspection_id) : undefined,
    },
    kobuksLinked: Boolean(data.kobuks_linked),
    errors: [],
  };
}

function hasStoredPolygonValue(value: unknown) {
  const rawValue = typeof value === "string" ? (() => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  })() : value;

  if (!Array.isArray(rawValue)) {
    return false;
  }

  return rawValue.filter((point) => Number.isFinite(toNumber(point?.latitude ?? point?.lat, NaN)) && Number.isFinite(toNumber(point?.longitude ?? point?.lng, NaN))).length >= 3;
}

function shouldUseTaskAsCbsSource(task: any) {
  const polygon = task?.greenhouse_polygon ?? task?.greenhousePolygon ?? task?.unit_polygon;

  if (isTaskCancelled(task) || !hasStoredPolygonValue(polygon)) {
    return false;
  }

  if (!isTaskCompleted(task)) {
    return true;
  }

  return hasStoredPolygonValue(task?.greenhouse_polygon ?? task?.greenhousePolygon ?? task?.unit_polygon);
}

export async function loadCbsUnits(options: LoadCbsUnitsOptions = {}): Promise<CbsUnit[]> {
  const localUnits = AKSU_SOLAK_UNITS;
  const includeKobuks = Boolean(options.kobuksQuery) || options.includeKobuks === true;
  const kobuksLimit = options.kobuksLimit || DEFAULT_KOBUKS_SEARCH_LIMIT;
  const [greenhouseResult, producerResult, cropResult, taskResult] = await Promise.allSettled([
    fetchAllRows<any>("greenhouse_units"),
    fetchAllRows<any>("kobuks_producers"),
    fetchAllRows<any>("unit_crops"),
    fetchAllRows<any>("tasks"),
  ]);

  const greenhouses = greenhouseResult.status === "fulfilled" ? greenhouseResult.value : [];
  const taskRows = taskResult.status === "fulfilled" ? taskResult.value.map((item) => fixRecordText(item)) : [];
  const syncedTaskUnits = taskRows.filter(shouldUseTaskAsCbsSource).map(normalizeLegacyUnit);
  const storedCbsParcels = await fetchRowsByValues<any>(
    "cbs_units",
    "id",
    greenhouses.map((item) => item.cbs_unit_id),
  )
    .then((rows) => rows.map((item) => fixRecordText(item)))
    .catch(() => []);
  const searchKobuksRows =
    includeKobuks && options.kobuksQuery
      ? await loadKobuksSearchUnits(options.kobuksQuery, storedCbsParcels, kobuksLimit).catch(() => [])
      : [];

  if (greenhouses.length) {
    const parcels = new Map(storedCbsParcels.map((item) => [String(item.id), item]));
    const producers = new Map((producerResult.status === "fulfilled" ? producerResult.value : []).map((item) => [String(item.id), item]));
    const crops = cropResult.status === "fulfilled" ? cropResult.value : [];

    return mergeCbsUnits(
      localUnits,
      greenhouses.map((unit) =>
        normalizeGreenhouseUnit(
          unit,
          parcels.get(String(unit.cbs_unit_id)),
          producers.get(String(unit.producer_id)),
          crops.find((crop) => String(crop.greenhouse_unit_id) === String(unit.id)),
        ),
      ),
      searchKobuksRows,
      syncedTaskUnits,
    );
  }

  const syncedTaskRows = taskRows.filter(shouldUseTaskAsCbsSource);
  const merged = [...searchKobuksRows, ...syncedTaskRows.map(normalizeLegacyUnit)];
  const units = mergeCbsUnits(localUnits, merged);
  return units.length ? units : SAMPLE_UNITS;
}

export function getBundledCbsUnits(): CbsUnit[] {
  return AKSU_SOLAK_UNITS.length ? AKSU_SOLAK_UNITS : SAMPLE_UNITS;
}

function getWorkflowStartResult(workflowKind: TaskWorkflowKind) {
  if (workflowKind === "detection") {
    return "Re'sen ürün tespiti bekliyor";
  }

  if (workflowKind === "classification") {
    return "Sınıflandırma başladı";
  }

  return "Başvurulu denetim başladı";
}

function getWorkflowTitle(workflowKind: TaskWorkflowKind) {
  if (workflowKind === "detection") return "Re'sen Tespit";
  if (workflowKind === "classification") return "Sınıflandırma";
  return "Başvurulu Denetim";
}

function isMissingTaskColumnError(error: any) {
  const errorText = [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();

  return (
    errorText.includes("could not find") ||
    errorText.includes("schema cache") ||
    errorText.includes("does not exist") ||
    errorText.includes("pgrst204")
  );
}

function omitTaskColumns(payload: Record<string, unknown>, columns: string[]) {
  const nextPayload = { ...payload };
  columns.forEach((column) => {
    delete nextPayload[column];
  });
  return nextPayload;
}

async function insertTaskWithSchemaFallback(payload: Record<string, unknown>) {
  const attempts = [
    payload,
    omitTaskColumns(payload, ["workflow_type"]),
    omitTaskColumns(payload, ["workflow_type", "parcel_polygon", "greenhouse_polygon", "inspection_id", "greenhouse_unit_id", "cbs_unit_id"]),
    omitTaskColumns(payload, [
      "workflow_type",
      "parcel_polygon",
      "greenhouse_polygon",
      "inspection_id",
      "greenhouse_unit_id",
      "cbs_unit_id",
      "assigned_to",
      "assigned_name",
    ]),
  ];
  const triedSignatures = new Set<string>();
  let lastResult: any = null;

  for (const attempt of attempts) {
    const signature = Object.keys(attempt).sort().join("|");

    if (triedSignatures.has(signature)) {
      continue;
    }

    triedSignatures.add(signature);
    const result: any = await runCbsQuery(
      supabase.from("tasks").insert(attempt).select().single(),
    );

    if (!result.error) {
      return result;
    }

    lastResult = result;

    if (!isMissingTaskColumnError(result.error)) {
      return result;
    }
  }

  return lastResult;
}

export async function startInspectionFromUnit(
  unit: CbsUnit,
  initialStatus = "Bekliyor",
  workflowKind: TaskWorkflowKind = "inspection",
  options: StartInspectionOptions = {},
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const center = getCenter(
    unit.greenhousePolygon.length >= 3 ? unit.greenhousePolygon : unit.parcelPolygon,
  );
  const existingTaskResult: any = await runCbsQuery(
    supabase
      .from("tasks")
      .select("*")
      .eq("unit_no", unit.unitNo)
      .order("created_at", { ascending: false }),
  );

  if (existingTaskResult.error) {
    throw existingTaskResult.error;
  }
  const existingTask = (existingTaskResult.data || []).find(
    (task) => getTaskWorkflowKind(task) === workflowKind && !isTaskCancelled(task),
  );

  if (existingTask) {
    return {
      inspection: null,
      task: existingTask,
      reused: true,
    };
  }

  const profileResult: any = user?.id
    ? await runCbsQuery(
        supabase.from("profiles").select("full_name,email").eq("id", user.id).maybeSingle(),
      )
    : { data: null };
  const assignedName = String(profileResult.data?.full_name || profileResult.data?.email || user?.email || "Saha denetçisi");

  const inspectionResult: any = await runCbsQuery(
    supabase
      .from("inspection_history")
      .insert({
        greenhouse_unit_id: isDatabaseRecordId(unit.greenhouseUnitId)
          ? unit.greenhouseUnitId
          : null,
        producer_id: isDatabaseRecordId(unit.producerId) ? unit.producerId : null,
        inspector_user_id: options.unassigned ? null : user?.id || null,
        unit_no: unit.unitNo,
        status: initialStatus,
        latitude: center.latitude,
        longitude: center.longitude,
      })
      .select()
      .single(),
  );

  if (inspectionResult.error) {
    throw inspectionResult.error;
  }

  const taskPayload = {
    user_id: user?.id,
    assigned_to: options.unassigned ? null : user?.id || null,
    assigned_name: options.unassigned ? null : assignedName,
    tc_no: unit.producerTc,
    producer_name: unit.producerName,
    phone: unit.producerPhone || null,
    city: unit.city,
    district_name: unit.district,
    village: unit.village,
    ada_no: unit.adaNo,
    parcel_no: unit.parcelNo,
    unit_no: unit.unitNo,
    greenhouse_area: String(unit.greenhouseArea || ""),
    detected_crop: unit.crop,
    workflow_type: workflowKind,
    description: `Görev türü: ${getWorkflowTitle(workflowKind)}\nKaynak: CBS haritası`,
    status: initialStatus,
    workflow_status: initialStatus,
    compliance_result: getWorkflowStartResult(workflowKind),
    latitude: center.latitude,
    longitude: center.longitude,
  };

  const taskResult = await insertTaskWithSchemaFallback({
    ...taskPayload,
    parcel_polygon: unit.parcelPolygon,
    greenhouse_polygon: unit.parcelOnly ? [] : unit.greenhousePolygon,
    inspection_id: inspectionResult.data?.id || null,
    greenhouse_unit_id: isDatabaseRecordId(unit.greenhouseUnitId)
      ? unit.greenhouseUnitId
      : null,
    cbs_unit_id: isDatabaseRecordId(unit.cbsStorageId) ? unit.cbsStorageId : null,
  });

  if (taskResult.error) {
    throw taskResult.error;
  }

  return {
    inspection: inspectionResult.data,
    task: taskResult.data,
  };
}
