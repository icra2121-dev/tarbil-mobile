import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REQUEST_TIMEOUT_MS = Number(process.env.TKGM_REQUEST_TIMEOUT_MS || 30_000);
const PAGE_SIZE = Math.min(Math.max(Number(process.env.TKGM_WFS_PAGE_SIZE || 1_000), 1), 5_000);
const UPSERT_BATCH_SIZE = Math.min(Math.max(Number(process.env.TKGM_UPSERT_BATCH_SIZE || 200), 1), 1_000);
const MAX_FEATURES = Math.max(Number(process.env.TKGM_IMPORT_MAX_FEATURES || 0), 0);
const DRY_RUN = String(process.env.TKGM_IMPORT_DRY_RUN || "true").toLowerCase() !== "false";

function required(name, fallback = "") {
  const value = String(process.env[name] || fallback).trim();

  if (!value) {
    throw new Error(`${name} tanımlı değil.`);
  }

  return value;
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function propertyIndex(properties = {}) {
  return new Map(Object.entries(properties).map(([key, value]) => [normalizeKey(key), value]));
}

function readProperty(properties, configuredField, fallbacks) {
  if (configuredField && Object.hasOwn(properties, configuredField)) {
    return properties[configuredField];
  }

  const indexed = propertyIndex(properties);

  for (const field of fallbacks) {
    const value = indexed.get(normalizeKey(field));

    if (value !== undefined && value !== null && String(value).trim()) {
      return value;
    }
  }

  return null;
}

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text && text.toLowerCase() !== "null" ? text : null;
}

function ringArea(coordinates) {
  let area = 0;

  for (let index = 0; index < coordinates.length; index += 1) {
    const [x1, y1] = coordinates[index];
    const [x2, y2] = coordinates[(index + 1) % coordinates.length];
    area += x1 * y2 - x2 * y1;
  }

  return Math.abs(area / 2);
}

function selectOuterRing(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    throw new Error("GeoJSON geometri alanı eksik.");
  }

  if (geometry.type === "Polygon") {
    return geometry.coordinates[0];
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygon) => polygon?.[0])
      .filter((ring) => Array.isArray(ring))
      .sort((left, right) => ringArea(right) - ringArea(left))[0];
  }

  throw new Error(`Desteklenmeyen geometri türü: ${geometry.type || "bilinmiyor"}`);
}

function toMapPolygon(geometry) {
  const ring = selectOuterRing(geometry);

  if (!Array.isArray(ring)) {
    throw new Error("Parsel dış halkası bulunamadı.");
  }

  const points = ring
    .map((coordinate) => {
      const longitude = Number(coordinate?.[0]);
      const latitude = Number(coordinate?.[1]);
      return { latitude, longitude };
    })
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));

  if (
    points.length > 1 &&
    points[0].latitude === points.at(-1).latitude &&
    points[0].longitude === points.at(-1).longitude
  ) {
    points.pop();
  }

  if (points.length < 3) {
    throw new Error("Parsel poligonu en az üç geçerli köşe içermeli.");
  }

  return points.map((point, index) => ({ corner: index + 1, ...point }));
}

function stableParcelId(feature, fields) {
  const properties = feature.properties || {};
  const officialId = cleanText(
    readProperty(properties, fields.id, [
      "tasinmazId",
      "tasinmaz_no",
      "parselId",
      "parsel_id",
      "kimlikNo",
      "objectid",
      "fid",
      "id",
    ]),
  );

  if (officialId) {
    return officialId;
  }

  if (feature.id !== undefined && feature.id !== null && String(feature.id).trim()) {
    return String(feature.id).trim();
  }

  const administrativeId = [
    readProperty(properties, fields.city, ["il", "il_adi", "city"]),
    readProperty(properties, fields.district, ["ilce", "ilce_adi", "district"]),
    readProperty(properties, fields.village, ["mahalle", "mahalle_adi", "koy", "village"]),
    readProperty(properties, fields.block, ["ada", "ada_no", "block"]),
    readProperty(properties, fields.parcel, ["parsel", "parsel_no", "parcel"]),
  ]
    .map(cleanText)
    .filter(Boolean)
    .join("|");

  if (!administrativeId) {
    throw new Error("TKGM parsel kimliği veya il/ilçe/mahalle/ada/parsel alanları bulunamadı.");
  }

  return administrativeId;
}

