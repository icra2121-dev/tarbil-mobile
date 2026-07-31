import { supabase } from "../lib/supabase";

const DEFAULT_TKGM_PUBLIC_API_URL =
  "https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api";
const REQUEST_TIMEOUT_MS = 15_000;
const TURKEY_BOUNDS = {
  minLatitude: 35.7,
  maxLatitude: 42.2,
  minLongitude: 25.6,
  maxLongitude: 45,
};

export const TKGM_PUBLIC_APPROX_SOURCE = "tkgm_public_approx";
export const TKGM_PUBLIC_APPROX_ACCURACY = "public_reduced_precision";

export type TkgmPublicPoint = {
  latitude: number;
  longitude: number;
};

export type TkgmPublicParcel = {
  id?: string;
  tkgmParcelId: string;
  city: string;
  district: string;
  village: string;
  adaNo: string;
  parcelNo: string;
  polygon: TkgmPublicPoint[];
  source: typeof TKGM_PUBLIC_APPROX_SOURCE;
  sourceAccuracy: typeof TKGM_PUBLIC_APPROX_ACCURACY;
  properties: Record<string, unknown>;
  geometry: Record<string, unknown>;
};

export class TkgmPublicParcelError extends Error {
  code: "invalid_coordinate" | "not_found" | "rate_limited" | "timeout" | "service" | "invalid_response";

  constructor(
    code: TkgmPublicParcelError["code"],
    message: string,
  ) {
    super(message);
    this.name = "TkgmPublicParcelError";
    this.code = code;
  }
}

function getApiBaseUrl() {
  return String(
    process.env.EXPO_PUBLIC_TKGM_PARCEL_API_URL || DEFAULT_TKGM_PUBLIC_API_URL,
  ).replace(/\/+$/, "");
}

function isValidCoordinate(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= TURKEY_BOUNDS.minLatitude &&
    latitude <= TURKEY_BOUNDS.maxLatitude &&
    longitude >= TURKEY_BOUNDS.minLongitude &&
    longitude <= TURKEY_BOUNDS.maxLongitude
  );
}

function getOuterRings(geometry: any): number[][][] {
  if (geometry?.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates[0] ? [geometry.coordinates[0]] : [];
  }

  if (geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates
      .map((polygon: unknown) => (Array.isArray(polygon) ? polygon[0] : null))
      .filter(Array.isArray);
  }

  return [];
}

function ringArea(ring: number[][]) {
  return Math.abs(
    ring.reduce((area, point, index) => {
      const next = ring[(index + 1) % ring.length];
      return area + Number(point?.[0]) * Number(next?.[1]) - Number(next?.[0]) * Number(point?.[1]);
    }, 0) / 2,
  );
}

function toMapPolygon(geometry: any): TkgmPublicPoint[] {
  const ring = getOuterRings(geometry)
    .filter((candidate) => candidate.length >= 3)
    .sort((first, second) => ringArea(second) - ringArea(first))[0];

  if (!ring) {
    throw new TkgmPublicParcelError(
      "invalid_response",
      "TKGM yanıtında kullanılabilir parsel geometrisi bulunamadı.",
    );
  }

  const points = ring
    .map((coordinate) => ({
      longitude: Number(coordinate?.[0]),
      latitude: Number(coordinate?.[1]),
    }))
    .filter((point) => isValidCoordinate(point.latitude, point.longitude));
  const first = points[0];
  const last = points[points.length - 1];

  if (
    points.length > 3 &&
    first.latitude === last.latitude &&
    first.longitude === last.longitude
  ) {
    points.pop();
  }

  if (points.length < 3) {
    throw new TkgmPublicParcelError(
      "invalid_response",
      "TKGM parsel geometrisi en az üç geçerli köşe içermiyor.",
    );
  }

  return points;
}

