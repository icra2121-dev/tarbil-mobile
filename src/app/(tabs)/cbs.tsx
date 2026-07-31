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
import MapView, { Callout, Marker, Polygon, type Region } from "react-native-maps";

import {
  AKSU_SOLAK_QGIS_PROJECT,
  ANTALYA_REGION,
  CbsUnit,
  type CbsParcel,
  STATUS_LABEL,
  buildFallbackPolygon,
  getBundledCbsUnits,
  getCenter,
  getCbsLookupHints,
  getQgisStatusLabel,
  loadKobuksMapUnitsForParcels,
  isDefaultCbsFallbackPolygon,
  loadCbsUnits,
  loadTkgmParcelsForRegion,
  mergeCbsUnits,
  parsePolygon,
  startInspectionFromUnit,
} from "../../services/cbs";
import { canUseManagementScreens, getMyProfile } from "../../services/profile";
import { getTaskById } from "../../services/taskDetail";
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

const CACHE_KEY = "tarbil:cbs-units:v5";
const CACHE_UNIT_LIMIT = 300;
const MAX_RENDERED_UNITS = 150;
const MAX_VISIBLE_MAP_UNITS = 1200;

function getPolygonSignature(points: { latitude: number; longitude: number }[]) {
  return points
    .map((point) => `${Number(point.latitude).toFixed(6)},${Number(point.longitude).toFixed(6)}`)
    .sort()
    .join("|");
}

function getKobuksParcelOverlayKey(unit: CbsUnit) {
  const administrativeKey = [unit.city, unit.district, unit.village, unit.adaNo, unit.parcelNo]
    .map((value) => fixMojibake(value || "").trim().toLocaleLowerCase("tr-TR"))
    .join("|");

  if (administrativeKey.replace(/\|/g, "")) {
    return `parcel:${administrativeKey}`;
  }

  const storedParcelId = String(unit.cbsStorageId || unit.cbsUnitId || "").trim();

  if (storedParcelId) {
    return `cbs:${storedParcelId}`;
  }

  return `geometry:${getPolygonSignature(unit.parcelPolygon)}`;
}

function getUnitMapCenter(unit: CbsUnit) {
  return getCenter(
    unit.greenhousePolygon.length >= 3 ? unit.greenhousePolygon : unit.parcelPolygon,
  );
}

function buildTkgmParcelUnit(parcel: CbsParcel): CbsUnit {
  const parcelIdentity = String(
    parcel.tkgmParcelId || `${parcel.adaNo}-${parcel.parcelNo}-${parcel.id.slice(0, 8)}`,
  )
    .replace(/[^0-9A-Za-z_-]/g, "-")
    .slice(0, 48);

  return {
    id: `tkgm-parcel-${parcel.id}`,
    cbsUnitId: parcel.tkgmParcelId,
    cbsStorageId: parcel.id,
    parcelOnly: true,
    producerName: "Sahada tespit edilecek",
    producerTc: "",
    registrationNo: "",
    unitNo: `TKGM-${parcelIdentity}`,
    city: parcel.city,
    district: parcel.district,
    village: parcel.village,
    adaNo: parcel.adaNo,
    parcelNo: parcel.parcelNo,
    crop: "Sahada tespit edilecek",
    greenhouseArea: 0,
    status: "taslak",
    parcelPolygon: parcel.polygon,
    greenhousePolygon: [],
  };
}

function isPolygonVisibleInRegion(
  points: { latitude: number; longitude: number }[],
  region: Region,
) {
  if (!points.length) return false;

  const latitudePadding = region.latitudeDelta * 0.15;
  const longitudePadding = region.longitudeDelta * 0.15;
  const regionMinLatitude = region.latitude - region.latitudeDelta / 2 - latitudePadding;
  const regionMaxLatitude = region.latitude + region.latitudeDelta / 2 + latitudePadding;
  const regionMinLongitude = region.longitude - region.longitudeDelta / 2 - longitudePadding;
  const regionMaxLongitude = region.longitude + region.longitudeDelta / 2 + longitudePadding;
  const polygonLatitudes = points.map((point) => point.latitude);
  const polygonLongitudes = points.map((point) => point.longitude);
  const polygonMinLatitude = Math.min(...polygonLatitudes);
  const polygonMaxLatitude = Math.max(...polygonLatitudes);
  const polygonMinLongitude = Math.min(...polygonLongitudes);
  const polygonMaxLongitude = Math.max(...polygonLongitudes);

  return (
    polygonMaxLatitude >= regionMinLatitude &&
    polygonMinLatitude <= regionMaxLatitude &&
    polygonMaxLongitude >= regionMinLongitude &&
    polygonMinLongitude <= regionMaxLongitude
  );
}

