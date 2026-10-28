import { ANTALYA_REGION, CbsUnit, formatCoord, parsePolygon, type MapPoint } from "./cbs";
import { getTaskStatus } from "./workflowGuard";
import { fixMojibake } from "../utils/text";

type Ek8Source = {
  id?: string;
  city?: unknown;
  district?: unknown;
  village?: unknown;
  producerTc?: unknown;
  producerName?: unknown;
  fatherName?: unknown;
  birthDate?: unknown;
  detectionDate?: unknown;
  detectionNo?: unknown;
  unitNo?: unknown;
  adaNo?: unknown;
  parcelNo?: unknown;
  area?: unknown;
  crop?: unknown;
  type?: unknown;
  coverMaterial?: unknown;
  cultivationMethod?: unknown;
  productionMaterial?: unknown;
  plantingDate?: unknown;
  harvestDate?: unknown;
  productionAmount?: unknown;
  parcelPolygon: MapPoint[];
  greenhousePolygon: MapPoint[];
  greenhouseCoordinatePoints?: MapPoint[];
};

function clean(value: unknown, fallback = "-") {
  const text = fixMojibake(value).trim();
  return text || fallback;
}

function escapeHtml(value: unknown, fallback = "-") {
  return clean(value, fallback)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value: unknown) {
  const date = value ? new Date(String(value)) : new Date();

  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleDateString("tr-TR");
  }

  return date.toLocaleDateString("tr-TR");
}

function formatAreaValue(value: unknown) {
  const text = clean(value, "");

  if (!text) {
    return "-";
  }

  return text.toLocaleLowerCase("tr-TR").includes("m²") || text.toLocaleLowerCase("tr-TR").includes("m2")
    ? text
    : `${text} m²`;
}

function pointAt(points: MapPoint[], index: number): MapPoint | null {
  return points[index] || null;
}

function pointText(points: MapPoint[], index: number) {
  const point = pointAt(points, index);
  return point ? `${formatCoord(point.latitude)}, ${formatCoord(point.longitude)}` : "";
}

function cornerLabel(index: number) {
  return String.fromCharCode(65 + index);
}

function buildSketchSvg(parcelPoints: MapPoint[], greenhousePoints: MapPoint[]) {
  const allPoints = [...parcelPoints, ...greenhousePoints];

  if (!allPoints.length) {
    return '<div class="sketch-empty">Sera köşe koordinatları kaydedildiğinde kroki burada gösterilir.</div>';
  }

  const minLat = Math.min(...allPoints.map((point) => point.latitude));
  const maxLat = Math.max(...allPoints.map((point) => point.latitude));
  const minLng = Math.min(...allPoints.map((point) => point.longitude));
  const maxLng = Math.max(...allPoints.map((point) => point.longitude));
  const latSpan = maxLat - minLat || 0.00001;
  const lngSpan = maxLng - minLng || 0.00001;
  const project = (point: MapPoint) => ({
    x: 12 + ((point.longitude - minLng) / lngSpan) * 176,
    y: 10 + ((maxLat - point.latitude) / latSpan) * 62,
  });
  const pointsAttribute = (points: MapPoint[]) =>
    points.map((point) => {
      const projected = project(point);
      return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
    }).join(" ");
  const parcel = parcelPoints.length >= 3
    ? `<polygon points="${pointsAttribute(parcelPoints)}" fill="#e5e7eb" stroke="#64748b" stroke-width="1.5" stroke-dasharray="4 3" />`
    : "";
  const greenhouse = greenhousePoints.length >= 3
    ? `<polygon points="${pointsAttribute(greenhousePoints)}" fill="#bbf7d0" stroke="#15803d" stroke-width="2" />`
    : "";
  const labels = greenhousePoints.map((point, index) => {
    const projected = project(point);
    const label = cornerLabel(index).toLocaleLowerCase("tr-TR");
    return `<circle cx="${projected.x}" cy="${projected.y}" r="2.4" fill="#166534" /><text x="${projected.x + 3}" y="${projected.y - 3}" font-size="7" fill="#14532d">${label}</text>`;
  }).join("");
  return `<svg viewBox="0 0 200 82" role="img" aria-label="Koordinatlara göre sera krokisi" preserveAspectRatio="xMidYMid meet">${parcel}${greenhouse}${labels}</svg>`;
}

function identityDigits(value: unknown) {
  const digits = clean(value, "").replace(/\D/g, "").slice(0, 11).split("");
  const cells = Array.from({ length: 11 }, (_, index) => `<td class="id-digit">${digits[index] || ""}</td>`).join("");
  return cells;
}

function normalizeTaskPolygon(value: unknown, center: MapPoint) {
  return parsePolygon(value, center).map((point) => ({
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
  }));
}

