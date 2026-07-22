import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Callout, Marker, Polygon } from "react-native-maps";

import { RoleGate } from "../../components/RoleGate";
import {
  AKSU_SOLAK_QGIS_PROJECT,
  ANTALYA_REGION,
  CbsUnit,
  STATUS_LABEL,
  buildFallbackPolygon,
  getCenter,
  getCbsLookupHints,
  getQgisStatusLabel,
  isDefaultCbsFallbackPolygon,
  loadCbsUnits,
  startInspectionFromUnit,
} from "../../services/cbs";
import { canUseManagementScreens, getMyProfile } from "../../services/profile";
import { getTasks } from "../../services/tasks";
import { getLiveFieldLocations, type LiveFieldLocation } from "../../services/tracking";
import { fixMojibake } from "../../utils/text";
import {
  getTaskStatus,
  getTaskWorkflowKind,
  isTaskCancelled,
  isTaskCompleted,
  type TaskWorkflowKind,
} from "../../services/workflowGuard";

const CACHE_KEY = "tarbil:cbs-units:v4";
const MAX_RENDERED_UNITS = 150;

type UserMapLocation = {
  latitude: number;
  longitude: number;
};

type UnitWorkflowState = "done" | "partial" | "empty";
type UnitWorkflowInfo = {
  task: any | null;
  state: UnitWorkflowState;
};

const WORKFLOW_STATE_COLOR: Record<UnitWorkflowState, string> = {
  done: "#22c55e",
  partial: "#f59e0b",
  empty: "#ef4444",
};

const WORKFLOW_STATE_FILL: Record<UnitWorkflowState, string> = {
  done: "rgba(34,197,94,0.72)",
  partial: "rgba(245,158,11,0.72)",
  empty: "rgba(239,68,68,0.68)",
};

const WORKFLOW_STATE_LABEL: Record<UnitWorkflowState, string> = {
  done: "İşlem tamamlandı",
  partial: "İşlem yarıda",
  empty: "İşlem yapılmadı",
};

const WORKFLOW_KINDS: TaskWorkflowKind[] = ["inspection", "detection", "classification"];

const WORKFLOW_KIND_LABEL: Record<TaskWorkflowKind, string> = {
  inspection: "Başvurulu",
  detection: "Re'sen",
  classification: "Sınıflandırma",
};

const WORKFLOW_KIND_COLOR: Record<TaskWorkflowKind, string> = {
  inspection: "#16a34a",
  detection: "#0ea5e9",
  classification: "#f59e0b",
};

async function loadCachedUnits() {
  const cached = await AsyncStorage.getItem(CACHE_KEY);
  if (!cached) return null;

  const parsed = JSON.parse(cached);
  return Array.isArray(parsed) ? (parsed as CbsUnit[]) : null;
}

async function cacheUnits(units: CbsUnit[]) {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(units));
}

function getHeadingDegree(heading: Location.LocationHeadingObject | null) {
  if (!heading) {
    return null;
  }

  const value = heading.trueHeading >= 0 ? heading.trueHeading : heading.magHeading;
  return Number.isFinite(value) ? value : null;
}

function normalizeWorkflowKind(value: unknown): TaskWorkflowKind {
  const text = String(Array.isArray(value) ? value[0] : value || "").trim();

  if (text === "detection" || text === "classification") {
    return text;
  }

  return "inspection";
}

function hasMeaningfulUnitValue(value: unknown) {
  const text = String(value || "").trim();

  return Boolean(text && text !== "-" && text.toLocaleLowerCase("tr-TR") !== "null");
}

function taskMatchesUnit(task: any, unit: CbsUnit) {
  if (task?.greenhouse_unit_id && unit.greenhouseUnitId && String(task.greenhouse_unit_id) === String(unit.greenhouseUnitId)) return true;
  if (task?.cbs_unit_id && unit.cbsUnitId && String(task.cbs_unit_id) === String(unit.cbsUnitId)) return true;

  if (hasMeaningfulUnitValue(task?.unit_no) && hasMeaningfulUnitValue(unit.unitNo) && String(task.unit_no) === String(unit.unitNo)) {
    return true;
  }

  return (
    hasMeaningfulUnitValue(task?.ada_no) &&
    hasMeaningfulUnitValue(task?.parcel_no) &&
    hasMeaningfulUnitValue(unit.adaNo) &&
    hasMeaningfulUnitValue(unit.parcelNo) &&
    String(task.ada_no) === String(unit.adaNo) &&
    String(task.parcel_no) === String(unit.parcelNo)
  );
}

function getTaskTime(task: any) {
  return new Date(task?.updated_at || task?.created_at || 0).getTime();
}

function getUnitWorkflowTasks(unit: CbsUnit, workflowKind: TaskWorkflowKind, tasks: any[]) {
  return tasks
    .filter((task) => getTaskWorkflowKind(task) === workflowKind && taskMatchesUnit(task, unit))
    .sort((first, second) => {
      const firstOpen = !isTaskCompleted(first);
      const secondOpen = !isTaskCompleted(second);

      if (firstOpen !== secondOpen) {
        return firstOpen ? -1 : 1;
      }

      return getTaskTime(second) - getTaskTime(first);
    });
}

function getUnitWorkflowTask(unit: CbsUnit, workflowKind: TaskWorkflowKind, tasks: any[]) {
  return getUnitWorkflowTasks(unit, workflowKind, tasks)[0] || null;
}