function waitForLocationResult<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

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
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const parsed = JSON.parse(cached);
    return Array.isArray(parsed) ? (parsed as CbsUnit[]) : null;
  } catch {
    await AsyncStorage.removeItem(CACHE_KEY).catch(() => undefined);
    return null;
  }
}

async function cacheUnits(units: CbsUnit[]) {
  try {
    const lightUnits = units.slice(0, CACHE_UNIT_LIMIT).map((unit) => ({
      id: unit.id,
      cbsUnitId: unit.cbsUnitId,
      greenhouseUnitId: unit.greenhouseUnitId,
      producerName: unit.producerName,
      producerTc: unit.producerTc,
      producerPhone: unit.producerPhone,
      registrationNo: unit.registrationNo,
      unitNo: unit.unitNo,
      city: unit.city,
      district: unit.district,
      village: unit.village,
      adaNo: unit.adaNo,
      parcelNo: unit.parcelNo,
      crop: unit.crop,
      greenhouseArea: unit.greenhouseArea,
      status: unit.status,
      parcelPolygon: unit.parcelPolygon,
      greenhousePolygon: unit.greenhousePolygon,
    }));

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(lightUnits));
  } catch {
    await AsyncStorage.removeItem(CACHE_KEY).catch(() => undefined);
  }
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

function singleRouteValue(value: unknown) {
  return String(Array.isArray(value) ? value[0] : value || "");
}

function getTaskPolygon(value: unknown, fallback: { latitude: number; longitude: number }) {
  if (value === null || value === undefined || value === "") {
    return [];
  }

  const polygon = parsePolygon(value, fallback);
  return polygon.length >= 3 ? polygon : [];
}

function buildAssignedTaskUnit(task: any): CbsUnit | null {
  const taskId = String(task?.id || "").trim();

  if (!taskId) {
    return null;
  }

  const fallback = {
    latitude: Number(task?.latitude) || ANTALYA_REGION.latitude,
    longitude: Number(task?.longitude) || ANTALYA_REGION.longitude,
  };
  const parcelPolygon = getTaskPolygon(task?.parcel_polygon ?? task?.parcelPolygon, fallback);
  const greenhousePolygon = getTaskPolygon(task?.greenhouse_polygon ?? task?.greenhousePolygon, fallback);

  return {
    id: `assigned-task-${taskId}`,
    origin: "task",
    cbsUnitId: task?.cbs_unit_id ? String(task.cbs_unit_id) : undefined,
    cbsStorageId: task?.cbs_unit_id ? String(task.cbs_unit_id) : undefined,
    greenhouseUnitId: task?.greenhouse_unit_id ? String(task.greenhouse_unit_id) : undefined,
    producerId: task?.producer_id ? String(task.producer_id) : undefined,
    parcelOnly: greenhousePolygon.length < 3,
    producerName: fixMojibake(task?.producer_name || "Sahada tespit edilecek"),
    producerTc: String(task?.tc_no || task?.producer_tc || ""),
    producerPhone: task?.phone ? String(task.phone) : undefined,
    registrationNo: String(task?.registration_no || ""),
    unitNo: String(task?.unit_no || `GÖREV-${taskId}`),
    city: fixMojibake(task?.city || "Antalya"),
    district: fixMojibake(task?.district_name || task?.district || "Aksu"),
    village: fixMojibake(task?.village || "-"),
    adaNo: String(task?.ada_no || "-"),
    parcelNo: String(task?.parcel_no || "-"),
    crop: fixMojibake(task?.detected_crop || "Sahada tespit edilecek"),
    greenhouseArea: Number(task?.greenhouse_area) || 0,
    status: "inceleme",
    parcelPolygon,
    greenhousePolygon,
  };
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
  return <CBSContent />;
}