function getPhotoCornerPoints(task: any, fallbackPoints: MapPoint[]): MapPoint[] {
  const evidence = Array.isArray(task?.evidence) ? task.evidence : [];
  const photoPoints = new Map<number, MapPoint>();
  evidence.forEach((item: any) => {
    const label = String(item?.corner_label || "").toLowerCase();
    if (!/^[a-h]$/.test(label)) return;
    const point = { latitude: Number(item.latitude), longitude: Number(item.longitude) };
    if (
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude) &&
      Math.abs(point.latitude) <= 90 &&
      Math.abs(point.longitude) <= 180
    ) {
      photoPoints.set(label.charCodeAt(0) - 97, point);
    }
  });

  const lastPhotoIndex = photoPoints.size ? Math.max(...photoPoints.keys()) : -1;
  const pointCount = Math.max(fallbackPoints.length, lastPhotoIndex + 1);
  const points: MapPoint[] = [];

  for (let index = 0; index < pointCount; index += 1) {
    const point = photoPoints.get(index) || fallbackPoints[index];
    if (!point) return fallbackPoints;
    points.push(point);
  }

  return points;
}

function getDescriptionValue(description: unknown, labels: string[]) {
  const lines = String(description || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const wanted = labels.map((label) => label.toLocaleLowerCase("tr-TR"));

  for (const line of lines) {
    const dividerIndex = line.indexOf(":");

    if (dividerIndex === -1) {
      continue;
    }

    const label = line.slice(0, dividerIndex).trim().toLocaleLowerCase("tr-TR");

    if (wanted.includes(label)) {
      return line.slice(dividerIndex + 1).trim();
    }
  }

  return "";
}

export function buildTaskEk8Source(task: any): Ek8Source {
  const center = {
    latitude: Number(task?.latitude || ANTALYA_REGION.latitude),
    longitude: Number(task?.longitude || ANTALYA_REGION.longitude),
  };
  const parcelPolygon = normalizeTaskPolygon(task?.parcel_polygon, center);
  const greenhousePolygon = normalizeTaskPolygon(task?.greenhouse_polygon, center);
  const photoCornerPoints = getPhotoCornerPoints(task, greenhousePolygon);
  const reportGreenhousePoints = photoCornerPoints.length >= 3 ? photoCornerPoints : greenhousePolygon;

  return {
    id: String(task?.id || ""),
    city: task?.city || task?.province || task?.il,
    district: task?.district_name || task?.district || task?.ilce,
    village: task?.village || task?.neighborhood || task?.mahalle,
    producerTc: task?.tc_no,
    producerName: task?.producer_name,
    fatherName: task?.father_name || task?.baba_adi,
    birthDate: task?.birth_date || task?.dogum_tarihi,
    detectionDate: task?.updated_at || task?.created_at,
    detectionNo: task?.report_no || task?.inspection_no || task?.id,
    unitNo: task?.unit_no,
    adaNo: task?.ada_no,
    parcelNo: task?.parcel_no,
    area: task?.greenhouse_area,
    crop: task?.detected_crop || task?.crop_name || task?.crop,
    type: task?.crop_type || task?.unit_type || getDescriptionValue(task?.description, ["Tür", "Tipi"]),
    coverMaterial: task?.cover_material || task?.cover_type || getDescriptionValue(task?.description, ["Örtü Tipi", "Örtü Malzemesi"]),
    cultivationMethod: task?.usage_type || task?.cultivation_method || getDescriptionValue(task?.description, ["Kullanım Şekli", "Yetiştiricilik Yöntemi"]),
    productionMaterial: task?.production_material || getDescriptionValue(task?.description, ["Materyal", "Üretim Materyali"]),
    plantingDate: task?.planting_date || getDescriptionValue(task?.description, ["Ekim/Dikim Tarihi"]),
    harvestDate:
      task?.harvest_dates ||
      task?.harvest_start_date ||
      getDescriptionValue(task?.description, ["Hasat Başlama Tarihi", "Hasat Tarihleri", "Hasat Başlangıç Tarihi"]),
    productionAmount: task?.production_amount || getDescriptionValue(task?.description, ["Miktar", "Üretim Miktarı"]),
    parcelPolygon,
    greenhousePolygon,
    greenhouseCoordinatePoints: reportGreenhousePoints,
  };
}

export function buildUnitEk8Source(unit: CbsUnit): Ek8Source {
  return {
    id: unit.id,
    city: unit.city,
    district: unit.district,
    village: unit.village,
    producerTc: unit.producerTc,
    producerName: unit.producerName,
    detectionDate: new Date().toISOString(),
    detectionNo: unit.registrationNo,
    unitNo: unit.unitNo,
    adaNo: unit.adaNo,
    parcelNo: unit.parcelNo,
    area: unit.greenhouseArea,
    crop: unit.crop,
    parcelPolygon: unit.parcelPolygon,
    greenhousePolygon: unit.greenhousePolygon,
    greenhouseCoordinatePoints: unit.greenhousePolygon,
  };
}

export function buildOfficialEk8Html(source: Ek8Source) {
  const today = formatDate(source.detectionDate);

  return `
    <!doctype html>
    <html lang="tr">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          @page { size: A4 landscape; margin: 8mm 10mm; }
          * { box-sizing: border-box; }
          body { margin: 0; color: #000; background: #fff; font-family: "Times New Roman", Times, serif; font-size: 10px; }
          .sheet { width: 100%; }
          .top { position: relative; min-height: 36px; text-align: center; }
          .ek { position: absolute; right: 28px; top: 0; font-weight: 700; font-size: 13px; }
          .title { padding-top: 18px; font-size: 15px; font-weight: 700; letter-spacing: 0.2px; }
          .local { width: 170px; margin-top: -2px; margin-bottom: 2px; line-height: 1.15; font-weight: 700; }
          .local-row { display: grid; grid-template-columns: 80px 8px 1fr; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          th, td { border: 1px solid #000; padding: 2px 4px; vertical-align: middle; }
          th { font-weight: 700; text-align: center; }
          .identity th { height: 15px; padding: 1px 3px; }
          .identity td { height: 16px; padding: 1px 3px; }
          .id-digit { width: 16px; text-align: center; padding: 0; }
          .main { margin-top: 18px; }
          .main th { height: 78px; font-size: 10px; line-height: 1.1; }
          .main td { height: 18px; text-align: center; }
          .mapbox { height: 86px; margin-top: 20px; border: 1px solid #000; display: flex; align-items: center; justify-content: center; }
          .mapbox svg { width: 100%; height: 100%; }
          .sketch-empty { color: #555; font-size: 10px; text-align: center; padding-top: 34px; }
          .coords td { height: 15px; padding: 1px 5px; }
          .coords .label { width: 43%; font-weight: 700; }
          .coords .value { width: 57%; }
          .note { margin-top: 16px; line-height: 1.35; font-size: 10.5px; }
          .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 80px; margin-top: 22px; padding: 0 190px; text-align: center; font-size: 13px; }
          .nowrap { white-space: nowrap; }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="top">
            <div class="ek">Ek-8</div>
            <div class="title">TESPİT TUTANAĞI</div>
          </div>

          <div class="local">
            <div class="local-row"><span>İLİ</span><span>:</span><span>${escapeHtml(source.city)}</span></div>
            <div class="local-row"><span>İLÇESİ</span><span>:</span><span>${escapeHtml(source.district)}</span></div>
            <div class="local-row"><span>KÖY/MAHALLE</span><span>:</span><span>${escapeHtml(source.village)}</span></div>
          </div>

          <table class="identity">
            <colgroup>
              ${Array.from({ length: 11 }, () => "<col style='width:16px' />").join("")}
              <col style="width:220px" />
              <col style="width:220px" />
              <col style="width:220px" />
              <col style="width:226px" />
            </colgroup>
            <tr>
              <th colspan="11">T.C. Kimlik No/Vergi Kimlik No</th>
              <th>Adı Soyadı</th>
              <th>Baba Adı</th>
              <th>Doğum Tarihi</th>
              <th>Tespit Tarihi: …/…/20…</th>
            </tr>
            <tr>
              ${identityDigits(source.producerTc)}
              <td>${escapeHtml(source.producerName)}</td>
              <td>${escapeHtml(source.fatherName, "")}</td>
              <td>${escapeHtml(source.birthDate, "")}</td>
              <td>Tespit No: ${escapeHtml(source.detectionNo, "")}</td>
            </tr>
          </table>

          <table class="main">
            <colgroup>
              <col style="width:62px" /><col style="width:78px" /><col style="width:74px" /><col style="width:64px" />
              <col style="width:66px" /><col style="width:72px" /><col style="width:66px" /><col style="width:70px" />
              <col style="width:84px" /><col style="width:94px" /><col style="width:98px" /><col style="width:94px" />
              <col style="width:78px" /><col style="width:76px" />
            </colgroup>
            <tr>
              <th>Sıra<br/>No</th>
              <th>Ünite No</th>
              <th>Mahalle</th>
              <th>Ada</th>
              <th>Parsel</th>
              <th>Ünite<br/>Alanı<br/>(m²)</th>
              <th>Ürün</th>
              <th>Tipi</th>
              <th>Örtü<br/>Malzemesi</th>
              <th>Yetiştiricilik<br/>Yöntemi<br/>Topraklı/<br/>Topraksız</th>
              <th>Üretim<br/>Materyali<br/>Tohum<br/>Fide/Fidan/<br/>Miscel/<br/>Diğer</th>
              <th>Ekim/Dikim<br/>Tarihi</th>
              <th>Hasat<br/>Başlangıç<br/>Tarihi</th>
              <th>Üretim<br/>Miktarı<br/>(kg/adet)</th>
            </tr>
            <tr>
              <td>1</td>
              <td>${escapeHtml(source.unitNo)}</td>
              <td>${escapeHtml(source.village)}</td>
              <td>${escapeHtml(source.adaNo)}</td>
              <td>${escapeHtml(source.parcelNo)}</td>
              <td>${escapeHtml(formatAreaValue(source.area))}</td>
              <td>${escapeHtml(source.crop)}</td>
              <td>${escapeHtml(source.type, "")}</td>
              <td>${escapeHtml(source.coverMaterial, "")}</td>
              <td>${escapeHtml(source.cultivationMethod, "")}</td>
              <td>${escapeHtml(source.productionMaterial, "")}</td>
              <td>${escapeHtml(source.plantingDate, "")}</td>
              <td>${escapeHtml(source.harvestDate, "")}</td>
              <td>${escapeHtml(source.productionAmount, "")}</td>
            </tr>
            <tr>${Array.from({ length: 14 }, () => "<td>&nbsp;</td>").join("")}</tr>
            <tr>${Array.from({ length: 14 }, () => "<td>&nbsp;</td>").join("")}</tr>
          </table>

          <div class="mapbox">
            ${buildSketchSvg(source.parcelPolygon, source.greenhouseCoordinatePoints || source.greenhousePolygon)}
          </div>

          <table class="coords">
            <tr>
              <td class="label">İl</td><td class="value">${escapeHtml(source.city)}</td>
              <td class="label">İlçe</td><td class="value">${escapeHtml(source.district)}</td>
            </tr>
            <tr>
              <td class="label">Köy/Mahalle</td><td class="value">${escapeHtml(source.village)}</td>
              <td class="label">Mevki</td><td class="value"></td>
            </tr>
            <tr>
              <td class="label">Ada No</td><td class="value">${escapeHtml(source.adaNo)}</td>
              <td class="label">Parsel No</td><td class="value">${escapeHtml(source.parcelNo)}</td>
            </tr>
            ${Array.from({ length: Math.max(4, source.parcelPolygon.length, source.greenhousePolygon.length, source.greenhouseCoordinatePoints?.length || 0) }, (_, index) => `
              <tr>
                <td class="label">Parsel Köşe Nokta Koordinat Değeri (${cornerLabel(index)})</td>
                <td class="value">${escapeHtml(pointText(source.parcelPolygon, index), "")}</td>
                <td class="label">Sera Köşe Nokta Koordinat Değeri (${cornerLabel(index).toLocaleLowerCase("tr-TR")})</td>
                <td class="value">${escapeHtml(pointText(source.greenhouseCoordinatePoints || source.greenhousePolygon, index), "")}</td>
              </tr>
            `).join("")}
          </table>

          <div class="note">
            Alanın ve üzerindeki her bir ünitenin ayrı ayrı olmak üzere basit şekli krokiye çizilir. (Alçak tüneller hariç)
            Köşe noktaları sayısı alanın şekline göre Tespit Komisyonunca belirlenir.<br/>
            İş bu tutanak, Uydu Görüntüleri/Coğrafi Bilgi Sistemi, GPS verileri kullanılarak İl/İlçe Müdürlüğü Teknik Elemanları
            tarafından yukarıdaki tabloda belirtildiği şekilde düzenlenmiş ve yerinde tespit edilerek tarafımızdan mahallinde imza
            altına alınmıştır. <span class="nowrap">${today}</span>
          </div>

          <div class="signatures">
            <div>Teknik Eleman</div>
            <div>CBS Sorumlusu</div>
            <div>Muhtar</div>
          </div>
        </div>
      </body>
    </html>
  `;
}

export function buildTaskEk8Html(task: any) {
  return buildOfficialEk8Html(buildTaskEk8Source(task));
}

export function buildUnitEk8Html(unit: CbsUnit) {
  return buildOfficialEk8Html(buildUnitEk8Source(unit));
}

export function getEk8ReportPayloadSummary(task: any) {
  return {
    status: getTaskStatus(task),
    generated_at: new Date().toISOString(),
    source: buildTaskEk8Source(task),
  };
}
