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
  cbsUnitId?: string;
  greenhouseUnitId?: string;
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

  if (isValidPolygon(reference) && isValidPolygon(candidate) && isPolygonUnsafeAgainstReference(candidate, reference)) {
    return reference;
  }

  return candidate;
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

async function fetchAllRows<T>(table: string, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const result = await supabase.from(table).select("*").range(from, to);

    if (result.error) {
      throw result.error;
    }

    const page = (result.data || []) as T[];
    rows.push(...page);

    if (page.length < pageSize) {
      return rows;
    }
  }
}

function normalizeLegacyUnit(raw: any): CbsUnit {
  const center = {
    latitude: toNumber(raw.latitude ?? raw.lat ?? raw.unit_latitude, ANTALYA_REGION.latitude),
    longitude: toNumber(raw.longitude ?? raw.lng ?? raw.unit_longitude, ANTALYA_REGION.longitude),
  };

  return {
    id: String(raw.id ?? raw.unit_no ?? raw.task_id ?? Date.now()),
    cbsUnitId: raw.cbs_unit_id ? String(raw.cbs_unit_id) : undefined,
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
    cbsUnitId: raw.cbs_unit_id,
    greenhouseUnitId: raw.id,
    producerId: raw.producer_id,
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

function getUnitMergeKey(unit: CbsUnit) {
  return String(unit.greenhouseUnitId || unit.cbsUnitId || unit.unitNo || unit.id);
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

function mergeCbsUnits(...groups: CbsUnit[][]) {
  const map = new Map<string, CbsUnit>();

  groups.flat().forEach((unit) => {
    const key = getUnitMergeKey(unit);
    const existing = map.get(key);

    map.set(key, existing ? mergeCbsUnit(existing, unit) : unit);
  });

  return [...map.values()];
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

export async function loadCbsUnits(): Promise<CbsUnit[]> {
  const localUnits = AKSU_SOLAK_UNITS;
  const [greenhouseResult, parcelResult, producerResult, cropResult, taskResult] = await Promise.allSettled([
    fetchAllRows<any>("greenhouse_units"),
    fetchAllRows<any>("cbs_units"),
    fetchAllRows<any>("producers"),
    fetchAllRows<any>("unit_crops"),
    fetchAllRows<any>("tasks"),
  ]);

  const greenhouses = greenhouseResult.status === "fulfilled" ? greenhouseResult.value : [];
  const taskRows = taskResult.status === "fulfilled" ? taskResult.value.map((item) => fixRecordText(item)) : [];
  const syncedTaskUnits = taskRows.filter(shouldUseTaskAsCbsSource).map(normalizeLegacyUnit);

  if (greenhouses.length) {
    const parcels = new Map((parcelResult.status === "fulfilled" ? parcelResult.value : []).map((item) => [String(item.id), item]));
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
      syncedTaskUnits,
    );
  }

  const [kobuksResult] = await Promise.allSettled([fetchAllRows<any>("kobuks_units")]);

  const kobuksRows = kobuksResult.status === "fulfilled" ? kobuksResult.value.map((item) => fixRecordText(item)) : [];
  const syncedTaskRows = taskRows.filter(shouldUseTaskAsCbsSource);
  const merged = [...kobuksRows, ...syncedTaskRows].map(normalizeLegacyUnit);
  const units = mergeCbsUnits(localUnits, merged);
  return units.length ? units : SAMPLE_UNITS;
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
    const result = await supabase.from("tasks").insert(attempt).select().single();

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

export async function startInspectionFromUnit(unit: CbsUnit, initialStatus = "Bekliyor", workflowKind: TaskWorkflowKind = "inspection") {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const center = getCenter(unit.greenhousePolygon);
  const existingTaskResult = await supabase
    .from("tasks")
    .select("*")
    .eq("unit_no", unit.unitNo)
    .order("created_at", { ascending: false });
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

  const profileResult = user?.id
    ? await supabase.from("profiles").select("full_name,email").eq("id", user.id).maybeSingle()
    : { data: null };
  const assignedName = String(profileResult.data?.full_name || profileResult.data?.email || user?.email || "Saha denetçisi");

  const inspectionResult = await supabase
    .from("inspection_history")
    .insert({
      greenhouse_unit_id: unit.greenhouseUnitId || null,
      producer_id: unit.producerId || null,
      inspector_user_id: user?.id || null,
      unit_no: unit.unitNo,
      status: initialStatus,
      latitude: center.latitude,
      longitude: center.longitude,
    })
    .select()
    .single();

  const taskPayload = {
    user_id: user?.id,
    assigned_to: user?.id || null,
    assigned_name: assignedName,
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
    greenhouse_polygon: unit.greenhousePolygon,
    inspection_id: inspectionResult.data?.id || null,
    greenhouse_unit_id: unit.greenhouseUnitId || null,
    cbs_unit_id: unit.cbsUnitId || null,
  });

  if (taskResult.error) {
    throw taskResult.error;
  }

  return {
    inspection: inspectionResult.data,
    task: taskResult.data,
  };
}