function CBSContent() {
  const params = useLocalSearchParams();
  const mapRef = useRef<MapView | null>(null);
  const refreshRequestRef = useRef(0);
  const parcelRequestRef = useRef(0);
  const parcelLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRegionRef = useRef<Region>(ANTALYA_REGION);
  const searchRequestRef = useRef(0);
  const hasServerSearchRef = useRef(false);
  const autoFocusedQueryRef = useRef("");
  const assignedTaskFocusRef = useRef("");
  const dismissedAssignedTaskFocusRef = useRef("");
  const geocodeCacheRef = useRef(new Map<string, UserMapLocation | null>());
  const [units, setUnits] = useState<CbsUnit[]>(getBundledCbsUnits);
  const [tkgmParcels, setTkgmParcels] = useState<CbsParcel[]>([]);
  const [workflowTasks, setWorkflowTasks] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchIssue, setSearchIssue] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [showParcels, setShowParcels] = useState(true);
  const [showGreenhouses, setShowGreenhouses] = useState(true);
  const [showKobuksRecords, setShowKobuksRecords] = useState(true);
  const [showGoogleSatellite, setShowGoogleSatellite] = useState(false);
  const [showQgisLabels, setShowQgisLabels] = useState(false);
  const [showStaffLocations, setShowStaffLocations] = useState(false);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [nearbyMode, setNearbyMode] = useState(false);
  const [openingAssignment, setOpeningAssignment] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [staffLocations, setStaffLocations] = useState<LiveFieldLocation[]>([]);
  const [userLocation, setUserLocation] = useState<UserMapLocation | null>(null);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [mapRegion, setMapRegion] = useState<Region>(ANTALYA_REGION);
  const [assignedTaskUnit, setAssignedTaskUnit] = useState<CbsUnit | null>(null);
  const assignedTaskId = String(params.task_id || "");
  const assignedUnitNo = String(params.unit_no || "");
  const assignedAdaNo = String(params.ada_no || "");
  const assignedParcelNo = String(params.parcel_no || "");
  const management = canUseManagementScreens(profile);
  const routeWorkflowKey = String(Array.isArray(params.workflow) ? params.workflow[0] : params.workflow || "");
  const routeWorkflowKind = normalizeWorkflowKind(params.workflow);
  const [workflowOverride, setWorkflowOverride] = useState<{ routeKey: string; kind: TaskWorkflowKind } | null>(null);
  const activeWorkflowKind = workflowOverride?.routeKey === routeWorkflowKey ? workflowOverride.kind : routeWorkflowKind;
  const routeAssignedTaskUnit = useMemo(() => {
    if (!assignedTaskId) {
      return null;
    }

    return buildAssignedTaskUnit({
      id: assignedTaskId,
      unit_no: assignedUnitNo,
      ada_no: assignedAdaNo,
      parcel_no: assignedParcelNo,
      latitude: singleRouteValue(params.latitude),
      longitude: singleRouteValue(params.longitude),
      parcel_polygon: singleRouteValue(params.parcel_polygon),
      greenhouse_polygon: singleRouteValue(params.greenhouse_polygon),
      workflow_type: activeWorkflowKind,
    });
  }, [activeWorkflowKind, assignedAdaNo, assignedParcelNo, assignedTaskId, assignedUnitNo, params.greenhouse_polygon, params.latitude, params.longitude, params.parcel_polygon]);
  const activeAssignedTaskUnit = assignedTaskId ? assignedTaskUnit || routeAssignedTaskUnit : null;
  const mapUnits = useMemo(
    () => (activeAssignedTaskUnit ? mergeCbsUnits(units, [activeAssignedTaskUnit]) : units),
    [activeAssignedTaskUnit, units],
  );
  const selectWorkflowKind = useCallback(
    (kind: TaskWorkflowKind) => {
      setWorkflowOverride({ routeKey: routeWorkflowKey, kind });
    },
    [routeWorkflowKey],
  );

  const loadKobuksForMapParcels = useCallback(async (parcels: CbsParcel[]) => {
    try {
      const kobuksUnits = await loadKobuksMapUnitsForParcels(parcels);

      setUnits((current) =>
        mergeCbsUnits(
          current.filter((unit) => unit.origin !== "kobuks"),
          kobuksUnits,
        ),
      );
    } catch {
      // KOBÜKS records are optional map overlays; the parcel layer remains usable.
    }
  }, []);

  const loadParcelsForMapRegion = useCallback(async (region: Region) => {
    const requestId = parcelRequestRef.current + 1;
    parcelRequestRef.current = requestId;

    try {
      const parcels = await loadTkgmParcelsForRegion(region);

      if (requestId === parcelRequestRef.current) {
        setTkgmParcels(parcels);
        void loadKobuksForMapParcels(parcels);
      }
    } catch {
      // Retain the last successful viewport while a network request is unavailable.
    }
  }, [loadKobuksForMapParcels]);

  const refreshMapData = useCallback(async (showSpinner = false) => {
    const requestId = refreshRequestRef.current + 1;
    refreshRequestRef.current = requestId;

    if (showSpinner) {
      setLoading(true);
    }

    try {
      void getTasks()
        .then((taskResult) => {
          if (requestId === refreshRequestRef.current) {
            setWorkflowTasks((taskResult.data || []).filter((task: any) => !isTaskCancelled(task)));
          }
        })
        .catch(() => undefined);
      const [unitResult, parcelResult] = await Promise.allSettled([
        loadCbsUnits({ includeKobuks: false }),
        loadTkgmParcelsForRegion(mapRegionRef.current),
      ]);

      if (requestId !== refreshRequestRef.current) {
        return;
      }

      if (unitResult.status === "rejected") {
        throw unitResult.reason;
      }

      const nextUnits = unitResult.value;
      setUnits(nextUnits);
      if (parcelResult.status === "fulfilled") {
        setTkgmParcels(parcelResult.value);
        void loadKobuksForMapParcels(parcelResult.value);
      }
      setSelectedId((current) => (current && nextUnits.some((unit) => unit.id === current) ? current : null));
      setOffline(false);
      setSearchIssue(null);
      void cacheUnits(nextUnits);
    } catch {
      if (requestId === refreshRequestRef.current) {
        const cached = await loadCachedUnits();
        const fallback = cached?.length ? cached : getBundledCbsUnits();

        setUnits(fallback);
        setSelectedId((current) => (current && fallback.some((unit) => unit.id === current) ? current : null));
        setOffline(true);
      }
    } finally {
      if (requestId === refreshRequestRef.current) {
        setLoading(false);
      }
    }
  }, [loadKobuksForMapParcels]);

  const runCbsSearch = useCallback(async (searchText: string) => {
    const needle = searchText.trim();

    if (needle.length < 2) {
      return;
    }

    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    hasServerSearchRef.current = true;
    setSearching(true);
    setSearchIssue(null);

    try {
      const nextUnits = await loadCbsUnits({ kobuksQuery: needle, kobuksLimit: 120 });

      if (requestId !== searchRequestRef.current) {
        return;
      }

      setUnits(nextUnits);
      setSelectedId((current) => (current && nextUnits.some((unit) => unit.id === current) ? current : null));
      setOffline(false);
      void cacheUnits(nextUnits);
    } catch {
      if (requestId === searchRequestRef.current) {
        setSearchIssue("CBS/KOBÜKS araması tamamlanamadı. Bağlantıyı kontrol edip tekrar deneyin.");
      }
    } finally {
      if (requestId === searchRequestRef.current) {
        setSearching(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshMapData(false);

      return () => {
        refreshRequestRef.current += 1;
        searchRequestRef.current += 1;
        parcelRequestRef.current += 1;
      };
    }, [refreshMapData]),
  );

  useEffect(() => {
    const needle = deferredQuery.trim();

    if (!needle) {
      const timer = setTimeout(() => {
        setSearchIssue(null);
        setSearching(false);

        if (hasServerSearchRef.current) {
          hasServerSearchRef.current = false;
          refreshMapData(false);
        }
      }, 0);

      return () => clearTimeout(timer);
    }

    if (needle.length < 2) {
      return undefined;
    }

    const timer = setTimeout(() => {
      void runCbsSearch(needle);
    }, 300);

    return () => clearTimeout(timer);
  }, [deferredQuery, refreshMapData, runCbsSearch]);

  const filteredUnits = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase("tr-TR");
    if (!needle) return mapUnits;

    return mapUnits.filter((unit) =>
      [
        unit.producerName,
        unit.producerTc,
        unit.producerPhone,
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
  }, [deferredQuery, mapUnits]);

  const visibleUnits = useMemo(() => {
    if (!nearbyMode) {
      return filteredUnits;
    }

    const selectedUnit = mapUnits.find((unit) => unit.id === selectedId);
    const anchor = selectedUnit ? getUnitMapCenter(selectedUnit) : ANTALYA_REGION;

    return [...filteredUnits]
      .sort((first, second) => distanceFrom(anchor, first) - distanceFrom(anchor, second))
      .slice(0, 8);
  }, [filteredUnits, mapUnits, nearbyMode, selectedId]);

  const safeStaffLocations = useMemo(
    () =>
      staffLocations.reduce<(LiveFieldLocation & { latitudeNumber: number; longitudeNumber: number })[]>(
        (validLocations, staff) => {
          const latitudeNumber = Number(staff.latitude);
          const longitudeNumber = Number(staff.longitude);

          if (Number.isFinite(latitudeNumber) && Number.isFinite(longitudeNumber)) {
            validLocations.push({
              ...staff,
              latitudeNumber,
              longitudeNumber,
            });
          }

          return validLocations;
        },
        [],
      ),
    [staffLocations],
  );

  const isAssignedUnit = useCallback((unit: CbsUnit) => {
    if (!assignedTaskId) {
      return false;
    }

    if (activeAssignedTaskUnit) {
      return unit.id === activeAssignedTaskUnit.id;
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
  }, [activeAssignedTaskUnit, assignedAdaNo, assignedParcelNo, assignedTaskId, assignedUnitNo]);

  const selectedUnit = useMemo(() => mapUnits.find((unit) => unit.id === selectedId) || null, [mapUnits, selectedId]);
  const unitWorkflowMap = useMemo(() => {
    const map = new Map<string, Record<TaskWorkflowKind, UnitWorkflowInfo>>();

    mapUnits.forEach((unit) => {
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
  }, [mapUnits, workflowTasks]);
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

  const visibleMapUnits = useMemo(() => {
    const candidates = visibleUnits.filter((unit) =>
      isPolygonVisibleInRegion(
        unit.greenhousePolygon.length >= 3 ? unit.greenhousePolygon : unit.parcelPolygon,
        mapRegion,
      ),
    );

    return candidates
      .sort((first, second) => {
        if (first.id === selectedId) return -1;
        if (second.id === selectedId) return 1;
        return 0;
      })
      .slice(0, MAX_VISIBLE_MAP_UNITS);
  }, [mapRegion, selectedId, visibleUnits]);

  const renderedParcelFeatures = useMemo(() => {
    const features = new Map<
      string,
      {
        key: string;
        polygon: CbsUnit["parcelPolygon"];
        assigned: boolean;
        selected: boolean;
        parcelId?: string;
      }
    >();

    tkgmParcels.forEach((parcel) => {
      if (!isPolygonVisibleInRegion(parcel.polygon, mapRegion)) return;

      const signature = getPolygonSignature(parcel.polygon);

      if (signature && !features.has(signature)) {
        features.set(signature, {
          key: `tkgm-${parcel.id}`,
          polygon: parcel.polygon,
          assigned: false,
          selected: selectedId === `tkgm-parcel-${parcel.id}`,
          parcelId: parcel.id,
        });
      }
    });

    if (activeAssignedTaskUnit?.parcelPolygon.length && isPolygonVisibleInRegion(activeAssignedTaskUnit.parcelPolygon, mapRegion)) {
      const signature = getPolygonSignature(activeAssignedTaskUnit.parcelPolygon);

      if (signature) {
        features.set(signature, {
          key: `assigned-parcel-${activeAssignedTaskUnit.id}`,
          polygon: activeAssignedTaskUnit.parcelPolygon,
          assigned: true,
          selected: selectedId === activeAssignedTaskUnit.id,
        });
      }
    }

    return [...features.values()];
  }, [activeAssignedTaskUnit, mapRegion, selectedId, tkgmParcels]);

  const renderedGreenhouseUnits = useMemo(() => {
    const signatures = new Set<string>();

    return visibleMapUnits.filter((unit) => {
      if (unit.greenhousePolygon.length < 3) {
        return false;
      }
      const signature = getPolygonSignature(unit.greenhousePolygon);

      if (!signature || signatures.has(signature)) {
        return false;
      }

      signatures.add(signature);
      return true;
    });
  }, [visibleMapUnits]);

  const renderedKobuksParcelFeatures = useMemo(() => {
    const features = new Map<string, CbsUnit>();

    visibleMapUnits.forEach((unit) => {
      if (unit.origin !== "kobuks" || unit.parcelPolygon.length < 3) return;
      const parcelKey = getKobuksParcelOverlayKey(unit);
      const existing = features.get(parcelKey);

      if (!existing || selectedId === unit.id) {
        features.set(parcelKey, unit);
      }
    });

    return [...features.values()];
  }, [selectedId, visibleMapUnits]);

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

      const lastKnown = await waitForLocationResult(
        Location.getLastKnownPositionAsync({ maxAge: 60000 }),
        3000,
        "Son konum okunamadı.",
      ).catch(() => null);
      const position =
        lastKnown ||
        (await waitForLocationResult(
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          }),
          10000,
          "Konum isteği zaman aşımına uğradı.",
        ));
      const heading = await waitForLocationResult(
        Location.getHeadingAsync(),
        2500,
        "Pusula verisi alınamadı.",
      ).catch(() => null);
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
    const needle = query.trim();

    if (needle.length >= 2) {
      await runCbsSearch(needle);
      return;
    }

    await refreshMapData(true);
  }, [query, refreshMapData, runCbsSearch]);

  useEffect(() => {
    getMyProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    if (!assignedTaskId) {
      return;
    }

    let active = true;

    getTaskById(assignedTaskId)
      .then((result) => {
        if (!active || result.error || !result.data) {
          return;
        }

        setAssignedTaskUnit(buildAssignedTaskUnit(result.data));
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [assignedTaskId]);

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
      if (
        unit.parcelOnly ||
        (unit.greenhousePolygon.length >= 3 &&
          !isDefaultCbsFallbackPolygon(unit.greenhousePolygon))
      ) {
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
    const center = getUnitMapCenter(unit);

    setSelectedId(unit.id);

    if (animate) {
      mapRef.current?.animateCamera(
        {
          center,
          zoom: 17,
        },
        { duration: 450 },
      );

      if (!unit.parcelOnly && isDefaultCbsFallbackPolygon(unit.greenhousePolygon)) {
        resolveUnitMapCenter(unit).then((resolvedCenter) => {
          const fallbackPolygon = buildFallbackPolygon(resolvedCenter);

          setUnits((current) =>
            current.map((item) =>
              item.id === unit.id
                ? {
                    ...item,
                    parcelPolygon: isDefaultCbsFallbackPolygon(item.parcelPolygon) ? fallbackPolygon : item.parcelPolygon,
                    greenhousePolygon: fallbackPolygon,
                  }
                : item,
            ),
          );
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

  const focusTkgmParcel = useCallback((parcelId: string) => {
    const parcel = tkgmParcels.find((item) => item.id === parcelId);

    if (!parcel) {
      return;
    }

    const parcelUnit = buildTkgmParcelUnit(parcel);

    setUnits((current) =>
      current.some((unit) => unit.id === parcelUnit.id) ? current : [parcelUnit, ...current],
    );
    setSelectedId(parcelUnit.id);
  }, [tkgmParcels]);

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

  function canToggleLayer(nextParcels: boolean, nextGreenhouses: boolean, nextKobuksRecords: boolean) {
    if (!nextParcels && !nextGreenhouses && !nextKobuksRecords) {
      Alert.alert("Katman gerekli", "Haritada en az bir CBS katmanı açık kalmalı.");
      return false;
    }

    return true;
  }

  function toggleGreenhouses() {
    const nextValue = !showGreenhouses;
    if (!canToggleLayer(showParcels, nextValue, showKobuksRecords)) {
      return;
    }

    setShowGreenhouses(nextValue);
  }

  function toggleParcels() {
    const nextValue = !showParcels;
    if (canToggleLayer(nextValue, showGreenhouses, showKobuksRecords)) {
      setShowParcels(nextValue);
    }
  }

  function toggleKobuksRecords() {
    const nextValue = !showKobuksRecords;
    if (canToggleLayer(showParcels, showGreenhouses, nextValue)) {
      setShowKobuksRecords(nextValue);
    }
  }

  function closeSelectedUnit() {
    const focusKey = activeAssignedTaskUnit && assignedTaskId
      ? `${assignedTaskId}:${activeAssignedTaskUnit.id}`
      : "";

    if (focusKey && selectedId === activeAssignedTaskUnit?.id) {
      dismissedAssignedTaskFocusRef.current = focusKey;
    }

    setSelectedId(null);
  }

  useEffect(() => {
    if (!activeAssignedTaskUnit || !assignedTaskId) {
      return;
    }

    const focusKey = `${assignedTaskId}:${activeAssignedTaskUnit.id}`;

    if (
      assignedTaskFocusRef.current === focusKey ||
      dismissedAssignedTaskFocusRef.current === focusKey
    ) {
      return;
    }

    assignedTaskFocusRef.current = focusKey;

    const timer = setTimeout(() => focusUnit(activeAssignedTaskUnit), 0);
    return () => clearTimeout(timer);
  }, [activeAssignedTaskUnit, assignedTaskId, focusUnit]);

  useEffect(() => {
    if (
      activeAssignedTaskUnit ||
      !mapUnits.length ||
      (!assignedUnitNo && !assignedAdaNo && !assignedParcelNo)
    ) {
      return;
    }

    const match = mapUnits.find(
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
  }, [assignedAdaNo, assignedParcelNo, activeAssignedTaskUnit, assignedUnitNo, focusUnit, mapUnits]);

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

        const unitForInspection = await getUnitWithResolvedCenter(unit);
        const result = await startInspectionFromUnit(unitForInspection, "Sahada", activeWorkflowKind);

        if (result.task?.id) {
          router.push(`/task/${result.task.id}` as any);
        }
        return;
      }

      const unitForTask = await getUnitWithResolvedCenter(unit);
      const center = getUnitMapCenter(unitForTask);

      router.push({
        pathname: "/new-task",
        params: {
          workflow: activeWorkflowKind,
          tc_no: unitForTask.producerTc,
          producer_name: unitForTask.producerName,
          phone: unitForTask.producerPhone || "",
          city: unitForTask.city,
          district_name: unitForTask.district,
          village: unitForTask.village,
          ada_no: unitForTask.adaNo,
          parcel_no: unitForTask.parcelNo,
          detected_crop: unitForTask.crop,
          unit_no: unitForTask.unitNo,
          greenhouse_area: String(unitForTask.greenhouseArea || ""),
          latitude: String(center.latitude),
          longitude: String(center.longitude),
          parcel_polygon: JSON.stringify(unitForTask.parcelPolygon),
          greenhouse_polygon: JSON.stringify(unitForTask.greenhousePolygon),
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
          <Text style={styles.subtitle}>Harita hareket ettikçe görünür alandaki TKGM parselleri ve bağlı sera kayıtları otomatik yüklenir.</Text>
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
          {searching ? <ActivityIndicator color="white" size="small" /> : <MaterialCommunityIcons name="refresh" color="white" size={20} />}
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
            {searching
              ? "CBS/KOBÜKS aranıyor"
              : `${renderedUnits.length}/${visibleUnits.length} ünite çiziliyor${nearbyMode ? " · yakındaki görünüm" : ""}`}
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

      {searchIssue ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>{searchIssue}</Text>
        </View>
      ) : null}

      {!offline && !tkgmParcels.length ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            Bu harita alanı için henüz içe aktarılmış TKGM parseli yok. Yetkili Aksu parsel aktarımı tamamlandığında görünür alandaki parseller otomatik görünür.
          </Text>
        </View>
      ) : null}

      {assignedTaskId ? (
        <View style={styles.assignedNotice}>
          <MaterialCommunityIcons name="map-marker-check-outline" color="#bfdbfe" size={18} />
          <Text style={styles.assignedNoticeText}>
            Size atanan görev sarı renkle vurgulandı. Parsel ve varsa sera poligonuna odaklanıldı.
          </Text>
        </View>
      ) : null}

      <View style={styles.mapCard}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={mapRegion}
          onRegionChangeComplete={(region) => {
            mapRegionRef.current = region;
            setMapRegion(region);
            if (parcelLoadTimerRef.current) {
              clearTimeout(parcelLoadTimerRef.current);
            }
            parcelLoadTimerRef.current = setTimeout(() => {
              void loadParcelsForMapRegion(region);
            }, 350);
          }}
          scrollEnabled
          zoomEnabled
          zoomControlEnabled
          rotateEnabled
          showsCompass
          mapType={showGoogleSatellite ? "satellite" : "standard"}
        >
          {showParcels
            ? renderedParcelFeatures.map((feature) => {
                const openParcelCard = () => {
                  if (feature.parcelId) {
                    focusTkgmParcel(feature.parcelId);
                  }
                };

                return (
                  <Polygon
                    key={feature.key}
                    coordinates={feature.polygon}
                    strokeColor={feature.assigned ? "#facc15" : "#38bdf8"}
                    fillColor={feature.assigned ? "rgba(250,204,21,0.28)" : "rgba(56,189,248,0.10)"}
                    strokeWidth={feature.assigned || feature.selected ? 3 : 1.5}
                    tappable={Boolean(feature.parcelId)}
                    onPress={openParcelCard}
                  />
                );
              })
            : null}
          {renderedGreenhouseUnits.map((unit) => {
            const assigned = isAssignedUnit(unit);
            const selected = selectedId === unit.id;
            const workflowState = unitWorkflowMap.get(unit.id)?.[activeWorkflowKind]?.state || "empty";
            const unitColor = assigned ? "#facc15" : WORKFLOW_STATE_COLOR[workflowState];
            const unitFillColor = assigned ? "rgba(250,204,21,0.38)" : WORKFLOW_STATE_FILL[workflowState];
            const openUnitCard = () => focusUnit(unit, false);

            return (
              <Fragment key={unit.id}>
                {showGreenhouses ? (
                  <Polygon
                    key={`greenhouse-${unit.id}-${activeWorkflowKind}-${workflowState}-${selected ? "selected" : "normal"}`}
                    coordinates={unit.greenhousePolygon}
                    strokeColor={unitColor}
                    fillColor={unitFillColor}
                    strokeWidth={assigned || selected ? 3 : 2}
                    tappable
                    onPress={openUnitCard}
                  />
                ) : null}
              </Fragment>
            );
          })}
          {showKobuksRecords
            ? renderedKobuksParcelFeatures.map((unit) => {
                const selectKobuksRecord = () => setSelectedId(unit.id);

                return (
                  <Polygon
                    key={`kobuks-parcel-${unit.id}`}
                    coordinates={unit.parcelPolygon}
                    strokeColor="#a855f7"
                    fillColor="rgba(168,85,247,0.04)"
                    strokeWidth={selectedId === unit.id ? 3 : 2}
                    tappable
                    onPress={selectKobuksRecord}
                  />
                );
              })
            : null}
          {showQgisLabels
            ? renderedUnits.map((unit) => {
                const label = getQgisStatusLabel(unit);

                if (!label) {
                  return null;
                }

                return (
                  <Marker
                    key={`${unit.id}-qgis-puan`}
                    coordinate={getUnitMapCenter(unit)}
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
            ? safeStaffLocations.map((staff) => (
                <Marker
                  key={`staff-${staff.user_id}`}
                  coordinate={{
                    latitude: staff.latitudeNumber,
                    longitude: staff.longitudeNumber,
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
                <View>
                  <Text style={styles.layerPanelTitle}>Harita katmanları</Text>
                  <Text style={styles.layerPanelSubtitle}>Görünür alan için canlı yönetim</Text>
                </View>
                <View style={styles.layerPanelBadge}>
                  <MaterialCommunityIcons name="layers-triple-outline" color="#bbf7d0" size={15} />
                  <Text style={styles.layerPanelCount}>CANLI</Text>
                </View>
              </View>
              <ScrollView style={styles.layerPanelScroll} contentContainerStyle={styles.layerPanelScrollContent} nestedScrollEnabled>
              <LayerGroupLabel label="ALTLIK VE KADASTRO" />
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
                active={showParcels}
                color="#38bdf8"
                icon="vector-polygon"
                title="TKGM Parseller (yaklaşık)"
                subtitle={`${renderedParcelFeatures.length}/${tkgmParcels.length} parsel · kamu verisi hassasiyeti düşürülmüş`}
                onPress={toggleParcels}
              />
              <LayerGroupLabel label="ÜRETİM KAYITLARI" />
              <LayerPanelRow
                active={showGreenhouses}
                color="#22c55e"
                icon="greenhouse"
                title="Sera Poligonları"
                subtitle={`${renderedGreenhouseUnits.length} görünür üretim alanı`}
                onPress={toggleGreenhouses}
              />
              <LayerPanelRow
                active={showKobuksRecords}
                color="#a855f7"
                icon="database-marker-outline"
                title="KOBÜKS Kayıt Parselleri"
                subtitle={String(renderedKobuksParcelFeatures.length) + " benzersiz parsel · mor sınır"}
                onPress={toggleKobuksRecords}
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
              <LayerGroupLabel label="SAHA İŞLEMLERİ" />
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
                subtitle={`${safeStaffLocations.length} aktif konum`}
                onPress={() => {
                  setShowStaffLocations((value) => !value);
                }}
              />
              <LayerGroupLabel label="İŞ AKIŞI AÇIKLAMASI" />
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
              <Pressable onPress={closeSelectedUnit} style={styles.selectedUnitClose}>
                <MaterialCommunityIcons name="close" color="#cbd5e1" size={18} />
              </Pressable>
            </View>
            <Text style={styles.selectedUnitText} numberOfLines={1}>
              {fixMojibake(selectedUnit.producerName || "-")} · {fixMojibake(selectedUnit.crop || "-")}
            </Text>
            <Text style={styles.selectedUnitMeta} numberOfLines={1}>
              {fixMojibake(selectedUnit.district || "-")} / {fixMojibake(selectedUnit.village || "-")} · {fixMojibake(selectedUnit.adaNo || "-")}/{fixMojibake(selectedUnit.parcelNo || "-")}
            </Text>
            {isAssignedUnit(selectedUnit) ? (
              <View style={styles.assignedUnitBadge}>
                <MaterialCommunityIcons name="crosshairs-gps" color="#422006" size={15} />
                <Text style={styles.assignedUnitBadgeText}>Sizin saha göreviniz — sarı poligon</Text>
              </View>
            ) : null}
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
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function distanceFrom(anchor: { latitude: number; longitude: number }, unit: CbsUnit) {
  const center = getUnitMapCenter(unit);
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

function LayerGroupLabel({ label }: { label: string }) {
  return <Text style={styles.layerGroupLabel}>{label}</Text>;
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
    zIndex: 12,
    elevation: 12,
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
  assignedUnitBadge: {
    minHeight: 30,
    borderRadius: 8,
    backgroundColor: "#fde68a",
    borderWidth: 1,
    borderColor: "#facc15",
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  assignedUnitBadgeText: {
    color: "#422006",
    fontSize: 11,
    fontWeight: "900",
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
    gap: 8,
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
    width: 268,
    maxHeight: 472,
    borderRadius: 14,
    backgroundColor: "rgba(15,23,42,0.98)",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.42)",
    padding: 12,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.32,
    shadowRadius: 14,
    elevation: 9,
  },
  layerPanelScroll: {
    maxHeight: 394,
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
    paddingBottom: 7,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.18)",
  },
  layerPanelTitle: {
    color: "white",
    fontWeight: "900",
    fontSize: 14,
  },
  layerPanelSubtitle: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
  layerPanelBadge: {
    minHeight: 26,
    borderRadius: 13,
    backgroundColor: "rgba(22,163,74,0.18)",
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.46)",
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  layerPanelCount: {
    color: "#bbf7d0",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  layerGroupLabel: {
    color: "#7dd3fc",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginTop: 4,
    marginLeft: 3,
  },
  layerPanelRow: {
    minHeight: 54,
    borderRadius: 10,
    backgroundColor: "rgba(17,24,39,0.96)",
    borderWidth: 1,
    borderColor: "rgba(30,41,59,0.95)",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 9,
  },
  layerLegendRow: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: "rgba(17,24,39,0.72)",
    borderWidth: 1,
    borderColor: "rgba(30,41,59,0.78)",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 9,
  },
  layerSymbol: {
    width: 32,
    height: 32,
    borderRadius: 10,
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
    fontWeight: "900",
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
