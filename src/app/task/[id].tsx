import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Linking from "expo-linking";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useRef, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { supabase } from "../../lib/supabase";
import { BottomTabMenu } from "../../components/BottomTabMenu";
import { PRODUCT_OPTIONS, getProductVarietyOptions } from "../../data/products";
import { getCenter, parsePolygon, type MapPoint } from "../../services/cbs";
import { assignTaskToInspector } from "../../services/assignments";
import { getLatestEk8ReportForTask, shareEk8ReportPdf } from "../../services/ek8Report";
import { updateTaskOnlineOrQueue } from "../../services/offline";
import { exportTaskPdf } from "../../services/pdfExport";
import { getMyProfile, isAdmin } from "../../services/profile";
import { getTaskById } from "../../services/taskDetail";
import { deleteTaskById } from "../../services/tasks";
import { fixMojibake } from "../../utils/text";
import {
  getTaskStatus,
  getTaskWorkflowKind,
  hasGreenhousePolygon,
  hasReportDownload,
  hasKobuksSync,
  hasReportOutput,
  hasAssignedInspector as taskHasAssignedInspector,
  isTaskCancelled,
  isTaskCompleted,
  isTaskStarted,
  taskStatuses,
  type TaskWorkflowKind,
  validateTaskBeforeCompletion,
  validateTaskBeforeKobuksSync,
  validateTaskBeforeReport,
  validateTaskBeforeStart,
  validateTaskForAssignment,
} from "../../services/workflowGuard";

type FieldConfig = {
  key: string;
  label: string;
  inputType?: "date";
  options?: string[];
  taskKey?: string;
};

const detectionFields: FieldConfig[] = [
  { key: "detected_crop", label: "Ürün", options: PRODUCT_OPTIONS, taskKey: "detected_crop" },
  { key: "unit_status", label: "Ünite Durumu", options: ["Aktif", "Pasif"] },
  { key: "usage_type", label: "Kullanım Şekli", options: ["Topraklı", "Topraksız", "Saksılı", "Fide Üretimi", "Diğer"] },
  { key: "crop_variety", label: "Çeşit" },
  { key: "production_material", label: "Materyal", options: ["Tohum", "Fide", "Fidan", "Çelik", "Diğer"] },
  { key: "production_season", label: "Dönem", options: ["İlkbahar", "Güz", "Tek Üretim", "Çift Ürün"] },
  { key: "production_model", label: "Model", options: ["Konvansiyonel", "Organik", "İyi Tarım", "Topraksız", "Hidroponik"] },
  { key: "planting_area", label: "Alan", taskKey: "greenhouse_area" },
  { key: "planting_date", label: "Ekim/Dikim Tarihi", inputType: "date" },
  { key: "harvest_dates", label: "Hasat Başlama Tarihi", inputType: "date" },
  { key: "production_amount", label: "Miktar" },
];

const classificationFields: FieldConfig[] = [
  { key: "construction_age", label: "Konstrüksiyon Yaşı", options: ["1-9", "10-19", "20-29", "30+"] },
  { key: "foundation_concrete", label: "Çevre Temel Betonu", options: ["Var (Yüksek)", "Var (Sabitleme)", "Yok"] },
  { key: "cover_material", label: "Örtü Tipi", options: ["Plastik", "Cam", "Diğer"] },
  { key: "gutter_height", label: "Oluk Altı Yüksekliği", options: ["2.50 m altı", "2.51 - 4.99 m", "5.00 m ve üzeri"] },
  { key: "profile_material", label: "Profil Malzeme Türü", options: ["Kutu Profil", "Boru Profil", "L Profil", "Diğer"] },
  { key: "profile_structure", label: "Profil Yapısı", options: ["Galvanizli", "Demir(Boyalı)", "Demir(Boyasız)"] },
  { key: "ventilation", label: "Havalandırma Şekli", options: ["Tepe", "Yan+Tepe", "Yan", "Yok"] },
  { key: "automation", label: "Otomasyon Tipi", options: ["İklimlendirme, Gübreleme, Havalandırma", "Yok"] },
  { key: "heating_type", label: "Isıtma Türü", options: ["Soba+Tepe Yağmurlama", "Tepe Yağmurlama", "Soba", "Yok"] },
];

const detectionRequiredFieldKeys = new Set(["detected_crop", "unit_status", "usage_type", "planting_area"]);

const passiveProfileStatuses = new Set(["passive", "inactive", "pasif", "inaktif", "disabled", "false", "0"]);
const calendarWeekDays = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

const workflowLabels: Record<TaskWorkflowKind, string> = {
  inspection: "Başvurulu Denetim",
  detection: "Re'sen Tespit",
  classification: "Sınıflandırma",
};

const startModeOptions: Record<
  TaskWorkflowKind,
  { key: TaskWorkflowKind; title: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; color: string }
> = {
  inspection: { key: "inspection", title: "Başvurulu Denetim", icon: "clipboard-check-outline", color: "#16a34a" },
  detection: { key: "detection", title: "Re'sen Tespit", icon: "sprout-outline", color: "#0ea5e9" },
  classification: { key: "classification", title: "Sınıflandırma", icon: "greenhouse", color: "#f59e0b" },
};

function getWorkflowLines(description: unknown) {
  return String(description || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const dividerIndex = line.indexOf(":");

      if (dividerIndex === -1) {
        return { label: "Not", value: line };
      }

      return {
        label: line.slice(0, dividerIndex).trim(),
        value: line.slice(dividerIndex + 1).trim() || "-",
      };
    });
}

function getDescriptionMap(description: unknown) {
  const map = new Map<string, string>();

  getWorkflowLines(description).forEach((line) => {
    map.set(line.label.toLocaleLowerCase("tr-TR"), line.value);
  });

  return map;
}