function getAdministrativeSearchText(unit: CbsUnit) {
  return [unit.village, unit.district, unit.city, "Türkiye"]
    .map((value) => fixMojibake(value).trim())
    .filter(hasMeaningfulUnitValue)
    .join(", ");
}

export default function CBSScreen() {
  return (
    <RoleGate>
      <CBSContent />
    </RoleGate>
  );
}

function CBSContent() {
  const params = useLocalSearchParams();
  const mapRef = useRef<MapView | null>(null);
  const refreshRequestRef = useRef(0);
  const autoFocusedQueryRef = useRef("");
  const geocodeCacheRef = useRef(new Map<string, UserMapLocation | null>());
  const [units, setUnits] = useState<CbsUnit[]>([]);
  const [workflowTasks, setWorkflowTasks] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [showGreenhouses, setShowGreenhouses] = useState(true);
  const [showGoogleSatellite, setShowGoogleSatellite] = useState(false);
  const [showQgisLabels, setShowQgisLabels] = useState(false);
  const [showStaffLocations, setShowStaffLocations] = useState(false);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [nearbyMode, setNearbyMode] = useState(false);
  const [openingAssignment, setOpeningAssignment] = useState(false);
  const [openingPolygon, setOpeningPolygon] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [staffLocations, setStaffLocations] = useState<LiveFieldLocation[]>([]);
  const [userLocation, setUserLocation] = useState<UserMapLocation | null>(null);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const assignedTaskId = String(params.task_id || "");
  const assignedUnitNo = String(params.unit_no || "");
  const assignedAdaNo = String(params.ada_no || "");
  const assignedParcelNo = String(params.parcel_no || "");
  const management = canUseManagementScreens(profile);
  const routeWorkflowKey = String(Array.isArray(params.workflow) ? params.workflow[0] : params.workflow || "");
  const routeWorkflowKind = normalizeWorkflowKind(params.workflow);
  const [workflowOverride, setWorkflowOverride] = useState<{ routeKey: string; kind: TaskWorkflowKind } | null>(null);
  const activeWorkflowKind = workflowOverride?.routeKey === routeWorkflowKey ? workflowOverride.kind : routeWorkflowKind;
  const selectWorkflowKind = useCallback(
    (kind: TaskWorkflowKind) => {
      setWorkflowOverride({ routeKey: routeWorkflowKey, kind });
    },
    [routeWorkflowKey],
  );

  const refreshMapData = useCallback(async (showSpinner = false) => {
    const requestId = refreshRequestRef.current + 1;
    refreshRequestRef.current = requestId;

    if (showSpinner) {
      setLoading(true);
    }

    const [taskResult, unitResult] = await Promise.allSettled([getTasks(), loadCbsUnits()]);

    if (requestId !== refreshRequestRef.current) {
      return;
    }

    if (taskResult.status === "fulfilled") {
      setWorkflowTasks((taskResult.value.data || []).filter((task: any) => !isTaskCancelled(task)));
    } else {
      setWorkflowTasks([]);
    }

    if (unitResult.status === "fulfilled") {
      const nextUnits = unitResult.value;

      setUnits(nextUnits);
      setSelectedId((current) => (current && nextUnits.some((unit) => unit.id === current) ? current : null));
      setOffline(false);
      await cacheUnits(nextUnits);
    } else {
      const cached = await loadCachedUnits();
      const fallback = cached?.length ? cached : [];

      setUnits(fallback);
      setSelectedId((current) => (current && fallback.some((unit) => unit.id === current) ? current : null));
      setOffline(true);
    }

    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshMapData(false);

      return () => {
        refreshRequestRef.current += 1;
      };
    }, [refreshMapData]),
  );

  const filteredUnits = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase("tr-TR");
    if (!needle) return units;

    return units.filter((unit) =>
      [
        unit.producerName,
        unit.registrationNo,
        unit.unitNo,
        unit.city,
        unit.district,
        unit.village,
        unit.adaNo,
        unit.parcelNo,
        unit.crop,
        unit.qgisRule,
        unit.qgisPuan,
        unit.violationNote,
        STATUS_LABEL[unit.status],
      ]
        .join(" ")
        .toLocaleLowerCase("tr-TR")
        .includes(needle),
    );
  }, [deferredQuery, units]);

  const visibleUnits = useMemo(() => {
    if (!nearbyMode) {
      return filteredUnits;
    }

    const selectedUnit = units.find((unit) => unit.id === selectedId);
    const anchor = selectedUnit ? getCenter(selectedUnit.greenhousePolygon) : ANTALYA_REGION;

    return [...filteredUnits]
      .sort((first, second) => distanceFrom(anchor, first) - distanceFrom(anchor, second))
      .slice(0, 8);
  }, [filteredUnits, nearbyMode, selectedId, units]);

  const isAssignedUnit = useCallback((unit: CbsUnit) => {
    if (!assignedTaskId) {
      return false;
    }

    return (
      (hasMeaningfulUnitValue(assignedUnitNo) && unit.unitNo === assignedUnitNo) ||
      (hasMeaningfulUnitValue(assignedAdaNo) &&
        hasMeaningfulUnitValue(assignedParcelNo) &&
        hasMeaningfulUnitValue(unit.adaNo) &&
        hasMeaningfulUnitValue(unit.parcelNo) &&
        unit.adaNo === assignedAdaNo &&
        unit.parcelNo === assignedParcelNo)
    );
  }, [assignedAdaNo, assignedParcelNo, assignedTaskId, assignedUnitNo]);

  const selectedUnit = useMemo(() => units.find((unit) => unit.id === selectedId) || null, [selectedId, units]);
  const unitWorkflowMap = useMemo(() => {
    const map = new Map<string, Record<TaskWorkflowKind, UnitWorkflowInfo>>();

    units.forEach((unit) => {
      const workflowInfo = Object.fromEntries(
        WORKFLOW_KINDS.map((kind) => {
          const task = getUnitWorkflowTask(unit, kind, workflowTasks);

          return [
            kind,
            {
              task,
              state: task ? (isTaskCompleted(task) ? "done" : "partial") : "empty",
            },
          ];
        }),
      ) as Record<TaskWorkflowKind, UnitWorkflowInfo>;

      map.set(unit.id, workflowInfo);
    });

    return map;
  }, [units, workflowTasks]);
  const selectedWorkflowInfo = selectedUnit ? unitWorkflowMap.get(selectedUnit.id)?.[activeWorkflowKind] : null;
  const selectedWorkflowState = selectedWorkflowInfo?.state || null;
  const selectedWorkflowTask = selectedWorkflowInfo?.task || null;
  const selectedLookupHints = useMemo(() => (selectedUnit ? getCbsLookupHints(selectedUnit) : []), [selectedUnit]);
  const selectedWorkflowSummary = useMemo(
    () =>
      selectedUnit
        ? WORKFLOW_KINDS.map((kind) => ({
            kind,
            state: unitWorkflowMap.get(selectedUnit.id)?.[kind]?.state || "empty",
          }))
        : [],
    [selectedUnit, unitWorkflowMap],
  );

  const renderedUnits = useMemo(() => {
    if (nearbyMode) {
      return visibleUnits;
    }

    const candidates = [...visibleUnits];

    return candidates
      .sort((first, second) => {
        if (first.id === selectedId) return -1;
        if (second.id === selectedId) return 1;
        const firstAssigned = isAssignedUnit(first);
        const secondAssigned = isAssignedUnit(second);
        if (firstAssigned !== secondAssigned) return firstAssigned ? -1 : 1;
        return 0;
      })
      .slice(0, MAX_RENDERED_UNITS);
  }, [isAssignedUnit, nearbyMode, selectedId, visibleUnits]);

  const focusUserLocation = useCallback(async (showAlert = true) => {
    setLocating(true);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (!permission.granted) {
        if (showAlert) {
          Alert.alert("Konum izni gerekli", "CBS haritasında konumunuzu ve yönünüzü göstermek için konum izni verin.");
        }
        return;
      }

      const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 60000 });
      const position =
        lastKnown ||
        (await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        }));
      const heading = await Location.getHeadingAsync().catch(() => null);
      const coordinate = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      const nextHeading = getHeadingDegree(heading);

      setUserLocation(coordinate);
      setUserHeading(nextHeading);
      mapRef.current?.animateCamera(
        {
          center: coordinate,
          heading: nextHeading || 0,
          zoom: 16,
        },
        { duration: 500 },
      );
    } catch (error: any) {
      if (showAlert) {
        Alert.alert("Konum alınamadı", error?.message || "Cihaz konumu okunamadı.");
      }
    } finally {
      setLocating(false);
    }
  }, []);

  const loadUnits = useCallback(async () => {
    await refreshMapData(true);
  }, [refreshMapData]);

  useEffect(() => {
    getMyProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    let active = true;

    if (!showStaffLocations) {
      return () => {
        active = false;
      };
    }

    const refreshStaffLocations = () => {
      getLiveFieldLocations()
        .then((locations) => {
          if (active) {
            setStaffLocations(locations);
          }
        })
        .catch(() => {
          if (active) {
            setStaffLocations([]);
          }
        });
    };

    refreshStaffLocations();
    const timer = setInterval(refreshStaffLocations, 45000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [showStaffLocations]);

  useEffect(() => {
    let active = true;

    Location.getForegroundPermissionsAsync()
      .then((permission) => {
        if (active && permission.granted) {
          focusUserLocation(false);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [focusUserLocation]);

  const resolveUnitMapCenter = useCallback(async (unit: CbsUnit) => {
    if (!isDefaultCbsFallbackPolygon(unit.greenhousePolygon)) {
      return getCenter(unit.greenhousePolygon);
    }

    const searchText = getAdministrativeSearchText(unit);

    if (!searchText) {
      return getCenter(unit.greenhousePolygon);
    }

    if (geocodeCacheRef.current.has(searchText)) {
      return geocodeCacheRef.current.get(searchText) || getCenter(unit.greenhousePolygon);
    }

    const geocoded = await Location.geocodeAsync(searchText).catch(() => []);
    const firstResult = geocoded[0];
    const center = firstResult
      ? {
          latitude: firstResult.latitude,
          longitude: firstResult.longitude,
        }
      : null;

    geocodeCacheRef.current.set(searchText, center);
    return center || getCenter(unit.greenhousePolygon);
  }, []);

  const getUnitWithResolvedCenter = useCallback(
    async (unit: CbsUnit) => {
      if (!isDefaultCbsFallbackPolygon(unit.greenhousePolygon)) {
        return unit;
      }

      const center = await resolveUnitMapCenter(unit);
      const fallbackPolygon = buildFallbackPolygon(center);

      return {
        ...unit,
        parcelPolygon: isDefaultCbsFallbackPolygon(unit.parcelPolygon) ? fallbackPolygon : unit.parcelPolygon,
        greenhousePolygon: fallbackPolygon,
      };
    },
    [resolveUnitMapCenter],
  );

  const focusUnit = useCallback((unit: CbsUnit, animate = true) => {
    const center = getCenter(unit.greenhousePolygon);

    setSelectedId(unit.id);

    if (animate) {
      mapRef.current?.animateCamera(
        {
          center,
          zoom: 17,
        },
        { duration: 450 },
      );

      if (isDefaultCbsFallbackPolygon(unit.greenhousePolygon)) {
        resolveUnitMapCenter(unit).then((resolvedCenter) => {
          mapRef.current?.animateCamera(
            {
              center: resolvedCenter,
              zoom: 14,
            },
            { duration: 550 },
          );
        });
      }
    }
  }, [resolveUnitMapCenter]);

  useEffect(() => {
    const needle = deferredQuery.trim();

    if (!needle || loading || filteredUnits.length !== 1) {
      if (!needle) {
        autoFocusedQueryRef.current = "";
      }

      return;
    }

    const [unit] = filteredUnits;
    const querySignature = `${needle}:${unit.id}`;

    if (autoFocusedQueryRef.current === querySignature) {
      return;
    }

    autoFocusedQueryRef.current = querySignature;
    focusUnit(unit);
  }, [deferredQuery, filteredUnits, focusUnit, loading]);

  function canToggleLayer(nextGreenhouses: boolean) {
    if (!nextGreenhouses) {
      Alert.alert("Katman gerekli", "Haritada en az bir CBS katmanı açık kalmalı.");
      return false;
    }

    return true;
  }

  function toggleGreenhouses() {
    const nextValue = !showGreenhouses;
    if (!canToggleLayer(nextValue)) {
      return;
    }

    setShowGreenhouses(nextValue);
  }

  useEffect(() => {
    if (!units.length || (!assignedUnitNo && !assignedAdaNo && !assignedParcelNo)) {
      return;
    }

    const match = units.find(
      (unit) =>
        (hasMeaningfulUnitValue(assignedUnitNo) && unit.unitNo === assignedUnitNo) ||
        (hasMeaningfulUnitValue(assignedAdaNo) &&
          hasMeaningfulUnitValue(assignedParcelNo) &&
          hasMeaningfulUnitValue(unit.adaNo) &&
          hasMeaningfulUnitValue(unit.parcelNo) &&
          unit.adaNo === assignedAdaNo &&
          unit.parcelNo === assignedParcelNo),
    );

    if (match) {
      setTimeout(() => focusUnit(match), 0);
    }
  }, [assignedAdaNo, assignedParcelNo, assignedUnitNo, focusUnit, units]);

  async function openPolygonEditor(unit: CbsUnit) {
    if (openingPolygon) {
      return;
    }

    setOpeningPolygon(true);

    try {
      const taskId = params.task_id ? String(params.task_id) : "";

      if (taskId && isAssignedUnit(unit)) {
        router.push(`/task/${taskId}/polygon` as any);
        return;
      }

      const existingWorkflowTask = getUnitWorkflowTask(unit, activeWorkflowKind, workflowTasks);

      if (existingWorkflowTask?.id) {
        router.push(`/task/${existingWorkflowTask.id}/polygon` as any);
        return;
      }

      const unitForPolygon = await getUnitWithResolvedCenter(unit);
      const result = await startInspectionFromUnit(unitForPolygon, "Sahada", activeWorkflowKind);

      if (result.task?.id) {
        router.push(`/task/${result.task.id}/polygon` as any);
      }
    } catch (error: any) {
      Alert.alert("Poligon ekranı açılamadı", error?.message || "CBS poligonu için görev kaydı hazırlanamadı.");
    } finally {
      setOpeningPolygon(false);
    }
  }

  async function openAssignmentScreen(unit: CbsUnit) {
    if (openingAssignment) {
      return;
    }

    setOpeningAssignment(true);

    try {
      const taskId = params.task_id ? String(params.task_id) : "";

      if (taskId && isAssignedUnit(unit)) {
        router.push(`/task/${taskId}` as any);
        return;
      }

      const existingWorkflowTask = getUnitWorkflowTask(unit, activeWorkflowKind, workflowTasks);

      if (existingWorkflowTask?.id) {
        router.push(`/task/${existingWorkflowTask.id}` as any);
        return;
      }

      if (!management) {
        if (activeWorkflowKind === "inspection") {
          Alert.alert("Atanmış görev gerekli", "Başvurulu denetim yalnızca admin tarafından atanmış görev üzerinden başlatılır.");
          return;
        }

        const result = await startInspectionFromUnit(unit, "Sahada", activeWorkflowKind);

        if (result.task?.id) {
          router.push(`/task/${result.task.id}` as any);
        }
        return;
      }

      const center = getCenter(unit.greenhousePolygon);

      router.push({
        pathname: "/new-task",
        params: {
          workflow: activeWorkflowKind,
          tc_no: unit.producerTc,
          producer_name: unit.producerName,
          phone: unit.producerPhone || "",
          city: unit.city,
          district_name: unit.district,
          village: unit.village,
          ada_no: unit.adaNo,
          parcel_no: unit.parcelNo,
          detected_crop: unit.crop,
          unit_no: unit.unitNo,
          greenhouse_area: String(unit.greenhouseArea || ""),
          latitude: String(center.latitude),
          longitude: String(center.longitude),
          parcel_polygon: JSON.stringify(unit.parcelPolygon),
          greenhouse_polygon: JSON.stringify(unit.greenhousePolygon),
        },
      } as any);
    } catch (error: any) {
      Alert.alert("Görevlendirme ekranı açılamadı", error?.message || "Kayıt oluşturulamadı.");
    } finally {
      setOpeningAssignment(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#22c55e" size="large" />
        <Text style={styles.loadingText}>CBS katmanları yükleniyor...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>CBS merkezi</Text>
          <Text style={styles.title}>Sera Haritası</Text>
          <Text style={styles.subtitle}>Üniteye dokununca bilgi kartı açılır; karttan görevlendirme ekranına geçilir.</Text>
        </View>
        <View style={styles.headerIcon}>
          <MaterialCommunityIcons name="map-marker-radius-outline" color="#bbf7d0" size={24} />
        </View>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Ünite, üretici, ada/parsel veya ilçe ara"
          placeholderTextColor="#64748b"
          style={styles.search}
        />
        <Pressable onPress={loadUnits} style={styles.iconButton}>
          <MaterialCommunityIcons name="refresh" color="white" size={20} />
        </Pressable>
      </View>

      <View style={styles.workflowModeRow}>
        <WorkflowModeButton
          active={activeWorkflowKind === "inspection"}
          color={WORKFLOW_KIND_COLOR.inspection}
          label="Başvurulu"
          onPress={() => selectWorkflowKind("inspection")}
        />
        <WorkflowModeButton
          active={activeWorkflowKind === "detection"}
          color={WORKFLOW_KIND_COLOR.detection}
          label="Re'sen"
          onPress={() => selectWorkflowKind("detection")}
        />
        <WorkflowModeButton
          active={activeWorkflowKind === "classification"}
          color={WORKFLOW_KIND_COLOR.classification}
          label="Sınıflandırma"
          onPress={() => selectWorkflowKind("classification")}
        />
      </View>

      <View style={styles.mapToolbarHeader}>
        <View>
          <Text style={styles.toolbarTitle}>Harita</Text>
          <Text style={styles.toolbarMeta}>
            {renderedUnits.length}/{visibleUnits.length} ünite çiziliyor{nearbyMode ? " · yakındaki görünüm" : ""}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            setQuery("");
            setNearbyMode(false);
            setSelectedId(null);
          }}
          style={styles.clearMapButton}
        >
          <MaterialCommunityIcons name="map-marker-off-outline" color="#cbd5e1" size={17} />
        </Pressable>
      </View>

      {offline ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>Çevrimdışı kayıtlar gösteriliyor. Bağlantı gelince CBS verileri yenilenir.</Text>
        </View>
      ) : null}

      {assignedTaskId ? (
        <View style={styles.assignedNotice}>
          <MaterialCommunityIcons name="map-marker-check-outline" color="#bfdbfe" size={18} />
          <Text style={styles.assignedNoticeText}>
            Admin tarafından atanan göreve dokunun, açılan karttan görev detayına geçin.
          </Text>
        </View>
      ) : null}

      <View style={styles.mapCard}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={ANTALYA_REGION}
          scrollEnabled
          zoomEnabled
          zoomControlEnabled
          rotateEnabled
          showsCompass
          mapType={showGoogleSatellite ? "satellite" : "standard"}
        >
          {renderedUnits.map((unit) => {
            const assigned = isAssignedUnit(unit);
            const selected = selectedId === unit.id;
            const workflowState = unitWorkflowMap.get(unit.id)?.[activeWorkflowKind]?.state || "empty";
            const unitColor = WORKFLOW_STATE_COLOR[workflowState];
            const openUnitCard = () => focusUnit(unit, false);

            return (
              <Fragment key={unit.id}>
                {showGreenhouses ? (
                  <Polygon
                    key={`greenhouse-${unit.id}-${activeWorkflowKind}-${workflowState}-${selected ? "selected" : "normal"}`}
                    coordinates={unit.greenhousePolygon}
                    strokeColor={unitColor}
                    fillColor={WORKFLOW_STATE_FILL[workflowState]}
                    strokeWidth={assigned || selected ? 3 : 2}
                    tappable
                    onPress={openUnitCard}
                  />
                ) : null}
              </Fragment>
            );
          })}
          {showQgisLabels
            ? renderedUnits.map((unit) => {
                const label = getQgisStatusLabel(unit);

                if (!label) {
                  return null;
                }

                return (
                  <Marker
                    key={`${unit.id}-qgis-puan`}
                    coordinate={getCenter(unit.greenhousePolygon)}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={false}
                    onPress={() => focusUnit(unit, false)}
                  >
                    <View style={styles.qgisScoreLabel}>
                      <Text style={styles.qgisScoreLabelText}>{label}</Text>
                    </View>
                  </Marker>
                );
              })
            : null}
          {userLocation ? (
            <Marker coordinate={userLocation} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.userLocationMarker}>
                <View style={[styles.userDirectionMarker, { transform: [{ rotate: `${userHeading || 0}deg` }] }]}>
                  <MaterialCommunityIcons name="navigation" color="white" size={18} />
                </View>
              </View>
            </Marker>
          ) : null}
          {showStaffLocations
            ? staffLocations.map((staff) => (
                <Marker
                  key={`staff-${staff.user_id}`}
                  coordinate={{
                    latitude: Number(staff.latitude),
                    longitude: Number(staff.longitude),
                  }}
                  anchor={{ x: 0.5, y: 0.5 }}
                >
                  <View style={styles.staffMarker}>
                    <MaterialCommunityIcons name="account-hard-hat-outline" color="white" size={17} />
                  </View>
                  <Callout tooltip>
                    <View style={styles.staffCallout}>
                      <Text style={styles.staffCalloutTitle}>{staff.full_name || "Saha personeli"}</Text>
                      <Text style={styles.staffCalloutMeta}>{formatLiveLocationTime(staff.updated_at)}</Text>
                    </View>
                  </Callout>
                </Marker>
              ))
            : null}
        </MapView>
        <View style={styles.mapControlStack}>
          <Pressable
            accessibilityLabel="Konum ve yön"
            onPress={() => focusUserLocation()}
            style={[styles.locationButton, locating && styles.locationButtonActive]}
          >
            {locating ? (
              <ActivityIndicator color="#2563eb" size="small" />
            ) : (
              <MaterialCommunityIcons name="crosshairs-gps" color="#2563eb" size={23} />
            )}
          </Pressable>
        </View>
        <View style={styles.layerControl}>
          <Pressable
            accessibilityLabel="Harita katmanları"
            onPress={() => setShowLayerPanel((value) => !value)}
            style={[styles.layerControlButton, showLayerPanel && styles.layerControlButtonActive]}
          >
            <MaterialCommunityIcons name="layers-outline" color={showLayerPanel ? "#16a34a" : "#1f2937"} size={24} />
          </Pressable>
          {showLayerPanel ? (
            <View style={styles.layerPanel}>
              <View style={styles.layerPanelHeader}>
                <Text style={styles.layerPanelTitle}>Katmanlar</Text>
                <Text style={styles.layerPanelCount}>İş durumu</Text>
              </View>
              <ScrollView style={styles.layerPanelScroll} contentContainerStyle={styles.layerPanelScrollContent} nestedScrollEnabled>
              <LayerPanelRow
                active={showGoogleSatellite}
                color="#64748b"
                icon="satellite-variant"
                title={AKSU_SOLAK_QGIS_PROJECT.satelliteLayerName}
                subtitle="QGIS uydu altlığı"
                onPress={() => {
                  setShowGoogleSatellite((value) => !value);
                }}
              />
              <LayerPanelRow
                active={showGreenhouses}
                color="#22c55e"
                icon="greenhouse"
                title="KOBÜKS Seralar"
                subtitle="Kapalı üretim alanları"
                onPress={toggleGreenhouses}
              />
              <LayerPanelRow
                active={showQgisLabels}
                color="#f8fafc"
                icon="format-text"
                title="Durum Etiketleri"
                subtitle="Puana göre sera durumu"
                onPress={() => {
                  setShowQgisLabels((value) => !value);
                }}
              />
              <LayerPanelRow
                active={nearbyMode}
                color="#f59e0b"
                icon="crosshairs-gps"
                title="Yakındaki Üniteler"
                subtitle="En yakın 8 kayıt"
                onPress={() => setNearbyMode((value) => !value)}
              />
              <LayerPanelRow
                active={showStaffLocations}
                color="#a855f7"
                icon="account-hard-hat-outline"
                title="Sahadaki Personel"
                subtitle={`${staffLocations.length} aktif konum`}
                onPress={() => {
                  setShowStaffLocations((value) => !value);
                }}
              />
              <LayerLegendRow color={WORKFLOW_STATE_COLOR.done} icon="check-circle-outline" title="İşlem tamamlandı" />
              <LayerLegendRow color={WORKFLOW_STATE_COLOR.partial} icon="clock-outline" title="İşlem yarıda" />
              <LayerLegendRow color={WORKFLOW_STATE_COLOR.empty} icon="close-circle-outline" title="İşlem yapılmadı" />
              </ScrollView>
            </View>
          ) : null}
        </View>
        {selectedUnit && !showLayerPanel ? (
          <View style={styles.selectedUnitPanel}>
            <View style={styles.selectedUnitHeader}>
              <View style={styles.selectedUnitTitleWrap}>
                <Text style={styles.selectedUnitKicker}>
                  {selectedWorkflowState
                    ? `${WORKFLOW_KIND_LABEL[activeWorkflowKind]} · ${WORKFLOW_STATE_LABEL[selectedWorkflowState]}`
                    : "Ünite seçildi"}
                </Text>
                <Text style={styles.selectedUnitTitle}>{fixMojibake(selectedUnit.unitNo || "Ünite")}</Text>
              </View>
              <Pressable onPress={() => setSelectedId(null)} style={styles.selectedUnitClose}>
                <MaterialCommunityIcons name="close" color="#cbd5e1" size={18} />
              </Pressable>
            </View>
            <Text style={styles.selectedUnitText} numberOfLines={1}>
              {fixMojibake(selectedUnit.producerName || "-")} · {fixMojibake(selectedUnit.crop || "-")}
            </Text>
            <Text style={styles.selectedUnitMeta} numberOfLines={1}>
              {fixMojibake(selectedUnit.district || "-")} / {fixMojibake(selectedUnit.village || "-")} · {fixMojibake(selectedUnit.adaNo || "-")}/{fixMojibake(selectedUnit.parcelNo || "-")}
            </Text>
            <View style={styles.lookupSection}>
              <Text style={styles.lookupSectionTitle}>CBS eşleşmesi</Text>
              {selectedLookupHints.map((hint) => (
                <View key={`${hint.label}-${hint.value}`} style={styles.lookupRow}>
                  <Text style={styles.lookupLabel}>{hint.label}</Text>
                  <Text style={styles.lookupValue} numberOfLines={2}>
                    {hint.value}
                  </Text>
                </View>
              ))}
            </View>
            <View style={styles.workflowStatusStrip}>
              {selectedWorkflowSummary.map((item) => {
                const color = WORKFLOW_STATE_COLOR[item.state];

                return (
                  <View key={item.kind} style={[styles.workflowStatusPill, { borderColor: color, backgroundColor: `${color}22` }]}>
                    <View style={[styles.workflowStatusDot, { backgroundColor: color }]} />
                    <Text style={styles.workflowStatusText} numberOfLines={1}>
                      {WORKFLOW_KIND_LABEL[item.kind]}
                    </Text>
                  </View>
                );
              })}
            </View>
            {selectedUnit.qgisRule ? (
              <Text style={styles.selectedUnitMeta} numberOfLines={1}>
                QGIS durumu: {getQgisStatusLabel(selectedUnit)}
              </Text>
            ) : null}
            {selectedWorkflowTask ? (
              <Text style={styles.selectedUnitMeta} numberOfLines={1}>
                Kayıt: {getTaskStatus(selectedWorkflowTask)}
              </Text>
            ) : null}
            <View style={styles.selectedUnitActions}>
              <Pressable onPress={() => openAssignmentScreen(selectedUnit)} style={[styles.selectedUnitAction, styles.selectedUnitDetailAction]}>
                <MaterialCommunityIcons name="clipboard-text-outline" color="white" size={18} />
                <Text style={styles.selectedUnitActionText}>Detay / Görev</Text>
              </Pressable>
              <Pressable
                onPress={() => openPolygonEditor(selectedUnit)}
                style={[styles.selectedUnitAction, styles.selectedUnitPolygonAction, openingPolygon && styles.dimmedAction]}
                disabled={openingPolygon}
              >
                <MaterialCommunityIcons name="shape-polygon-plus" color="white" size={18} />
                <Text style={styles.selectedUnitActionText}>{openingPolygon ? "Açılıyor" : "Poligon Çiz"}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function distanceFrom(anchor: { latitude: number; longitude: number }, unit: CbsUnit) {
  const center = getCenter(unit.greenhousePolygon);
  return Math.hypot(center.latitude - anchor.latitude, center.longitude - anchor.longitude);
}

function formatLiveLocationTime(value?: string) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function WorkflowModeButton({
  active,
  color,
  label,
  onPress,
}: {
  active: boolean;
  color: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.workflowModeButton,
        { borderColor: active ? color : "#1e293b" },
        active && { backgroundColor: `${color}2b` },
      ]}
    >
      <View style={[styles.workflowModeDot, { backgroundColor: color }]} />
      <Text style={[styles.workflowModeText, active && styles.workflowModeTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function LayerPanelRow({
  active,
  color,
  icon,
  onPress,
  subtitle,
  title,
}: {
  active: boolean;
  color: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress?: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <Pressable onPress={onPress} style={styles.layerPanelRow}>
      <View style={[styles.layerSymbol, { borderColor: color }]}>
        <MaterialCommunityIcons name={icon} color={color} size={17} />
      </View>
      <View style={styles.layerPanelText}>
        <Text style={styles.layerPanelName}>{title}</Text>
        <Text style={styles.layerPanelMeta}>{subtitle}</Text>
      </View>
      <View style={[styles.layerSwitch, active && styles.layerSwitchActive]}>
        <View style={[styles.layerSwitchKnob, active && styles.layerSwitchKnobActive]} />
      </View>
    </Pressable>
  );
}

function LayerLegendRow({
  color,
  icon,
  title,
}: {
  color: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
}) {
  return (
    <View style={styles.layerLegendRow}>
      <View style={[styles.layerSymbol, { borderColor: color }]}>
        <MaterialCommunityIcons name={icon} color={color} size={17} />
      </View>
      <Text style={styles.layerPanelName}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#020617",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#020617",
  },
  loadingText: {
    color: "#cbd5e1",
    marginTop: 12,
    fontWeight: "700",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 96,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
  },
  headerText: {
    flex: 1,
  },
  kicker: {
    color: "#38bdf8",
    fontSize: 12,
    fontWeight: "800",
  },
  title: {
    color: "white",
    fontSize: 30,
    fontWeight: "800",
    marginTop: 2,
  },
  subtitle: {
    color: "#94a3b8",
    marginTop: 5,
    lineHeight: 19,
  },
  headerIcon: {
    width: 46,
    height: 46,
    borderRadius: 8,
    backgroundColor: "#14532d",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#22c55e",
  },
  searchRow: {
    flexDirection: "row",
    gap: 8,
  },
  workflowModeRow: {
    flexDirection: "row",
    gap: 8,
  },
  workflowModeButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
  },
  workflowModeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  workflowModeButtonActive: {
    borderColor: "#22c55e",
    backgroundColor: "#14532d",
  },
  workflowModeText: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  workflowModeTextActive: {
    color: "#bbf7d0",
  },
  search: {
    flex: 1,
    minHeight: 46,
    backgroundColor: "#0f172a",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
    color: "white",
    paddingHorizontal: 12,
  },
  iconButton: {
    width: 48,
    borderRadius: 8,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
  },
  mapToolbarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 2,
  },
  toolbarTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "800",
  },
  toolbarMeta: {
    color: "#94a3b8",
    marginTop: 3,
    fontSize: 12,
    fontWeight: "700",
  },
  clearMapButton: {
    width: 40,
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1e293b",
    alignItems: "center",
    justifyContent: "center",
  },
  warning: {
    backgroundColor: "#422006",
    borderWidth: 1,
    borderColor: "#92400e",
    borderRadius: 8,
    padding: 10,
  },
  warningText: {
    color: "#fed7aa",
    fontSize: 12,
    fontWeight: "700",
  },
  assignedNotice: {
    backgroundColor: "#172554",
    borderWidth: 1,
    borderColor: "#2563eb",
    borderRadius: 8,
    padding: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  assignedNoticeText: {
    flex: 1,
    color: "#dbeafe",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  mapCard: {
    height: 520,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  map: {
    flex: 1,
  },
  selectedUnitPanel: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 66,
    borderRadius: 8,
    backgroundColor: "rgba(15,23,42,0.96)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    padding: 12,
    gap: 7,
  },
  selectedUnitHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  selectedUnitTitleWrap: {
    flex: 1,
  },
  selectedUnitKicker: {
    color: "#38bdf8",
    fontSize: 11,
    fontWeight: "800",
  },
  selectedUnitTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 2,
  },
  selectedUnitClose: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1e293b",
    alignItems: "center",
    justifyContent: "center",
  },
  selectedUnitText: {
    color: "white",
    fontWeight: "800",
  },
  selectedUnitMeta: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },
  lookupSection: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(148,163,184,0.22)",
    paddingVertical: 7,
    gap: 5,
  },
  lookupSectionTitle: {
    color: "#bfdbfe",
    fontSize: 11,
    fontWeight: "900",
  },
  lookupRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  lookupLabel: {
    width: 108,
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "800",
  },
  lookupValue: {
    flex: 1,
    minWidth: 0,
    color: "#e2e8f0",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 14,
  },
  workflowStatusStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  workflowStatusPill: {
    minHeight: 28,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
  },
  workflowStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  workflowStatusText: {
    color: "white",
    fontSize: 11,
    fontWeight: "900",
  },
  selectedUnitAction: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 2,
  },
  selectedUnitActions: {
    flexDirection: "row",
    gap: 8,
  },
  selectedUnitDetailAction: {
    backgroundColor: "#2563eb",
  },
  selectedUnitPolygonAction: {
    backgroundColor: "#16a34a",
  },
  dimmedAction: {
    opacity: 0.58,
  },
  selectedUnitActionText: {
    color: "white",
    fontWeight: "900",
  },
  mapControlStack: {
    position: "absolute",
    left: 12,
    top: 12,
  },
  locationButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  locationButtonActive: {
    opacity: 0.82,
  },
  layerControl: {
    position: "absolute",
    right: 12,
    top: 12,
    alignItems: "flex-end",
    gap: 8,
  },
  layerControlButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  layerControlButtonActive: {
    borderColor: "rgba(22,163,74,0.75)",
  },
  layerPanel: {
    width: 248,
    maxHeight: 430,
    borderRadius: 8,
    backgroundColor: "rgba(15,23,42,0.96)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    padding: 10,
    gap: 8,
  },
  layerPanelScroll: {
    maxHeight: 362,
  },
  layerPanelScrollContent: {
    gap: 8,
    paddingBottom: 2,
  },
  layerPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingBottom: 2,
  },
  layerPanelTitle: {
    color: "white",
    fontWeight: "800",
  },
  layerPanelCount: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "800",
  },
  layerPanelRow: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "rgba(17,24,39,0.92)",
    borderWidth: 1,
    borderColor: "rgba(30,41,59,0.95)",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 9,
  },
  layerLegendRow: {
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: "rgba(17,24,39,0.72)",
    borderWidth: 1,
    borderColor: "rgba(30,41,59,0.78)",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 9,
  },
  layerSymbol: {
    width: 29,
    height: 29,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: "rgba(2,6,23,0.86)",
    alignItems: "center",
    justifyContent: "center",
  },
  layerPanelText: {
    flex: 1,
  },
  layerPanelName: {
    color: "white",
    fontSize: 12,
    fontWeight: "800",
  },
  layerPanelMeta: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
  layerSwitch: {
    width: 36,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#334155",
    padding: 3,
    justifyContent: "center",
  },
  layerSwitchActive: {
    backgroundColor: "#16a34a",
  },
  layerSwitchKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "white",
  },
  layerSwitchKnobActive: {
    alignSelf: "flex-end",
  },
  userLocationMarker: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(37,99,235,0.2)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  userDirectionMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#2563eb",
    borderWidth: 2,
    borderColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  staffMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#7c3aed",
    borderWidth: 2,
    borderColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  qgisScoreLabel: {
    minWidth: 54,
    minHeight: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.72)",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  qgisScoreLabelText: {
    color: "#020617",
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center",
  },
  staffCallout: {
    minWidth: 150,
    borderRadius: 8,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    padding: 10,
  },
  staffCalloutTitle: {
    color: "white",
    fontWeight: "800",
  },
  staffCalloutMeta: {
    color: "#94a3b8",
    marginTop: 3,
    fontSize: 12,
  },
  unitCallout: {
    width: 260,
    borderRadius: 8,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    padding: 12,
    gap: 6,
  },
  unitCalloutAssigned: {
    borderColor: "#60a5fa",
    backgroundColor: "#172554",
  },
  unitCalloutHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  unitCalloutKicker: {
    color: "#38bdf8",
    fontSize: 11,
    fontWeight: "800",
  },
  unitCalloutTitle: {
    color: "white",
    fontSize: 17,
    fontWeight: "800",
    marginTop: 2,
  },
  unitCalloutText: {
    color: "#cbd5e1",
    fontWeight: "700",
  },
  unitCalloutMeta: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
  },
});
