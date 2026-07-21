import { fixMojibake } from "../utils/text";

export type TaskWorkflowKind = "inspection" | "detection" | "classification";

export const taskStatuses = {
  waiting: "Bekliyor",
  assigned: "Sahaya Atandı",
  started: "Sahada",
  productVerified: "Ürün Doğrulandı",
  completed: "Denetim Tamamlandı",
  reportCreated: "Rapor Oluşturuldu",
  reportDownloaded: "Rapor Alındı",
  kobuksSynced: "KOBÜKS'e Aktarıldı",
  cancelled: "İptal Edildi",
};

const startedStatusKeys = new Set([
  "sahada",
  "urun dogrulandi",
  "denetim tamamlandi",
  "rapor olusturuldu",
  "rapor alindi",
  "kobukse aktarildi",
]);
const completedStatusKeys = new Set([
  "denetim tamamlandi",
  "tamamlandi",
  "raporlandi",
  "kapandi",
  "rapor olusturuldu",
  "rapor alindi",
  "kobukse aktarildi",
]);
const cancelledStatusKeys = new Set(["iptal edildi", "iptal", "iptal edildi"]);

export function normalizeWorkflowText(value: unknown) {
  return fixMojibake(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/İ/g, "i")
    .replace(/'/g, "")
    .trim();
}

export function getTaskStatus(task: any) {
  const statusText = [task?.workflow_status, task?.status, task?.compliance_result]
    .filter(Boolean)
    .join(" ");
  const normalized = normalizeWorkflowText(statusText);

  if (normalized.includes("iptal")) {
    return taskStatuses.cancelled;
  }

  return fixMojibake(task?.workflow_status || task?.status || taskStatuses.waiting);
}

export function getTaskWorkflowKind(task: any): TaskWorkflowKind {
  const workflowText = normalizeWorkflowText(`${task?.workflow_type || ""} ${task?.description || ""} ${task?.compliance_result || ""}`);

  if (workflowText.includes("siniflandirma")) {
    return "classification";
  }

  if (workflowText.includes("resen") || workflowText.includes("tespit")) {
    return "detection";
  }

  return "inspection";
}

export function hasAssignedInspector(task: any) {
  return Boolean(task?.assigned_to || task?.assigned_name);
}

export function hasTaskCoordinates(task: any) {
  return Boolean(
    (task?.latitude && task?.longitude) ||
      (Array.isArray(task?.greenhouse_polygon) && task.greenhouse_polygon.length) ||
      (Array.isArray(task?.parcel_polygon) && task.parcel_polygon.length),
  );
}

export function hasGreenhousePolygon(task: any) {
  const polygon = task?.greenhouse_polygon ?? task?.greenhousePolygon ?? task?.unit_polygon;

  if (Array.isArray(polygon)) {
    return polygon.length >= 3;
  }

  if (typeof polygon === "string") {
    try {
      const parsed = JSON.parse(polygon);
      return Array.isArray(parsed) && parsed.length >= 3;
    } catch {
      return false;
    }
  }

  return hasPolygonCoordinatesInDescription(task?.description);
}

function hasPolygonCoordinatesInDescription(description: unknown) {
  const coordinateCount = String(description || "")
    .split("\n")
    .filter((line) => /-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/.test(line))
    .length;

  return coordinateCount >= 3;
}

export function hasCropVerification(task: any) {
  const resultText = normalizeWorkflowText(task?.compliance_result);

  return Boolean(
    resultText &&
      !resultText.includes("iptal") &&
      !resultText.includes("bekliyor") &&
      !resultText.includes("gorev") &&
      (resultText.includes("dogruland") || resultText.includes("tespiti") || task?.registered_crop),
  );
}

export function hasKobuksSameConfirmation(task: any) {
  const resultText = normalizeWorkflowText(`${task?.compliance_result || ""} ${task?.description || ""}`);

  return resultText.includes("kobuks") && (resultText.includes("dogruland") || resultText.includes("ayni"));
}

export function isTaskStarted(task: any) {
  const status = normalizeWorkflowText(getTaskStatus(task));
  return startedStatusKeys.has(status);
}

export function isTaskCompleted(task: any) {
  const status = normalizeWorkflowText(getTaskStatus(task));
  return completedStatusKeys.has(status);
}

export function hasReportOutput(task: any) {
  const status = normalizeWorkflowText(getTaskStatus(task));
  return status === "rapor olusturuldu" || status === "rapor alindi" || status === "kobukse aktarildi";
}

export function hasReportDownload(task: any) {
  const status = normalizeWorkflowText(getTaskStatus(task));
  return status === "rapor alindi" || status === "kobukse aktarildi";
}

export function hasKobuksSync(task: any) {
  const status = normalizeWorkflowText(getTaskStatus(task));
  return status === "kobukse aktarildi";
}

export function isTaskCancelled(task: any) {
  const status = normalizeWorkflowText(getTaskStatus(task));
  return cancelledStatusKeys.has(status);
}

export function isTaskClosed(task: any) {
  return isTaskCompleted(task) || isTaskCancelled(task);
}

export function hasResenCropDifference(task: any) {
  const resultText = normalizeWorkflowText(task?.compliance_result);
  return resultText.includes("resen") || resultText.includes("farkli") || resultText.includes("tespiti");
}

export function validateTaskForAssignment(task: any) {
  const missing: string[] = [];
  const workflowKind = getTaskWorkflowKind(task);

  if (!task) {
    return ["Görev kaydı bulunamadı."];
  }

  if (hasAssignedInspector(task)) {
    missing.push("Bu görev zaten bir denetçiye atanmış.");
  }

  if (isTaskClosed(task)) {
    missing.push("Tamamlanmış veya iptal edilmiş görev tekrar atanamaz.");
  }

  if (!String(task?.unit_no || "").trim()) {
    missing.push("Ünite no seçilmeli.");
  }

  if (!String(task?.ada_no || "").trim() || !String(task?.parcel_no || "").trim()) {
    missing.push("Ada/parsel bilgisi CBS veya KOBÜKS kaydından gelmeli.");
  }

  if (!hasTaskCoordinates(task)) {
    missing.push("CBS koordinatı veya sera poligonu bulunmalı.");
  }

  if (workflowKind === "inspection") {
    if (!String(task?.producer_name || "").trim()) {
      missing.push("Başvurulu denetimde üretici KOBÜKS'ten gelmeli.");
    }

    if (!String(task?.detected_crop || "").trim()) {
      missing.push("Başvurulu denetimde kayıtlı ürün KOBÜKS'ten gelmeli.");
    }
  }

  return missing;
}

export function validateTaskBeforeStart(task: any) {
  const missing: string[] = [];

  if (!hasAssignedInspector(task)) {
    missing.push("Denetçi ataması yapılmalı.");
  }

  if (isTaskClosed(task)) {
    missing.push("Kapalı görev başlatılamaz.");
  }

  return missing;
}

export function validateTaskBeforeCompletion(task: any, evidence: any[]) {
  const missing: string[] = [];
  const workflowKind = getTaskWorkflowKind(task);
  const quickKobuksInspection = workflowKind === "inspection" && hasKobuksSameConfirmation(task);

  if (!hasAssignedInspector(task)) {
    missing.push("Denetçi ataması yapılmalı.");
  }

  if (!quickKobuksInspection && !hasGreenhousePolygon(task)) {
    missing.push("CBS ünite poligonu çizilmeli veya seçilmeli.");
  }

  if (isTaskCancelled(task)) {
    missing.push("İptal edilen görev tamamlanamaz.");
  }

  if (!isTaskStarted(task)) {
    missing.push("Denetim sahada başlatılmalı.");
  }

  if (!quickKobuksInspection && !evidence.length) {
    missing.push("En az bir saha kanıt fotoğrafı eklenmeli.");
  }

  if (workflowKind !== "classification" && !hasCropVerification(task)) {
    missing.push("Ürün doğrulama veya re'sen tespit sonucu kaydedilmeli.");
  }

  return [...new Set(missing)];
}

export function validateTaskBeforeReport(task: any, evidence: any[]) {
  const missing = validateTaskBeforeCompletion(task, evidence);

  if (!isTaskCompleted(task)) {
    missing.push("Rapor için denetim kaydedilmeli.");
  }

  return [...new Set(missing)];
}

export function validateTaskBeforeKobuksSync(task: any, evidence: any[]) {
  const missing = validateTaskBeforeCompletion(task, evidence);

  if (!isTaskCompleted(task)) {
    missing.push("KOBÜKS aktarımı için denetim kaydedilmeli.");
  }

  if (!hasReportDownload(task)) {
    missing.push("KOBÜKS aktarımından önce rapor oluşturulmalı ve PDF/Excel alınmalı.");
  }

  return [...new Set(missing)];
}

export function buildTaskWorkflowSummary(task: any, evidence: any[]) {
  const assignmentMissing = hasAssignedInspector(task) ? [] : validateTaskForAssignment(task);
  const creationMissing = validateTaskForAssignment(task).filter(
    (item) => !item.includes("zaten") && !item.includes("Tamamlanmış") && !item.includes("iptal"),
  );
  const startMissing = validateTaskBeforeStart(task);
  const completionMissing = validateTaskBeforeCompletion(task, evidence);
  const kobuksMissing = validateTaskBeforeKobuksSync(task, evidence);
  const reportMissing = validateTaskBeforeReport(task, evidence);

  return [
    { key: "create", title: "Görev oluştur", ready: !creationMissing.length, missing: creationMissing },
    { key: "assign", title: "Denetçiye ata", ready: hasAssignedInspector(task) || !assignmentMissing.length, missing: assignmentMissing },
    { key: "start", title: "Denetimi başlat", ready: isTaskStarted(task) || !startMissing.length, missing: startMissing },
    { key: "evidence", title: "Fotoğraf ve GPS", ready: Boolean(evidence.length), missing: evidence.length ? [] : ["Kanıt fotoğrafı eklenmeli."] },
    { key: "complete", title: "Kaydet", ready: isTaskCompleted(task) || !completionMissing.length, missing: completionMissing },
    { key: "report", title: "Rapor oluştur", ready: hasReportOutput(task) || !reportMissing.length, missing: reportMissing },
    { key: "download", title: "Rapor al (PDF/Excel)", ready: hasReportDownload(task), missing: hasReportDownload(task) ? [] : ["Rapor oluşturulmalı ve alınmalı."] },
    { key: "kobuks", title: "KOBÜKS'e aktar", ready: hasKobuksSync(task) || !kobuksMissing.length, missing: kobuksMissing },
  ];
}
