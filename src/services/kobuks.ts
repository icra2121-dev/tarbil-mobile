import { supabase } from "../lib/supabase";
import { fixRecordText } from "../utils/text";
import { integrationFetch } from "./integrations";

export type KobuksUnitRecord = {
  tc_no?: string;
  producer_name?: string;
  phone?: string;
  city?: string;
  district_name?: string;
  village?: string;
  unit_no?: string;
  ada_no?: string;
  parcel_no?: string;
  greenhouse_area?: string;
  detected_crop?: string;
  registration_status?: string;
  latitude?: number;
  longitude?: number;
  parcel_polygon?: unknown;
  greenhouse_polygon?: unknown;
  qfield_id?: string | null;
  qfield_unit_type?: string | null;
  qfield_score?: number | null;
  qfield_judgment?: string | null;
};

type KobuksSearchPayload = {
  data?: {
    unit?: any;
    producer?: any;
    production?: any;
  }[];
};

function uniqueFilledValues(values: unknown[]) {
  const seen = new Set<string>();

  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }

      seen.add(value);
      return true;
    });
}

function getProductionCropText(production?: any) {
  const rows = Array.isArray(production) ? production : production ? [production] : [];
  return uniqueFilledValues(rows.map((row) => row?.crop_name || row?.detected_crop || row?.crop)).join(", ");
}

function normalizeRecord(unit: any, producer?: any, production?: any): KobuksUnitRecord {
  const productionCrop = getProductionCropText(production);

  return fixRecordText({
    tc_no: producer?.tc_no || unit?.producer_tc || unit?.tc_no,
    producer_name:
      producer?.full_name ||
      unit?.producer_name ||
      unit?.full_name ||
      (unit?.producer_tc ? `İşletme ${unit.producer_tc}` : "-"),
    phone: producer?.phone || unit?.phone || "",
    city: producer?.city || unit?.city || unit?.province,
    district_name: producer?.district || unit?.district_name || unit?.district,
    village: producer?.village || unit?.village || unit?.neighborhood,
    unit_no: unit?.unit_no,
    ada_no: unit?.ada_no,
    parcel_no: unit?.parcel_no,
    greenhouse_area: String(unit?.greenhouse_area || unit?.area_m2 || ""),
    detected_crop: productionCrop || unit?.detected_crop || unit?.crop_name || unit?.crop,
    registration_status: unit?.registration_status || "Aktif",
    latitude: unit?.latitude || unit?.unit_latitude,
    longitude: unit?.longitude || unit?.unit_longitude,
    parcel_polygon: unit?.parcel_polygon || unit?.polygon,
    greenhouse_polygon: unit?.greenhouse_polygon || unit?.unit_polygon,
  });
}

async function enrichUnit(unit: any): Promise<KobuksUnitRecord> {
  const [producerResult, productionResult] = await Promise.all([
    unit?.producer_tc
      ? supabase.from("kobuks_producers").select("*").eq("tc_no", unit.producer_tc).maybeSingle()
      : Promise.resolve({ data: null }),
    unit?.unit_no
      ? supabase.from("kobuks_production").select("*").eq("unit_no", unit.unit_no).limit(20)
      : Promise.resolve({ data: [] }),
  ]);

  return normalizeRecord(unit, producerResult.data, productionResult.data);
}

async function searchRemoteKobuks(query: string): Promise<KobuksUnitRecord[] | null> {
  const payload = await integrationFetch<KobuksSearchPayload | any[]>(
    `/kobuks/units/search?q=${encodeURIComponent(query)}`,
  );

  if (!payload) {
    return null;
  }

  const rows = Array.isArray(payload) ? payload : payload.data || [];
  return rows.map((row: any) => normalizeRecord(row.unit || row, row.producer, row.production));
}