function cleanText(value: unknown, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function buildParcelId(properties: Record<string, unknown>) {
  const parts = [
    properties.ilId,
    properties.ilceId,
    properties.mahalleId,
    properties.adaNo,
    properties.parselNo,
  ].map((value) => cleanText(value, "0"));

  return `public:${parts.join(":")}`;
}

function normalizeResponse(payload: any): TkgmPublicParcel {
  if (
    payload?.type !== "Feature" ||
    !payload.geometry ||
    !payload.properties ||
    String(payload.properties.durum ?? "1") === "0"
  ) {
    throw new TkgmPublicParcelError(
      "invalid_response",
      "TKGM servisi geçerli bir parsel kaydı döndürmedi.",
    );
  }

  const properties = payload.properties as Record<string, unknown>;

  return {
    tkgmParcelId: buildParcelId(properties),
    city: cleanText(properties.ilAd),
    district: cleanText(properties.ilceAd),
    village: cleanText(properties.mahalleAd),
    adaNo: cleanText(properties.adaNo),
    parcelNo: cleanText(properties.parselNo),
    polygon: toMapPolygon(payload.geometry),
    source: TKGM_PUBLIC_APPROX_SOURCE,
    sourceAccuracy: TKGM_PUBLIC_APPROX_ACCURACY,
    properties,
    geometry: payload.geometry,
  };
}

export async function fetchTkgmPublicParcelAtCoordinate(
  latitude: number,
  longitude: number,
): Promise<TkgmPublicParcel> {
  if (!isValidCoordinate(latitude, longitude)) {
    throw new TkgmPublicParcelError(
      "invalid_coordinate",
      "Parsel sorgusu yalnızca Türkiye sınırları içindeki geçerli koordinatlarda yapılabilir.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${getApiBaseUrl()}/parsel/${latitude.toFixed(6)}/${longitude.toFixed(6)}/`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/geo+json, application/json",
        "Accept-Language": "tr",
      },
      signal: controller.signal,
    });

    if (response.status === 404) {
      throw new TkgmPublicParcelError(
        "not_found",
        "Bu koordinatta kamu Parsel Sorgu servisinin döndürdüğü bir parsel bulunamadı.",
      );
    }

    if (response.status === 403 || response.status === 429) {
      throw new TkgmPublicParcelError(
        "rate_limited",
        "TKGM kamu servisi sorgu sınırına ulaştı. Bir süre sonra tekrar deneyin.",
      );
    }

    if (!response.ok) {
      throw new TkgmPublicParcelError(
        "service",
        `TKGM kamu servisi ${response.status} durum kodu döndürdü.`,
      );
    }

    return normalizeResponse(await response.json());
  } catch (error: any) {
    if (error instanceof TkgmPublicParcelError) {
      throw error;
    }

    if (error?.name === "AbortError") {
      throw new TkgmPublicParcelError(
        "timeout",
        "TKGM kamu parsel sorgusu zaman aşımına uğradı.",
      );
    }

    throw new TkgmPublicParcelError(
      "service",
      error?.message || "TKGM kamu parsel servisine ulaşılamadı.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function toStoredPolygon(points: TkgmPublicPoint[]) {
  return points.map((point, index) => ({
    corner: index + 1,
    latitude: Number(point.latitude.toFixed(8)),
    longitude: Number(point.longitude.toFixed(8)),
  }));
}

function getCenter(points: TkgmPublicPoint[]) {
  const total = points.reduce(
    (result, point) => ({
      latitude: result.latitude + point.latitude,
      longitude: result.longitude + point.longitude,
    }),
    { latitude: 0, longitude: 0 },
  );

  return {
    latitude: total.latitude / points.length,
    longitude: total.longitude / points.length,
  };
}

export async function storeTkgmPublicParcel(
  parcel: TkgmPublicParcel,
  queryCoordinate: TkgmPublicPoint,
): Promise<TkgmPublicParcel> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const existingResult = await supabase
    .from("cbs_units")
    .select("id,source")
    .eq("tkgm_parcel_id", parcel.tkgmParcelId)
    .limit(1);

  if (existingResult.error) {
    throw existingResult.error;
  }

  const existing = existingResult.data?.[0];
  const storedId = existing?.id ? String(existing.id) : "";

  if (["tkgm", "tkgm_authorized", "megsis_authorized"].includes(String(existing?.source || ""))) {
    return { ...parcel, id: storedId };
  }

  const now = new Date().toISOString();
  const center = getCenter(parcel.polygon);
  const payload = {
    tkgm_parcel_id: parcel.tkgmParcelId,
    city: parcel.city,
    district: parcel.district,
    village: parcel.village,
    ada_no: parcel.adaNo,
    parcel_no: parcel.parcelNo,
    parcel_polygon: toStoredPolygon(parcel.polygon),
    latitude: center.latitude,
    longitude: center.longitude,
    source: parcel.source,
    source_accuracy: parcel.sourceAccuracy,
    source_srid: 4326,
    source_geometry: parcel.geometry,
    source_payload: {
      access: "public_parsel_sorgu",
      accuracy: parcel.sourceAccuracy,
      queried_at: now,
      query_coordinate: queryCoordinate,
      properties: parcel.properties,
    },
    ingested_at: now,
    updated_by: user?.id || null,
    updated_at: now,
  };
  const result = storedId
    ? await supabase
        .from("cbs_units")
        .update(payload)
        .eq("id", storedId)
        .select("id")
        .single()
    : await supabase
        .from("cbs_units")
        .insert({
          ...payload,
          created_by: user?.id || null,
        })
        .select("id")
        .single();

  if (result.error) {
    throw result.error;
  }

  return {
    ...parcel,
    id: String(result.data.id),
  };
}

export async function fetchAndStoreTkgmPublicParcelAtCoordinate(
  latitude: number,
  longitude: number,
) {
  const parcel = await fetchTkgmPublicParcelAtCoordinate(latitude, longitude);

  return storeTkgmPublicParcel(parcel, { latitude, longitude });
}