function getFiniteCoordinate(task: any): MapPoint | null {
  const latitude = Number(task?.latitude);
  const longitude = Number(task?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function getTaskNavigationTarget(task: any): MapPoint | null {
  const fallback = getFiniteCoordinate(task);

  if (task?.greenhouse_polygon && fallback) {
    return getCenter(parsePolygon(task.greenhouse_polygon, fallback));
  }

  return fallback;
}

function getFieldConfig(workflowKind: TaskWorkflowKind) {
  return workflowKind === "classification" ? classificationFields : detectionFields;
}

function getClassificationAgeBand(fields: Record<string, string>) {
  return String(fields.construction_age || "").trim();
}

function getClassificationScore(fields: Record<string, string>) {
  const ageBand = getClassificationAgeBand(fields);
  const foundation = String(fields.foundation_concrete || "").trim();
  const cover = String(fields.cover_material || "").trim();
  const gutter = String(fields.gutter_height || "").trim();
  const profileMaterial = String(fields.profile_material || "").trim();
  const profileStructure = String(fields.profile_structure || "").trim();
  const ventilation = String(fields.ventilation || "").trim();
  const automation = String(fields.automation || "").trim();
  const heating = String(fields.heating_type || "").trim();

  let score = 0;

  if (ageBand === "1-9") score += 50;
  else if (ageBand === "10-19") score += 25;
  else if (ageBand === "20-29") score += 10;

  if (ageBand === "1-9" && foundation === "Var (Yüksek)") score += 50;
  else if (ageBand === "1-9" && foundation === "Var (Sabitleme)") score += 35;
  else if (ageBand === "10-19" && foundation === "Var (Yüksek)") score += 30;
  else if (ageBand === "10-19" && foundation === "Var (Sabitleme)") score += 20;
  else if (ageBand === "20-29" && foundation === "Var (Yüksek)") score += 15;
  else if (ageBand === "20-29" && foundation === "Var (Sabitleme)") score += 10;

  if (cover === "Plastik" && gutter === "2.51 - 4.99 m") score += 40;
  else if (cover === "Plastik" && gutter === "5.00 m ve üzeri") score += 50;

  if (profileMaterial === "Kutu Profil" || profileMaterial === "Boru Profil") score += 50;
  else if (profileMaterial === "L Profil") score += 10;

  if (profileStructure === "Galvanizli") score += 50;
  else if (profileStructure === "Demir(Boyalı)") score += 25;

  if (cover === "Plastik" && ventilation === "Tepe") score += 50;
  else if (cover === "Plastik" && ventilation === "Yan+Tepe") score += 35;
  else if (cover === "Plastik" && ventilation === "Yan") score += 10;

  if (automation === "İklimlendirme, Gübreleme, Havalandırma") score += 50;

  if (heating === "Soba+Tepe Yağmurlama") score += 50;
  else if (heating === "Tepe Yağmurlama") score += 30;
  else if (heating === "Soba") score += 10;

  return score;
}

function getClassificationClass(score: number) {
  if (score < 50) return "Çok Kötü";
  if (score < 100) return "Kötü";
  if (score < 200) return "Orta";
  if (score < 300) return "İyi";
  return "Çok İyi";
}

function getClassificationResult(fields: Record<string, string>) {
  const score = getClassificationScore(fields);
  return {
    score,
    className: getClassificationClass(score),
  };
}

function buildManualFields(task: any, workflowKind: TaskWorkflowKind) {
  const descriptionMap = getDescriptionMap(task?.description);
  const config = getFieldConfig(workflowKind);
  const fallbackByKey: Record<string, unknown> = {
    detected_crop: task?.detected_crop || task?.registered_crop || task?.crop_name || task?.crop,
    unit_status: task?.unit_status || task?.registration_status || task?.status || "Aktif",
    usage_type: task?.usage_type || task?.cultivation_method || task?.cultivation_type,
    crop_type: task?.crop_type || task?.product_type,
    crop_variety: task?.crop_variety || task?.variety,
    production_material: task?.production_material,
    production_season: task?.production_season,
    production_model: task?.production_model,
    planting_area: task?.greenhouse_area,
    planting_date: task?.planting_date,
    harvest_dates: task?.harvest_dates || task?.harvest_start_date,
    production_amount: task?.production_amount,
  };

  return config.reduce<Record<string, string>>((fields, field) => {
    const fromDescription = descriptionMap.get(field.label.toLocaleLowerCase("tr-TR"));
    const fromTask = field.taskKey ? task?.[field.taskKey] : "";
    fields[field.key] = fixMojibake(fromDescription || fromTask || fallbackByKey[field.key] || "");
    return fields;
  }, {});
}

function mergeManualDescription(description: unknown, workflowKind: TaskWorkflowKind, fields: Record<string, string>) {
  const config = getFieldConfig(workflowKind);
  const labels = new Set([
    ...config.map((field) => field.label.toLocaleLowerCase("tr-TR")),
    "tür",
    "sınıflandırma puanı",
    "sınıflandırma sonucu",
  ]);
  const existingLines = String(description || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const label = line.includes(":") ? line.slice(0, line.indexOf(":")).trim().toLocaleLowerCase("tr-TR") : "";
      return !labels.has(label);
    });

  const manualLines = config
    .map((field) => {
      const value = String(fields[field.key] || "").trim();
      return value ? `${field.label}: ${value}` : "";
    })
    .filter(Boolean);

  return [...existingLines, ...manualLines].join("\n");
}

function getProfileName(profile: any) {
  return String(profile?.full_name || profile?.email || profile?.id || "Kullanıcı");
}

function getProfileSubtitle(profile: any) {
  const parts = [profile?.email, profile?.city || profile?.work_city, profile?.district || profile?.work_district].filter(Boolean);

  return parts.join(" · ");
}

function getProfileRole(profile: any) {
  const roles: Record<string, string> = {
    admin: "Admin",
    manager: "Yönetici",
    inspector: "Denetçi",
    worker: "Saha personeli",
  };

  return roles[String(profile?.role || "")] || String(profile?.title || profile?.role || "Kullanıcı");
}

function isActiveProfile(profile: any) {
  if (!profile?.id) {
    return false;
  }

  if (profile?.is_active === false) {
    return false;
  }

  const status = String(profile?.status || "").trim().toLocaleLowerCase("tr-TR");

  return !passiveProfileStatuses.has(status);
}

function mergeAssignableUsers(users: any[], profile: any, task: any) {
  const map = new Map<string, any>();

  [...users, profile]
    .filter(isActiveProfile)
    .forEach((item) => {
      map.set(String(item.id), item);
    });

  if (task?.assigned_to && !map.has(String(task.assigned_to))) {
    map.set(String(task.assigned_to), {
      id: task.assigned_to,
      full_name: task.assigned_name || "Atanan kullanıcı",
      role: "inspector",
    });
  }

  return [...map.values()].sort((first, second) => getProfileName(first).localeCompare(getProfileName(second), "tr"));
}

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams();
  const initializedTaskIdRef = useRef("");
  const [task, setTask] = useState<any>(null);
  const [evidence, setEvidence] = useState<any[]>([]);
  const [inspectors, setInspectors] = useState<any[]>([]);
  const [selectedInspector, setSelectedInspector] = useState("");
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cropMatches, setCropMatches] = useState<"same" | "different" | "">("");
  const [manualFields, setManualFields] = useState<Record<string, string>>({});
  const [fieldMode, setFieldMode] = useState<TaskWorkflowKind>("inspection");
  const [saving, setSaving] = useState(false);
  const [closingAction, setClosingAction] = useState<"" | "kobuks" | "report" | "pdf" | "excel">("");
  const [previewEvidence, setPreviewEvidence] = useState<any>(null);

  const loadEvidence = useCallback(async () => {
    const result = await supabase
      .from("task_evidence")
      .select("*")
      .eq("task_id", id)
      .order("created_at", { ascending: false });

    return result.data || [];
  }, [id]);

  const loadAssignableUsers = useCallback(async () => {
    const result = await supabase.from("profiles").select("*");

    return result.data || [];
  }, []);

  useFocusEffect(
    useCallback(() => {
    let active = true;
    const currentTaskId = String(Array.isArray(id) ? id[0] : id || "");
    const shouldInitializeForm = initializedTaskIdRef.current !== currentTaskId;

    if (shouldInitializeForm) {
      setLoading(true);
    }

    Promise.all([getTaskById(id), loadEvidence(), loadAssignableUsers(), getMyProfile().catch(() => null)])
      .then(([taskResult, evidenceResult, usersResult, profileResult]) => {
        if (!active) {
          return;
        }

        const nextTask = taskResult.data;
        const nextWorkflowKind = getTaskWorkflowKind(nextTask);

        setTask(nextTask);
        if (shouldInitializeForm) {
          setFieldMode(nextWorkflowKind);
          setManualFields(buildManualFields(nextTask, nextWorkflowKind));
          initializedTaskIdRef.current = currentTaskId;
        }
        setEvidence(evidenceResult);
        setInspectors(mergeAssignableUsers(usersResult, profileResult, nextTask));
        setProfile(profileResult);
        setSelectedInspector(String(nextTask?.assigned_to || ""));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [id, loadEvidence, loadAssignableUsers]),
  );

  const management = isAdmin(profile) || profile?.role === "manager";
  const currentStatus = getTaskStatus(task);
  const workflowKind = getTaskWorkflowKind(task);
  const workflowLabel = workflowLabels[workflowKind];
  const workflowMeta = startModeOptions[workflowKind];
  const inspectionStarted = isTaskStarted(task);
  const inspectionCancelled = isTaskCancelled(task);
  const reportReady = isTaskCompleted(task);
  const assignedInspector = taskHasAssignedInspector(task);
  const assignedToMe =
    profile?.id &&
    (String(task?.assigned_to || "") === String(profile.id) || String(task?.user_id || "") === String(profile.id));
  const canInspectTask = !management && Boolean(assignedToMe);
  const inspectionEditable = canInspectTask && inspectionStarted && !reportReady && !inspectionCancelled;
  const kobuksTransferred = hasKobuksSync(task);
  const reportCreated = hasReportOutput(task);
  const reportDownloaded = hasReportDownload(task);
  const canCreateReport = canInspectTask && reportReady && !reportCreated && !inspectionCancelled;
  const canDownloadReport = canInspectTask && reportCreated && !reportDownloaded && !kobuksTransferred && !inspectionCancelled;
  const canSyncKobuks = canInspectTask && reportDownloaded && !kobuksTransferred && !inspectionCancelled;
  const assignmentMissingItems = useMemo(() => validateTaskForAssignment(task), [task]);
  const canAssignTask = management && !assignedInspector && !reportReady && !inspectionCancelled;
  const canCancelTask = management && assignedInspector && !inspectionCancelled && !reportReady;
  const showInspectionFlow = canInspectTask && !reportReady;
  const manualFieldConfig = useMemo(
    () =>
      getFieldConfig(fieldMode).map((field) =>
        field.key === "crop_variety"
          ? {
              ...field,
              options: getProductVarietyOptions(fixMojibake(manualFields.detected_crop || task?.detected_crop)),
            }
          : field,
      ),
    [fieldMode, manualFields.detected_crop, task?.detected_crop],
  );
  const classificationResult = useMemo(() => getClassificationResult(manualFields), [manualFields]);
  const saveMissingItems = useMemo(() => {
    const missing: string[] = [];

    if (!isTaskStarted(task)) {
      missing.push("Denetim sahada başlatılmalı.");
    }

    if (fieldMode === "inspection") {
      if (!cropMatches) {
        missing.push("KOBÜKS ile aynı veya farklı ürün seçilmeli.");
      }

      if (cropMatches === "different") {
        missing.push("Farklı ürün için Re'sen Kayıt açılmalı.");
      }

      return [...new Set(missing)];
    }

    if (!hasGreenhousePolygon(task)) {
      missing.push("CBS ünite poligonu çizilmeli veya seçilmeli.");
    }

    if (!evidence.length) {
      missing.push("En az bir saha kanıt fotoğrafı eklenmeli.");
    }

    const requiredFields =
      fieldMode === "classification"
        ? classificationFields
        : detectionFields.filter((field) => detectionRequiredFieldKeys.has(field.key));

    requiredFields.forEach((field) => {
      if (!String(manualFields[field.key] || "").trim()) {
        missing.push(`${field.label} girilmeli.`);
      }
    });

    return [...new Set(missing)];
  }, [cropMatches, evidence.length, fieldMode, manualFields, task]);
  const canSaveInspection = inspectionEditable && !saveMissingItems.length;
  const selectedInspectorProfile = useMemo(
    () => inspectors.find((item) => String(item.id) === String(selectedInspector)),
    [inspectors, selectedInspector],
  );

  async function loadTask() {
    const result = await getTaskById(id);
    const nextWorkflowKind = getTaskWorkflowKind(result.data);
    setTask(result.data);
    setFieldMode(nextWorkflowKind);
    setManualFields(buildManualFields(result.data, nextWorkflowKind));
  }

  async function assignInspector() {
    const inspector = inspectors.find((item) => String(item.id) === String(selectedInspector));

    if (!inspector) {
      Alert.alert("Denetçi seçin", "Görev atamak için listeden bir denetçi seçin.");
      return;
    }

    setAssigning(true);

    try {
      await assignTaskToInspector(id, inspector);
      Alert.alert("Başarılı", "Görev atandı ve personele bildirim kaydı oluşturuldu.");
      await loadTask();
    } catch (error: any) {
      Alert.alert("Atama yapılamadı", error?.message || "Görev atanamadı.");
    } finally {
      setAssigning(false);
    }
  }

  async function updateStatus(status: string) {
    const payload = { workflow_status: status, status };
    const result = await updateTaskOnlineOrQueue(id, payload, `Görev durumu: ${status}`);
    const nextTask = {
      ...task,
      ...(result.data || payload),
    };

    setTask(nextTask);
    setFieldMode(getTaskWorkflowKind(nextTask));
    setManualFields(buildManualFields(nextTask, getTaskWorkflowKind(nextTask)));
    return {
      queued: Boolean(result.queued),
    };
  }

  async function cancelInspection() {
    Alert.alert("Görevi iptal et", "Bu görev admin tarafından iptal edildi olarak işaretlenecek.", [
      {
        text: "Vazgeç",
        style: "cancel",
      },
      {
        text: "İptal Et",
        style: "destructive",
        onPress: async () => {
          setCancelling(true);

          try {
            const taskId = String(Array.isArray(id) ? id[0] : id || "");
            const result = await supabase
              .from("tasks")
              .update({
                workflow_status: taskStatuses.cancelled,
                status: taskStatuses.cancelled,
                compliance_result: task?.compliance_result || "Admin tarafından iptal edildi",
              })
              .eq("id", taskId)
              .select("*")
              .single();

            if (result.error) {
              throw result.error;
            }

            setTask(result.data);
            Alert.alert("İptal edildi", "Denetim iptal edildi olarak güncellendi.");
          } catch (error: any) {
            Alert.alert("İptal edilemedi", error?.message || "Denetim durumu güncellenemedi.");
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
  }

  async function deleteInspection() {
    Alert.alert("Denetimi sil", "İptal edilen denetim kalıcı olarak silinecek.", [
      {
        text: "Vazgeç",
        style: "cancel",
      },
      {
        text: "Sil",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);

          try {
            await deleteTaskById(id);
            Alert.alert("Silindi", "İptal edilen denetim silindi.");
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/tasks" as any);
            }
          } catch (error: any) {
            Alert.alert("Silinemedi", error?.message || "Denetim silinemedi.");
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  function getStartComplianceResult(mode: TaskWorkflowKind) {
    if (mode === "detection") {
      return "Re'sen ürün tespiti bekliyor";
    }

    if (mode === "classification") {
      return "Sınıflandırma başladı";
    }

    return task?.compliance_result || "Başvurulu denetim başladı";
  }

  async function startInspection(mode: TaskWorkflowKind) {
    if (!canInspectTask) {
      Alert.alert("Yetki yok", "Denetim yalnızca görevin atandığı denetçi tarafından başlatılır.");
      return;
    }

    const missing = validateTaskBeforeStart(task);

    if (missing.length) {
      Alert.alert("Denetim başlatılamaz", `Önce şu eksikleri tamamlayın:\n\n${missing.join("\n")}`);
      return;
    }

    setFieldMode(mode);
    setManualFields(buildManualFields(task, mode));

    try {
      const payload = {
        workflow_status: taskStatuses.started,
        status: taskStatuses.started,
        compliance_result: getStartComplianceResult(mode),
      };
      const result = await updateTaskOnlineOrQueue(id, payload, "Denetim başlatma");
      const nextTask = result.queued ? { ...task, ...payload } : result.data;

      setTask(nextTask);
      setFieldMode(mode);
      setManualFields(buildManualFields(nextTask, mode));

      if (result.queued) {
        Alert.alert("Sıraya alındı", "Denetim başlatma işlemi internet geldiğinde sisteme aktarılacak.");
      }
    } catch (error: any) {
      Alert.alert("Denetim başlatılamadı", error?.message || "Denetim başlatılamadı.");
    }
  }

  function openQrScan() {
    if (!canInspectTask) {
      Alert.alert("Yetki yok", "QR ile bilgi alma yalnızca görevin atandığı denetçide açıktır.");
      return;
    }

    router.push({
      pathname: "/qr-scan",
      params: {
        task_id: String(Array.isArray(id) ? id[0] : id || ""),
        workflow: fieldMode,
      },
    } as any);
  }

  function takeEvidencePhoto() {
    if (!canInspectTask) {
      Alert.alert("Yetki yok", "Fotoğraf yalnızca görevin atandığı denetçi tarafından eklenir.");
      return;
    }

    router.push(`/task/${String(Array.isArray(id) ? id[0] : id)}/camera` as any);
  }

  function updateManualField(key: string, value: string) {
    const nextValue = fixMojibake(value);

    setManualFields((current) => ({
      ...current,
      [key]: nextValue,
      ...(key === "detected_crop" && !getProductVarietyOptions(nextValue).includes(current.crop_variety)
        ? { crop_variety: "" }
        : {}),
    }));
  }

  function selectCropMatch(value: "same" | "different") {
    setCropMatches(value);

    if (value === "same") {
      setFieldMode("inspection");
      setManualFields(buildManualFields(task, "inspection"));
    }
  }

  function openPolygonEditor() {
    router.push(`/task/${String(Array.isArray(id) ? id[0] : id)}/polygon` as any);
  }

  function openManualWorkflow(mode: Exclude<TaskWorkflowKind, "inspection">) {
    if (!inspectionEditable) {
      Alert.alert("İşlem kapalı", "Saha bilgisi yalnızca devam eden görevde güncellenebilir.");
      return;
    }

    setFieldMode(mode);
    setManualFields(buildManualFields(task, mode));
  }

  function openResenRegistration() {
    if (!inspectionEditable) {
      Alert.alert("İşlem kapalı", "Re'sen kayıt yalnızca devam eden görevde açılabilir.");
      return;
    }

    setCropMatches("different");
    setFieldMode("detection");
    setManualFields(buildManualFields(task, "detection"));
  }

  async function saveAndFinishInspection() {
    if (!canInspectTask) {
      Alert.alert("Yetki yok", "Kaydetme işlemi yalnızca görevin atandığı denetçi tarafından yapılır.");
      return;
    }

    if (saveMissingItems.length) {
      Alert.alert("Kaydedilemedi", `Önce şu eksikleri tamamlayın:\n\n${saveMissingItems.join("\n")}`);
      return;
    }

    let payload: Record<string, unknown> = {};
    let successMessage = "Saha denetimi kaydedildi. Şimdi rapor oluşturabilirsiniz.";

    if (fieldMode === "inspection") {
      if (!cropMatches) {
        Alert.alert("Seçim gerekli", "Ürün doğrulama sonucunu seçin.");
        return;
      }

      if (cropMatches === "different") {
        Alert.alert("Re'sen kayıt gerekli", "Farklı ürün için önce Re'sen Kayıt formunu açıp saha bilgilerini tamamlayın.");
        return;
      }

      payload = {
        detected_crop: task.detected_crop,
        registered_crop: task.detected_crop,
        compliance_result: "KOBÜKS ürünü doğrulandı",
      };
      successMessage = "KOBÜKS kaydı doğrulandı. Şimdi rapor oluşturabilirsiniz.";
    } else {
      const classification = getClassificationResult(manualFields);
      const manualDescription = mergeManualDescription(task?.description, fieldMode, manualFields);
      const nextDescription =
        fieldMode === "classification"
          ? [
              manualDescription,
              `Sınıflandırma Puanı: ${classification.score}`,
              `Sınıflandırma Sonucu: ${classification.className}`,
            ]
              .filter(Boolean)
              .join("\n")
          : manualDescription;
      const nextCrop = fieldMode === "detection" ? manualFields.detected_crop?.trim() || task?.detected_crop : task?.detected_crop;

      payload = {
        description: nextDescription,
        detected_crop: nextCrop,
        greenhouse_area: manualFields.planting_area?.trim() || task?.greenhouse_area,
        compliance_result:
          fieldMode === "classification"
            ? `Sınıflandırma: ${classification.className} (${classification.score} puan)`
            : `Re'sen ürün tespiti: ${nextCrop || "Güncellendi"}`,
      };
      successMessage =
        fieldMode === "classification"
          ? "Sınıflandırma kaydedildi. Şimdi rapor oluşturabilirsiniz."
          : "Re'sen tespit kaydedildi. Şimdi rapor oluşturabilirsiniz.";
    }

    const missing = validateTaskBeforeCompletion({ ...task, ...payload }, evidence);

    if (missing.length) {
      Alert.alert("Kaydedilemedi", `Önce şu eksikleri tamamlayın:\n\n${missing.join("\n")}`);
      return;
    }

    payload.workflow_status = taskStatuses.completed;
    payload.status = taskStatuses.completed;

    setSaving(true);

    try {
      const result = await updateTaskOnlineOrQueue(id, payload, "Denetim kaydı");
      const nextTask = result.queued ? { ...task, ...payload } : result.data;

      setTask(nextTask);
      const nextWorkflowKind = getTaskWorkflowKind(nextTask);
      setFieldMode(nextWorkflowKind);
      setManualFields(buildManualFields(nextTask, nextWorkflowKind));

      Alert.alert(
        result.queued ? "Sıraya alındı" : "Kaydedildi",
        result.queued ? "Denetim kaydı internet geldiğinde sisteme aktarılacak." : successMessage,
      );
    } catch (error: any) {
      Alert.alert("Kaydedilemedi", error?.message || "Denetim kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function syncTaskToKobuks() {
    if (!canInspectTask) {
      Alert.alert("Yetki yok", "KOBÜKS aktarımı yalnızca görevin atandığı denetçide açıktır.");
      return;
    }

    const missing = validateTaskBeforeKobuksSync(task, evidence);

    if (missing.length) {
      Alert.alert("KOBÜKS'e aktarılamaz", `Önce şu eksikleri tamamlayın:\n\n${missing.join("\n")}`);
      return;
    }

    setClosingAction("kobuks");

    try {
      const result = await updateStatus(taskStatuses.kobuksSynced);
      Alert.alert(
        result.queued ? "Sıraya alındı" : "Aktarıldı",
        result.queued
          ? "KOBÜKS aktarımı internet geldiğinde sisteme aktarılacak."
          : "Saha kaydı KOBÜKS'e aktarıldı. İş akışı tamamlandı.",
      );
    } catch (error: any) {
      Alert.alert("Aktarım başarısız", error?.message || "KOBÜKS aktarımı tamamlanamadı.");
    } finally {
      setClosingAction("");
    }
  }

  function ensureReportReady(actionTitle: string) {
    const missing = validateTaskBeforeReport(task, evidence);

    if (missing.length) {
      Alert.alert(actionTitle, `Rapor için şu eksikler tamamlanmalı:\n\n${missing.join("\n")}`);
      return false;
    }

    return true;
  }

  async function createReport() {
    if (!canInspectTask) {
      Alert.alert("Yetki yok", "Rapor işlemi yalnızca görevin atandığı denetçide açıktır.");
      return;
    }

    if (!ensureReportReady("Rapor oluşturulamaz")) {
      return;
    }

    setClosingAction("report");

    try {
      const { saved } = await exportTaskPdf(task, { share: false });
      await updateStatus(taskStatuses.reportCreated);

      Alert.alert(
        "Rapor oluşturuldu",
        saved
          ? "Ek-8 raporu raporlar ekranında en üstte görünecek. Şimdi PDF/Excel alabilir, ardından KOBÜKS'e aktarabilirsiniz."
          : "Ek-8 PDF hazırlandı. Şimdi PDF/Excel alabilir, ardından KOBÜKS'e aktarabilirsiniz.",
      );
    } catch (error: any) {
      Alert.alert("Rapor oluşturulamadı", error?.message || "Ek-8 raporu oluşturulamadı.");
    } finally {
      setClosingAction("");
    }
  }

  async function shareReportPdf() {
    if (!canDownloadReport) {
      Alert.alert("Rapor hazır değil", "PDF/Excel almadan önce raporu oluşturun.");
      return;
    }

    const taskId = String(Array.isArray(id) ? id[0] : id || "");

    setClosingAction("pdf");

    try {
      const report = await getLatestEk8ReportForTask(taskId);
      let sharedExistingReport = false;

      if (report) {
        try {
          sharedExistingReport = await shareEk8ReportPdf(report);
        } catch {
          sharedExistingReport = false;
        }
      }

      if (!sharedExistingReport) {
        await exportTaskPdf(task);
      }
      await updateStatus(taskStatuses.reportDownloaded);
    } catch (error: any) {
      Alert.alert("PDF alınamadı", error?.message || "PDF çıktısı alınamadı.");
    } finally {
      setClosingAction("");
    }
  }

  async function shareReportExcel() {
    if (!canDownloadReport) {
      Alert.alert("Rapor hazır değil", "PDF/Excel almadan önce raporu oluşturun.");
      return;
    }

    const taskId = String(task?.id || id || Date.now());

    setClosingAction("excel");

    try {
      const csv = buildTaskCsv(task);
      const uri = `${FileSystem.cacheDirectory}kobuds-denetim-${task?.unit_no || taskId}.csv`;

      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, {
        mimeType: "text/csv",
        dialogTitle: "KOBÜDS Excel çıktısı",
      });
      await updateStatus(taskStatuses.reportDownloaded);
    } catch (error: any) {
      Alert.alert("Excel alınamadı", error?.message || "Excel çıktısı oluşturulamadı.");
    } finally {
      setClosingAction("");
    }
  }

  function startNavigation() {
    const target = getTaskNavigationTarget(task);

    if (!target) {
      Alert.alert("Koordinat yok", "Bu görev için CBS koordinatı bulunamadı.");
      return;
    }

    Linking.openURL(`google.navigation:q=${target.latitude},${target.longitude}`);
  }

  function callProducer() {
    if (!task?.phone) {
      Alert.alert("Telefon yok", "Üretici telefon bilgisi bulunamadı.");
      return;
    }

    Linking.openURL(`tel:${task.phone}`);
  }

  function goBackToPreviousScreen() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/tasks" as any);
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <View style={styles.center}>
          <ActivityIndicator color="#22c55e" />
          <Text style={styles.loadingText}>Denetim yükleniyor...</Text>
        </View>
        <BottomTabMenu />
      </View>
    );
  }

  if (!task) {
    return (
      <View style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.loadingText}>Görev bulunamadı.</Text>
        </View>
        <BottomTabMenu />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        {!management ? (
          <View
            style={[
              styles.workflowTypeBanner,
              { borderColor: workflowMeta.color, backgroundColor: `${workflowMeta.color}22` },
            ]}
          >
            <View style={styles.workflowTypeIcon}>
              <MaterialCommunityIcons name={workflowMeta.icon} color={workflowMeta.color} size={22} />
            </View>
            <View style={styles.workflowTypeCopy}>
              <Text style={styles.workflowTypeCaption}>Görev türü</Text>
              <Text style={[styles.workflowTypeText, { color: workflowMeta.color }]}>
                {workflowMeta.title}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.header}>
          <Pressable onPress={goBackToPreviousScreen} style={styles.backButton}>
            <MaterialCommunityIcons name="chevron-left" color="white" size={24} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.kicker}>{workflowLabel}</Text>
            <Text style={styles.title}>{fixMojibake(task.detected_crop || "Denetim")}</Text>
            <Text style={styles.subtitle}>{fixMojibake(task.unit_no || "-")} - {fixMojibake(task.producer_name || "-")}</Text>
          </View>
          <Text style={styles.statusPill}>{fixMojibake(currentStatus || "Bekliyor")}</Text>
        </View>

      <KobuksRecordSummary task={task} />

      <View style={styles.actionRow}>
        <Pressable onPress={callProducer} style={styles.callButton}>
          <MaterialCommunityIcons name="phone-outline" color="white" size={18} />
          <Text style={styles.actionText}>Üreticiyi Ara</Text>
        </Pressable>
        <Pressable onPress={startNavigation} style={styles.navButton}>
          <MaterialCommunityIcons name="navigation-variant-outline" color="white" size={18} />
          <Text style={styles.actionText}>Navigasyon</Text>
        </Pressable>
      </View>

      {!management && !canInspectTask ? (
        <View style={styles.roleNotice}>
          <MaterialCommunityIcons name="lock-outline" color="#fed7aa" size={20} />
          <Text style={styles.roleNoticeText}>Bu görev size atanmamış.</Text>
        </View>
      ) : null}

      {management ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>{reportReady || assignedInspector ? "Görev Özeti" : "Görevlendirme"}</Text>
              <Text style={styles.sectionMeta}>
                {reportReady
                  ? "Denetim tamamlandı; yeni atama kapalı. Rapor işlemleri aşağıdaki rapor alanından yapılır."
                  : assignedInspector
                    ? "Görev denetçiye atanmış. Admin bu ekranda süreci izler; saha işlemleri denetçi ekranında yapılır."
                  : "Denetimi sahada yürütecek kullanıcıyı seçin."}
              </Text>
            </View>
            <MaterialCommunityIcons name={reportReady ? "file-document-check-outline" : "account-check-outline"} color="#38bdf8" size={22} />
          </View>
          <View style={styles.assignmentSummary}>
            <View style={styles.assignmentSummaryItem}>
              <Text style={styles.assignmentLabel}>Mevcut atama</Text>
              <Text style={styles.assignmentValue} numberOfLines={1}>
                {task.assigned_name || "Henüz atanmadı"}
              </Text>
            </View>
            <View style={styles.assignmentSummaryItem}>
              <Text style={styles.assignmentLabel}>Durum</Text>
              <Text style={styles.assignmentValue} numberOfLines={1}>
                {currentStatus || "Bekliyor"}
              </Text>
            </View>
          </View>
          {canAssignTask && assignmentMissingItems.length ? (
            <View style={styles.requirementsNotice}>
              <Text style={styles.requirementsTitle}>Atama öncesi eksikler</Text>
              {assignmentMissingItems.map((item) => (
                <Text key={item} style={styles.requirementsText}>
                  {item}
                </Text>
              ))}
            </View>
          ) : null}
          {canAssignTask ? (
            <>
              {inspectors.length ? (
                <View style={styles.pickerWrap}>
                  <Picker selectedValue={selectedInspector} onValueChange={setSelectedInspector} style={styles.picker}>
                    <Picker.Item label="Denetçi seçin" value="" />
                    {inspectors.map((item) => {
                      const subtitle = getProfileSubtitle(item);
                      const label = `${getProfileName(item)} - ${getProfileRole(item)}${subtitle ? ` - ${subtitle}` : ""}`;

                      return <Picker.Item key={String(item.id)} label={label} value={String(item.id)} />;
                    })}
                  </Picker>
                </View>
              ) : (
                <View style={styles.emptyAssignableList}>
                  <Text style={styles.emptyAssignableText}>Atanabilir aktif kullanıcı bulunamadı.</Text>
                </View>
              )}
              {selectedInspectorProfile ? (
                <Text style={styles.assignmentHint}>
                  Seçilen kullanıcı: {getProfileName(selectedInspectorProfile)} ({getProfileRole(selectedInspectorProfile)})
                </Text>
              ) : null}
              <Pressable
                onPress={assignInspector}
                style={[styles.blueButton, (!selectedInspector || assigning || assignmentMissingItems.length > 0) && styles.dimmedButton]}
                disabled={!selectedInspector || assigning || assignmentMissingItems.length > 0}
              >
                <Text style={styles.buttonText}>{assigning ? "Atanıyor..." : "Görevi Ata"}</Text>
              </Pressable>
            </>
          ) : null}
          {canCancelTask ? (
            <Pressable onPress={cancelInspection} style={[styles.cancelButton, cancelling && styles.dimmedButton]} disabled={cancelling}>
              <MaterialCommunityIcons name="close-octagon-outline" color="white" size={18} />
              <Text style={styles.buttonText}>{cancelling ? "İptal ediliyor..." : "Görevi İptal Et"}</Text>
            </Pressable>
          ) : null}
          {inspectionCancelled ? (
            <Pressable onPress={deleteInspection} style={[styles.deleteButton, deleting && styles.dimmedButton]} disabled={deleting}>
              <MaterialCommunityIcons name="trash-can-outline" color="white" size={18} />
              <Text style={styles.buttonText}>{deleting ? "Siliniyor..." : "Denetimi Sil"}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {showInspectionFlow ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Saha İşlemleri</Text>
          {!inspectionStarted && !management ? (
            <View style={styles.startModeGrid}>
              <Pressable
                onPress={() => startInspection(workflowMeta.key)}
                style={[styles.startModeButton, { backgroundColor: workflowMeta.color }]}
              >
                <MaterialCommunityIcons name={workflowMeta.icon} color="white" size={19} />
                <Text style={styles.buttonText}>{workflowMeta.title}</Text>
              </Pressable>
            </View>
          ) : null}

          {!reportReady && !inspectionCancelled ? (
            <Pressable onPress={openQrScan} style={styles.qrButton}>
              <MaterialCommunityIcons name="qrcode-scan" color="#38bdf8" size={18} />
              <Text style={styles.qrButtonText}>QR ile Bilgi Al</Text>
            </Pressable>
          ) : null}

          {inspectionEditable ? (
            <Pressable onPress={takeEvidencePhoto} style={styles.cyanButton}>
              <MaterialCommunityIcons name="camera-outline" color="white" size={18} />
              <Text style={styles.buttonText}>Fotoğraf Çek</Text>
            </Pressable>
          ) : null}

          {inspectionCancelled ? (
            <View style={styles.cancelledNotice}>
              <MaterialCommunityIcons name="close-octagon-outline" color="#fecaca" size={20} />
              <Text style={styles.cancelledNoticeText}>Bu denetim admin tarafından iptal edildi.</Text>
            </View>
          ) : null}

        </View>
      ) : null}

      {inspectionEditable && fieldMode === "inspection" ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ürün Doğrulama</Text>
          <View style={styles.segmentRow}>
            <Pressable
              onPress={() => selectCropMatch("same")}
              style={[styles.segmentButton, cropMatches === "same" && styles.segmentSameActive]}
            >
              <Text style={[styles.segmentText, cropMatches === "same" && styles.segmentTextActive]}>KOBÜKS ile aynı</Text>
            </Pressable>
            <Pressable
              onPress={() => selectCropMatch("different")}
              style={[styles.segmentButton, cropMatches === "different" && styles.segmentDifferentActive]}
            >
              <Text style={[styles.segmentText, cropMatches === "different" && styles.segmentTextActive]}>Farklı ürün</Text>
            </Pressable>
          </View>

          {cropMatches === "same" ? (
            <>
              <Pressable onPress={() => openManualWorkflow("classification")} style={[styles.branchButton, styles.classificationBranchButton]}>
                <MaterialCommunityIcons name="greenhouse" color="white" size={18} />
                <Text style={styles.branchButtonText}>Sınıflandırma Girişi</Text>
              </Pressable>
            </>
          ) : null}

          {cropMatches === "different" ? (
            <View style={styles.branchButtonRow}>
              <Pressable onPress={openResenRegistration} style={[styles.branchButton, styles.detectionBranchButton]}>
                <MaterialCommunityIcons name="sprout-outline" color="white" size={18} />
                <Text style={styles.branchButtonText}>{"Re'sen Kayıt"}</Text>
              </Pressable>
              <Pressable onPress={() => openManualWorkflow("classification")} style={[styles.branchButton, styles.classificationBranchButton]}>
                <MaterialCommunityIcons name="greenhouse" color="white" size={18} />
                <Text style={styles.branchButtonText}>Sınıflandırma</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {inspectionEditable && (fieldMode === "detection" || fieldMode === "classification") ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{fieldMode === "classification" ? "Sera Sınıfı" : "Re'sen Kayıt"}</Text>
          <Pressable onPress={openPolygonEditor} style={styles.cyanButton}>
            <MaterialCommunityIcons name="shape-polygon-plus" color="white" size={18} />
            <Text style={styles.buttonText}>CBS Poligonu Çiz</Text>
          </Pressable>
          <View style={styles.manualGrid}>
            {manualFieldConfig.map((field) => (
              <ManualField
                key={field.key}
                inputType={field.inputType}
                label={field.label}
                options={field.options}
                value={manualFields[field.key] || ""}
                onChangeText={(value) => updateManualField(field.key, value)}
              />
            ))}
          </View>
          {fieldMode === "classification" ? (
            <View style={styles.scoreCard}>
              <View>
                <Text style={styles.scoreLabel}>Toplam Puan</Text>
                <Text style={styles.scoreValue}>{classificationResult.score}</Text>
              </View>
              <View style={styles.scoreClassBadge}>
                <Text style={styles.scoreClassText}>{classificationResult.className}</Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {inspectionStarted ? (
        <View style={styles.evidenceSection}>
          <View style={styles.evidenceHeader}>
            <Text style={styles.evidenceTitle}>Saha Kanıtları</Text>
            <Text style={styles.evidenceCount}>{evidence.length} fotoğraf</Text>
          </View>
          {evidence.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.evidenceGallery}>
              {evidence.map((item) => (
                <Pressable key={item.id} onPress={() => setPreviewEvidence(item)} style={styles.evidenceThumbButton}>
                  <Image source={{ uri: item.image_url }} style={styles.evidenceThumb} />
                  <View style={styles.evidenceThumbBadge}>
                    <MaterialCommunityIcons name="image-check-outline" color="white" size={13} />
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.emptyEvidence}>
              <Text style={styles.emptyEvidenceText}>Henüz kanıt fotoğrafı yok.</Text>
            </View>
          )}
        </View>
      ) : null}

      {(inspectionEditable || reportReady) && canInspectTask ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <Text style={styles.sectionTitle}>Rapor ve Kapanış</Text>
            </View>
            <MaterialCommunityIcons name="file-document-outline" color="#38bdf8" size={22} />
          </View>
          {saveMissingItems.length && inspectionEditable ? (
            <View style={styles.requirementsNotice}>
              <Text style={styles.requirementsTitle}>Kaydetmeden önce tamamlanmalı</Text>
              {saveMissingItems.map((item) => (
                <Text key={item} style={styles.requirementsText}>
                  {item}
                </Text>
              ))}
            </View>
          ) : null}

          {canSaveInspection ? (
            <Pressable onPress={saveAndFinishInspection} style={[styles.orangeButton, saving && styles.dimmedButton]} disabled={saving}>
              <MaterialCommunityIcons name="content-save-check-outline" color="white" size={18} />
              <Text style={styles.buttonText}>{saving ? "Kaydediliyor..." : "Kaydet"}</Text>
            </Pressable>
          ) : null}

          {canCreateReport ? (
            <Pressable
              onPress={createReport}
              style={[styles.reportPrimaryButton, closingAction === "report" && styles.dimmedButton]}
              disabled={closingAction === "report"}
            >
              <MaterialCommunityIcons name="file-document-plus-outline" color="white" size={18} />
              <Text style={styles.buttonText}>{closingAction === "report" ? "Oluşturuluyor..." : "Rapor Oluştur"}</Text>
            </Pressable>
          ) : null}

          {canDownloadReport ? (
            <View style={styles.reportActionRow}>
              <Pressable
                onPress={shareReportPdf}
                style={[styles.reportPrimaryButton, closingAction === "pdf" && styles.dimmedButton]}
                disabled={closingAction === "pdf"}
              >
                <MaterialCommunityIcons name="file-pdf-box" color="white" size={18} />
                <Text style={styles.buttonText}>{closingAction === "pdf" ? "Hazırlanıyor..." : "PDF Al"}</Text>
              </Pressable>
              <Pressable
                onPress={shareReportExcel}
                style={[styles.excelButton, closingAction === "excel" && styles.dimmedButton]}
                disabled={closingAction === "excel"}
              >
                <MaterialCommunityIcons name="microsoft-excel" color="white" size={18} />
                <Text style={styles.buttonText}>{closingAction === "excel" ? "Hazırlanıyor..." : "Excel Al"}</Text>
              </Pressable>
            </View>
          ) : null}

          {canSyncKobuks ? (
            <Pressable
              onPress={syncTaskToKobuks}
              style={[styles.primaryButton, closingAction === "kobuks" && styles.dimmedButton]}
              disabled={closingAction === "kobuks"}
            >
              <MaterialCommunityIcons name="database-export-outline" color="white" size={18} />
              <Text style={styles.buttonText}>{closingAction === "kobuks" ? "Aktarılıyor..." : "KOBÜKS'e Aktar"}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      </ScrollView>
      <Modal visible={Boolean(previewEvidence)} transparent animationType="fade" onRequestClose={() => setPreviewEvidence(null)}>
        <View style={styles.photoPreviewBackdrop}>
          <Pressable onPress={() => setPreviewEvidence(null)} style={styles.photoPreviewClose}>
            <MaterialCommunityIcons name="close" color="white" size={22} />
          </Pressable>
          {previewEvidence ? (
            <>
              <Image source={{ uri: previewEvidence.image_url }} style={styles.photoPreviewImage} resizeMode="contain" />
              <Text style={styles.photoPreviewMeta}>
                GPS: {previewEvidence.latitude || "-"}, {previewEvidence.longitude || "-"}
              </Text>
            </>
          ) : null}
        </View>
      </Modal>
      <BottomTabMenu />
    </View>
  );
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function getReportDate(value: unknown) {
  const date = value ? new Date(String(value)) : new Date();

  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleDateString("tr-TR");
  }

  return date.toLocaleDateString("tr-TR");
}

function buildTaskCsv(task: any) {
  const headers = ["İl", "İlçe", "Mahalle", "Ürün", "Üretim yılı", "Ünite no", "Üretici", "Ada", "Parsel", "Durum", "Tarih"];
  const row = [
    task?.city || task?.province || task?.il || "",
    task?.district_name || task?.district || task?.ilce || "",
    task?.village || task?.neighborhood || task?.mahalle || "",
    task?.detected_crop || task?.crop_name || task?.crop || "",
    task?.production_year || task?.productionYear || "",
    task?.unit_no || "",
    task?.producer_name || "",
    task?.ada_no || "",
    task?.parcel_no || "",
    getTaskStatus(task),
    getReportDate(task?.updated_at || task?.created_at),
  ];

  return `\ufeff${[headers, row].map((items) => items.map(csvCell).join(";")).join("\n")}`;
}

function KobuksRecordSummary({ task }: { task: any }) {
  const records = [
    { label: "Üretici", value: task?.producer_name },
    { label: "TC/VKN", value: task?.tc_no },
    { label: "Ünite No", value: task?.unit_no },
    { label: "Kayıtlı Ürün", value: task?.detected_crop },
    { label: "Alan", value: task?.greenhouse_area ? `${task.greenhouse_area} m²` : "" },
    { label: "Ada / Parsel", value: `${task?.ada_no || "-"} / ${task?.parcel_no || "-"}` },
    { label: "İl / İlçe", value: [task?.city, task?.district_name].filter(Boolean).join(" / ") },
    { label: "Mahalle", value: task?.village },
  ];

  return (
    <View style={styles.kobuksSummary}>
      <View style={styles.kobuksSummaryHeader}>
        <MaterialCommunityIcons name="database-check-outline" color="#22c55e" size={20} />
        <Text style={styles.kobuksSummaryTitle}>KOBÜKS Kaydı</Text>
      </View>
      <View style={styles.kobuksSummaryGrid}>
        {records.map((item) => (
          <View key={item.label} style={styles.kobuksSummaryItem}>
            <Text style={styles.kobuksSummaryLabel}>{item.label}</Text>
            <Text style={styles.kobuksSummaryValue} numberOfLines={1}>
              {fixMojibake(item.value || "-")}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function parseCalendarDate(value: string) {
  const text = value.trim();
  const localMatch = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  const isoMatch = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  const parts = localMatch
    ? { day: Number(localMatch[1]), month: Number(localMatch[2]), year: Number(localMatch[3]) }
    : isoMatch
      ? { day: Number(isoMatch[3]), month: Number(isoMatch[2]), year: Number(isoMatch[1]) }
      : null;

  if (!parts) {
    return null;
  }

  const date = new Date(parts.year, parts.month - 1, parts.day);

  if (date.getFullYear() !== parts.year || date.getMonth() !== parts.month - 1 || date.getDate() !== parts.day) {
    return null;
  }

  return date;
}

function formatCalendarDate(date: Date) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function getCalendarDays(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const mondayFirstOffset = (firstDay.getDay() + 6) % 7;
  const days: (Date | null)[] = Array.from({ length: mondayFirstOffset }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(new Date(year, month, day));
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

function isSameCalendarDay(first: Date | null, second: Date | null) {
  return Boolean(
    first &&
      second &&
      first.getFullYear() === second.getFullYear() &&
      first.getMonth() === second.getMonth() &&
      first.getDate() === second.getDate(),
  );
}

function CalendarDateField({
  label,
  onChangeText,
  value,
}: {
  label: string;
  onChangeText: (value: string) => void;
  value: string;
}) {
  const parsedValue = parseCalendarDate(value);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const base = parsedValue || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const days = useMemo(() => getCalendarDays(visibleMonth), [visibleMonth]);
  const monthTitle = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(visibleMonth);

  function moveMonth(amount: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  }

  function selectDate(date: Date) {
    onChangeText(formatCalendarDate(date));
    setOpen(false);
  }

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.dateInputButton}>
        <Text style={[styles.dateInputText, !value && styles.dateInputPlaceholder]} numberOfLines={1}>
          {value || `${label} seçin`}
        </Text>
        <MaterialCommunityIcons name="calendar-month-outline" color="#38bdf8" size={20} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.calendarBackdrop}>
          <View style={styles.calendarPanel}>
            <View style={styles.calendarHeader}>
              <Pressable onPress={() => moveMonth(-1)} style={styles.calendarNavButton}>
                <MaterialCommunityIcons name="chevron-left" color="white" size={22} />
              </Pressable>
              <Text style={styles.calendarTitle}>{monthTitle}</Text>
              <Pressable onPress={() => moveMonth(1)} style={styles.calendarNavButton}>
                <MaterialCommunityIcons name="chevron-right" color="white" size={22} />
              </Pressable>
            </View>
            <View style={styles.weekdayRow}>
              {calendarWeekDays.map((day) => (
                <Text key={day} style={styles.weekdayText}>
                  {day}
                </Text>
              ))}
            </View>
            <View style={styles.calendarGrid}>
              {days.map((date, index) => {
                const selected = isSameCalendarDay(date, parsedValue);

                return (
                  <Pressable
                    key={date ? date.toISOString() : `empty-${index}`}
                    disabled={!date}
                    onPress={() => date && selectDate(date)}
                    style={[styles.calendarDay, selected && styles.calendarDaySelected, !date && styles.calendarDayEmpty]}
                  >
                    <Text style={[styles.calendarDayText, selected && styles.calendarDayTextSelected]}>
                      {date ? date.getDate() : ""}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.calendarActions}>
              <Pressable
                onPress={() => {
                  onChangeText("");
                  setOpen(false);
                }}
                style={styles.calendarSecondaryButton}
              >
                <Text style={styles.calendarSecondaryText}>Temizle</Text>
              </Pressable>
              <Pressable onPress={() => setOpen(false)} style={styles.calendarPrimaryButton}>
                <Text style={styles.calendarPrimaryText}>Kapat</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function ManualField({
  inputType,
  label,
  onChangeText,
  options,
  value,
}: {
  inputType?: "date";
  label: string;
  onChangeText: (value: string) => void;
  options?: string[];
  value: string;
}) {
  return (
    <View style={styles.manualField}>
      <Text style={styles.manualFieldLabel}>{label}</Text>
      {inputType === "date" ? (
        <CalendarDateField label={label} value={value} onChangeText={onChangeText} />
      ) : options?.length ? (
        <View style={styles.manualPickerWrap}>
          <Picker selectedValue={value} onValueChange={onChangeText} style={styles.picker}>
            <Picker.Item label={`${label} seçin`} value="" />
            {options.map((option) => (
              <Picker.Item key={option} label={option} value={option} />
            ))}
          </Picker>
        </View>
      ) : (
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={label}
          placeholderTextColor="#64748b"
          style={styles.manualInput}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#020617" },
  screen: { flex: 1, backgroundColor: "#020617" },
  content: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 104, gap: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#020617" },
  loadingText: { color: "#cbd5e1", marginTop: 10, fontWeight: "700" },
  workflowTypeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  workflowTypeIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: "#020617",
    alignItems: "center",
    justifyContent: "center",
  },
  workflowTypeCopy: { flex: 1 },
  workflowTypeCaption: { color: "#cbd5e1", fontSize: 11, fontWeight: "800" },
  workflowTypeText: { fontSize: 16, fontWeight: "900", marginTop: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1e293b",
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1 },
  kicker: { color: "#38bdf8", fontSize: 12, fontWeight: "800" },
  title: { color: "white", fontSize: 30, fontWeight: "800", marginTop: 2 },
  subtitle: { color: "#94a3b8", marginTop: 4 },
  statusPill: {
    maxWidth: 110,
    borderRadius: 8,
    backgroundColor: "#f59e0b",
    color: "white",
    fontWeight: "800",
    paddingHorizontal: 10,
    paddingVertical: 8,
    overflow: "hidden",
  },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  infoCard: {
    width: "48%",
    minHeight: 92,
    backgroundColor: "#0f172a",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 14,
  },
  infoLabel: { color: "#38bdf8", fontWeight: "800", fontSize: 12 },
  infoValue: { color: "white", fontWeight: "800", marginTop: 8 },
  infoHelper: { color: "#94a3b8", marginTop: 4 },
  actionRow: { flexDirection: "row", gap: 8 },
  callButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "#0ea5e9",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  navButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  actionText: { color: "white", fontWeight: "800" },
  roleNotice: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#92400e",
    backgroundColor: "#422006",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  roleNoticeText: {
    color: "#ffedd5",
    fontWeight: "800",
  },
  section: {
    backgroundColor: "#0f172a",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 16,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  sectionHeaderText: {
    flex: 1,
  },
  sectionTitle: { color: "white", fontSize: 18, fontWeight: "800" },
  sectionMeta: { color: "#94a3b8", marginTop: 4, lineHeight: 18 },
  assignmentSummary: {
    flexDirection: "row",
    gap: 8,
  },
  assignmentSummaryItem: {
    flex: 1,
    minHeight: 66,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
    backgroundColor: "#111827",
    padding: 10,
    justifyContent: "center",
  },
  assignmentLabel: { color: "#38bdf8", fontSize: 11, fontWeight: "800" },
  assignmentValue: { color: "white", marginTop: 5, fontWeight: "800" },
  assignmentHint: { color: "#cbd5e1", fontWeight: "700", lineHeight: 18 },
  emptyAssignableList: {
    minHeight: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  emptyAssignableText: {
    color: "#cbd5e1",
    fontWeight: "700",
    textAlign: "center",
  },
  requirementsNotice: {
    backgroundColor: "#422006",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f59e0b",
    padding: 12,
    gap: 5,
  },
  requirementsTitle: { color: "#fed7aa", fontWeight: "800" },
  requirementsText: { color: "#ffedd5", fontWeight: "700", lineHeight: 18 },
  pickerWrap: { backgroundColor: "#1e293b", borderRadius: 8, overflow: "hidden" },
  picker: { color: "white" },
  blueButton: { minHeight: 48, borderRadius: 8, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center" },
  primaryButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  cyanButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "#0ea5e9",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  greenButton: { minHeight: 48, borderRadius: 8, backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center" },
  orangeButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "#f59e0b",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  cancelButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "#991b1b",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  deleteButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "#7f1d1d",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  reportActionRow: {
    flexDirection: "row",
    gap: 8,
  },
  reportPrimaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
  },
  excelButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "#15803d",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
  },
  dimmedButton: { opacity: 0.75 },
  buttonText: { color: "white", fontWeight: "800", textAlign: "center" },
  startModeGrid: {
    gap: 8,
  },
  startModeButton: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
  },
  qrButton: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
  },
  qrButtonText: {
    color: "#38bdf8",
    fontWeight: "800",
  },
  segmentRow: { flexDirection: "row", gap: 8 },
  segmentButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
    paddingHorizontal: 8,
  },
  segmentSameActive: { backgroundColor: "#14532d", borderColor: "#22c55e" },
  segmentDifferentActive: { backgroundColor: "#075985", borderColor: "#38bdf8" },
  segmentText: { color: "#94a3b8", fontWeight: "800", textAlign: "center" },
  segmentTextActive: { color: "white" },
  branchButtonRow: {
    flexDirection: "row",
    gap: 8,
  },
  branchButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 8,
  },
  detectionBranchButton: {
    backgroundColor: "#0ea5e9",
    borderColor: "#38bdf8",
  },
  classificationBranchButton: {
    backgroundColor: "#f59e0b",
    borderColor: "#fbbf24",
  },
  branchButtonText: {
    color: "white",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  kobuksSummary: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#166534",
    backgroundColor: "#052e16",
    padding: 12,
    gap: 10,
  },
  kobuksSummaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  kobuksSummaryTitle: {
    color: "#dcfce7",
    fontWeight: "800",
  },
  kobuksSummaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  kobuksSummaryItem: {
    width: "48%",
    minHeight: 54,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#166534",
    backgroundColor: "#064e3b",
    padding: 9,
    justifyContent: "center",
  },
  kobuksSummaryLabel: {
    color: "#86efac",
    fontSize: 11,
    fontWeight: "800",
  },
  kobuksSummaryValue: {
    color: "white",
    marginTop: 4,
    fontWeight: "800",
  },
  manualGrid: {
    gap: 9,
  },
  manualField: {
    gap: 6,
  },
  manualFieldLabel: {
    color: "#38bdf8",
    fontSize: 12,
    fontWeight: "800",
  },
  manualPickerWrap: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1e293b",
    overflow: "hidden",
  },
  manualInput: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1e293b",
    color: "white",
    paddingHorizontal: 12,
  },
  dateInputButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1e293b",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  dateInputText: {
    flex: 1,
    color: "white",
    fontWeight: "800",
  },
  dateInputPlaceholder: {
    color: "#64748b",
  },
  calendarBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  calendarPanel: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 8,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    padding: 14,
    gap: 12,
  },
  calendarHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  calendarNavButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1e293b",
    alignItems: "center",
    justifyContent: "center",
  },
  calendarTitle: {
    flex: 1,
    color: "white",
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "capitalize",
  },
  weekdayRow: {
    flexDirection: "row",
  },
  weekdayText: {
    flex: 1,
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  calendarDay: {
    width: "14.2857%",
    aspectRatio: 1,
    borderRadius: 8,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1e293b",
    alignItems: "center",
    justifyContent: "center",
  },
  calendarDaySelected: {
    backgroundColor: "#16a34a",
    borderColor: "#22c55e",
  },
  calendarDayEmpty: {
    opacity: 0,
  },
  calendarDayText: {
    color: "#e2e8f0",
    fontWeight: "900",
  },
  calendarDayTextSelected: {
    color: "white",
  },
  calendarActions: {
    flexDirection: "row",
    gap: 8,
  },
  calendarSecondaryButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
  },
  calendarSecondaryText: {
    color: "#38bdf8",
    fontWeight: "900",
  },
  calendarPrimaryButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
  },
  calendarPrimaryText: {
    color: "white",
    fontWeight: "900",
  },
  scoreCard: {
    minHeight: 72,
    borderRadius: 8,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  scoreLabel: { color: "#334155", fontSize: 12, fontWeight: "800" },
  scoreValue: { color: "#14532d", fontSize: 28, fontWeight: "800", marginTop: 2 },
  scoreClassBadge: {
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#94a3b8",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreClassText: { color: "#020617", fontWeight: "900" },
  evidenceSection: {
    gap: 10,
  },
  evidenceHeader: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  evidenceTitle: { color: "white", fontSize: 20, fontWeight: "800" },
  evidenceCount: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "800",
  },
  evidenceGallery: {
    gap: 9,
    paddingRight: 4,
  },
  evidenceThumbButton: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#1e293b",
    overflow: "hidden",
  },
  evidenceThumb: {
    width: "100%",
    height: "100%",
  },
  evidenceThumbBadge: {
    position: "absolute",
    right: 5,
    bottom: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(22,163,74,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoPreviewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.94)",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    gap: 12,
  },
  photoPreviewClose: {
    position: "absolute",
    right: 18,
    top: 48,
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: "rgba(15,23,42,0.92)",
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  photoPreviewImage: {
    width: "100%",
    height: "78%",
    borderRadius: 8,
  },
  photoPreviewMeta: {
    color: "#cbd5e1",
    fontWeight: "800",
    textAlign: "center",
  },
  evidenceCard: { backgroundColor: "#0f172a", borderRadius: 8, padding: 12, gap: 10 },
  evidenceImage: { width: "100%", height: 220, borderRadius: 8 },
  evidenceMeta: { color: "#94a3b8" },
  emptyEvidence: { backgroundColor: "#0f172a", borderRadius: 8, padding: 16 },
  emptyEvidenceText: { color: "#94a3b8", fontWeight: "700" },
  cancelledNotice: {
    backgroundColor: "#450a0a",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#991b1b",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cancelledNoticeText: { flex: 1, color: "#fee2e2", fontWeight: "800", lineHeight: 18 },
});