export async function searchKobuksUnits(query: string): Promise<KobuksUnitRecord[]> {
  const normalized = query.trim();

  if (!normalized) {
    return [];
  }

  const remote = await searchRemoteKobuks(normalized);

  if (remote) {
    return remote;
  }

  const parts = normalized
    .replace("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  let unitQuery = supabase.from("kobuks_units").select("*").limit(50);

  if (parts.length >= 2) {
    unitQuery = unitQuery.eq("ada_no", parts[0]).eq("parcel_no", parts[1]);
  } else {
    const unitResult = await supabase.from("kobuks_units").select("*").eq("unit_no", normalized).limit(50);

    if (unitResult.data?.length) {
      const first = unitResult.data[0];
      const sameParcelQuery =
        first?.ada_no && first?.parcel_no
          ? supabase
              .from("kobuks_units")
              .select("*")
              .eq("ada_no", first.ada_no)
              .eq("parcel_no", first.parcel_no)
              .limit(50)
          : unitResult;

      const sameParcelResult = await sameParcelQuery;
      return await Promise.all((sameParcelResult.data || unitResult.data).map(enrichUnit));
    }

    unitQuery = unitQuery.or(`ada_no.eq.${normalized},parcel_no.eq.${normalized}`);
  }

  const result = await unitQuery;

  if (result.error) {
    throw result.error;
  }

  return await Promise.all((result.data || []).map(enrichUnit));
}

export async function getProducerByUnitNo(unitNo: string) {
  const units = await searchKobuksUnits(unitNo);

  if (!units.length) {
    throw new Error("Ünite bulunamadı");
  }

  return units[0];
}

export async function getProducerByTc(tcNo: string) {
  const remote = await searchRemoteKobuks(tcNo);

  if (remote?.length) {
    return remote[0];
  }

  const producerResult = await supabase.from("kobuks_producers").select("*").eq("tc_no", tcNo).single();

  if (producerResult.error || !producerResult.data) {
    throw new Error("Üretici bulunamadı");
  }

  const unitResult = await supabase.from("kobuks_units").select("*").eq("producer_tc", tcNo).limit(1);

  const unit = unitResult.data?.[0];
  return await enrichUnit({
    ...unit,
    producer_tc: tcNo,
  });
}

export async function getUnitsByProducerTc(tcNo: string) {
  const remote = await searchRemoteKobuks(tcNo);
  if (remote?.length) return remote;
  const result = await supabase.from("kobuks_units").select("*").eq("producer_tc", tcNo).limit(100);
  if (result.error) throw result.error;
  return await Promise.all((result.data || []).map(enrichUnit));
}

/** Returns linked QField classifications for a village in one bounded batch.
 *  The imported QField layer is separate from kobuks_units, so searching only
 *  the KOBÜKS table makes these field records impossible to select for a task.
 */
export async function searchQFieldUnitsByVillage(village: string, district?: string): Promise<KobuksUnitRecord[]> {
  const normalizedVillage = village.trim().toLocaleUpperCase("tr-TR");
  if (normalizedVillage.length < 2) return [];

  const batchResult = await supabase
    .from("qfield_import_batches")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (batchResult.error) throw batchResult.error;
  if (!batchResult.data) return [];

  let featureQuery = supabase
    .from("qfield_classifications")
    .select("id,qfield_id,unit_no,unit_type,area_m2,score,judgment,district,neighborhood,geometry_geojson,matched_kobuks_unit_id")
    .eq("import_batch_id", batchResult.data.id)
    .eq("neighborhood", normalizedVillage)
    .order("source_fid", { ascending: true })
    .limit(500);
  const normalizedDistrict = String(district || "").trim().toLocaleUpperCase("tr-TR");
  if (normalizedDistrict) featureQuery = featureQuery.eq("district", normalizedDistrict);
  const featureResult = await featureQuery;
  if (featureResult.error) throw featureResult.error;

  const features = featureResult.data || [];
  const unitIds = [...new Set(features.map((feature: any) => Number(feature.matched_kobuks_unit_id)).filter(Number.isFinite))];
  const unitResult = unitIds.length
    ? await supabase.from("kobuks_units").select("*").in("id", unitIds)
    : { data: [], error: null };
  if (unitResult.error) throw unitResult.error;

  const unitRows = unitResult.data || [];
  const producerTcs = uniqueFilledValues(unitRows.map((unit: any) => unit.producer_tc));
  const unitNos = uniqueFilledValues(unitRows.map((unit: any) => unit.unit_no));
  const [producersResult, productionResult] = await Promise.all([
    producerTcs.length
      ? supabase.from("kobuks_producers").select("*").in("tc_no", producerTcs)
      : Promise.resolve({ data: [], error: null }),
    unitNos.length
      ? supabase.from("kobuks_production").select("*").in("unit_no", unitNos).limit(1000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (producersResult.error) throw producersResult.error;
  if (productionResult.error) throw productionResult.error;

  const unitsById = new Map(unitRows.map((unit: any) => [Number(unit.id), unit]));
  const producersByTc = new Map((producersResult.data || []).map((producer: any) => [String(producer.tc_no), producer]));
  const productionByUnit = new Map<string, any[]>();
  (productionResult.data || []).forEach((item: any) => {
    const key = String(item.unit_no || "");
    if (key) productionByUnit.set(key, [...(productionByUnit.get(key) || []), item]);
  });

  return features.flatMap((feature: any) => {
    if (!feature.unit_no || !feature.geometry_geojson) return [];
    const unit = unitsById.get(Number(feature.matched_kobuks_unit_id));
    const tc = String(unit?.producer_tc || "");
    const producer = producersByTc.get(tc);
    const production = productionByUnit.get(String(unit?.unit_no || "")) || [];
    const normalized = normalizeRecord(unit || { unit_no: feature.unit_no, greenhouse_area: feature.area_m2 }, producer, production);
    return [{
      ...normalized,
      producer_name: producer?.full_name || unit?.producer_name || "",
      tc_no: producer?.tc_no || unit?.producer_tc || "",
      unit_no: feature.unit_no || normalized.unit_no,
      village: feature.neighborhood || normalized.village,
      district_name: feature.district || normalized.district_name,
      greenhouse_area: String(feature.area_m2 ?? normalized.greenhouse_area ?? ""),
      greenhouse_polygon: feature.geometry_geojson || normalized.greenhouse_polygon,
      qfield_id: feature.qfield_id || feature.id,
      qfield_unit_type: feature.unit_type,
      qfield_score: feature.score,
      qfield_judgment: feature.judgment,
    }];
  });
}