function mapFeature(feature, fields) {
  if (feature?.type !== "Feature") {
    throw new Error("Kaynak kayıt GeoJSON Feature değil.");
  }

  const properties = feature.properties || {};
  const sourceGeometry = feature.geometry;
  const parcelPolygon = toMapPolygon(sourceGeometry);
  const tkgmParcelId = stableParcelId(feature, fields);
  const sourceUpdatedAt = cleanText(
    readProperty(properties, fields.updatedAt, [
      "guncellemeTarihi",
      "guncelleme_tarihi",
      "updated_at",
      "last_update",
    ]),
  );

  return {
    tkgm_parcel_id: tkgmParcelId,
    city: cleanText(readProperty(properties, fields.city, ["il", "il_adi", "city"])),
    district: cleanText(readProperty(properties, fields.district, ["ilce", "ilce_adi", "district"])),
    village: cleanText(
      readProperty(properties, fields.village, ["mahalle", "mahalle_adi", "koy", "village"]),
    ),
    ada_no: cleanText(readProperty(properties, fields.block, ["ada", "ada_no", "block"])),
    parcel_no: cleanText(readProperty(properties, fields.parcel, ["parsel", "parsel_no", "parcel"])),
    parcel_polygon: parcelPolygon,
    source_geometry: sourceGeometry,
    geometry_hash: createHash("sha256").update(JSON.stringify(sourceGeometry)).digest("hex"),
    source: "tkgm_authorized",
    source_accuracy: "authorized_source",
    source_srid: Number(process.env.TKGM_SOURCE_SRID || 4326),
    source_updated_at: sourceUpdatedAt,
    source_payload: {
      featureId: feature.id ?? null,
      typeName: process.env.TKGM_WFS_TYPENAME || null,
    },
    ingested_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function authorizationHeaders() {
  const headers = { Accept: "application/geo+json, application/json" };
  const bearerToken = cleanText(process.env.TKGM_BEARER_TOKEN);
  const apiKey = cleanText(process.env.TKGM_API_KEY);
  const username = cleanText(process.env.TKGM_USERNAME);
  const password = cleanText(process.env.TKGM_PASSWORD);

  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  } else if (username && password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }

  if (apiKey) {
    headers[process.env.TKGM_API_KEY_HEADER || "X-API-Key"] = apiKey;
  }

  return headers;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
    }

    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`İstek ${REQUEST_TIMEOUT_MS} ms içinde tamamlanmadı.`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildWfsUrl(startIndex) {
  const url = new URL(required("TKGM_WFS_URL"));
  const version = process.env.TKGM_WFS_VERSION || "2.0.0";
  url.searchParams.set("service", "WFS");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("version", version);
  url.searchParams.set("typeNames", required("TKGM_WFS_TYPENAME"));
  url.searchParams.set("outputFormat", process.env.TKGM_WFS_OUTPUT_FORMAT || "application/json");
  url.searchParams.set("srsName", process.env.TKGM_WFS_SRS_NAME || "EPSG:4326");
  url.searchParams.set("startIndex", String(startIndex));

  if (version.startsWith("1.")) {
    url.searchParams.set("maxFeatures", String(PAGE_SIZE));
  } else {
    url.searchParams.set("count", String(PAGE_SIZE));
  }

  if (process.env.TKGM_WFS_BBOX) {
    url.searchParams.set("bbox", process.env.TKGM_WFS_BBOX);
  }

  if (process.env.TKGM_WFS_CQL_FILTER) {
    url.searchParams.set("cql_filter", process.env.TKGM_WFS_CQL_FILTER);
  }

  return url;
}

async function* sourcePages() {
  const geojsonPath = cleanText(process.env.TKGM_GEOJSON_PATH);

  if (geojsonPath) {
    const file = JSON.parse(await readFile(path.resolve(geojsonPath), "utf8"));
    const features = file.type === "FeatureCollection" ? file.features : file.features || file;

    if (!Array.isArray(features)) {
      throw new Error("TKGM_GEOJSON_PATH bir FeatureCollection veya Feature dizisi içermeli.");
    }

    for (let index = 0; index < features.length; index += PAGE_SIZE) {
      yield features.slice(index, index + PAGE_SIZE);
    }

    return;
  }

  required("TKGM_WFS_URL");
  required("TKGM_WFS_TYPENAME");

  for (let startIndex = 0; ; startIndex += PAGE_SIZE) {
    const page = await fetchJson(buildWfsUrl(startIndex), { headers: authorizationHeaders() });
    const features = Array.isArray(page?.features) ? page.features : [];

    if (!features.length) {
      return;
    }

    yield features;

    if (features.length < PAGE_SIZE) {
      return;
    }
  }
}

async function upsertRows(rows) {
  if (DRY_RUN || !rows.length) {
    return;
  }

  const supabaseUrl = required("SUPABASE_URL", process.env.EXPO_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const endpoint = new URL("/rest/v1/cbs_units", supabaseUrl);
  endpoint.searchParams.set("on_conflict", "tkgm_parcel_id");

  await fetchJson(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  });
}

const fields = {
  id: process.env.TKGM_ID_FIELD,
  city: process.env.TKGM_CITY_FIELD,
  district: process.env.TKGM_DISTRICT_FIELD,
  village: process.env.TKGM_VILLAGE_FIELD,
  block: process.env.TKGM_ADA_FIELD,
  parcel: process.env.TKGM_PARCEL_FIELD,
  updatedAt: process.env.TKGM_UPDATED_AT_FIELD,
};

let readCount = 0;
let validCount = 0;
let rejectedCount = 0;

for await (const features of sourcePages()) {
  const mapped = [];

  for (const feature of features) {
    if (MAX_FEATURES && readCount >= MAX_FEATURES) {
      break;
    }

    readCount += 1;

    try {
      mapped.push(mapFeature(feature, fields));
      validCount += 1;
    } catch (error) {
      rejectedCount += 1;
      console.error(`Kayıt ${feature?.id ?? readCount} atlandı: ${error.message}`);
    }
  }

  for (let index = 0; index < mapped.length; index += UPSERT_BATCH_SIZE) {
    await upsertRows(mapped.slice(index, index + UPSERT_BATCH_SIZE));
  }

  console.log(`Okunan=${readCount} geçerli=${validCount} hatalı=${rejectedCount}`);

  if (MAX_FEATURES && readCount >= MAX_FEATURES) {
    break;
  }
}

console.log(
  DRY_RUN
    ? `Kuru çalışma tamamlandı. ${validCount} gerçek geometri doğrulandı; Supabase'e yazılmadı.`
    : `İçe aktarma tamamlandı. ${validCount} TKGM parseli Supabase'e aktarıldı.`,
);
