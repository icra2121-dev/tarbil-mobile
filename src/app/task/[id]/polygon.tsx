import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polygon, type MapPressEvent } from "react-native-maps";

import { BottomTabMenu } from "../../../components/BottomTabMenu";
import {
  ANTALYA_REGION,
  getCenter,
  loadCbsUnits,
  parsePolygon,
  type CbsUnit,
  type MapPoint,
} from "../../../services/cbs";
import { updateTaskOnlineOrQueue } from "../../../services/offline";
import { getTaskById } from "../../../services/taskDetail";

const MAX_POLYGON_DISTANCE_METERS = 350;
const SAVED_POLYGON_CENTER_TOLERANCE_METERS = 140;
const SAVED_POLYGON_OVERFLOW_RATIO = 1.8;
const POLYGON_CONTEXT_LIMIT = 36;

function singleParam(value: unknown) {
  return String(Array.isArray(value) ? value[0] : value || "");
}

function normalizePoint(point: MapPoint, index: number) {
  return {
    corner: index + 1,
    latitude: Number(point.latitude.toFixed(8)),
    longitude: Number(point.longitude.toFixed(8)),
  };
}

function formatPoint(point: MapPoint, index: number) {
  return `${index + 1}. ${point.latitude.toFixed(8)}, ${point.longitude.toFixed(8)}`;
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

function formatAreaLabel(value: number) {
  if (!value) {
    return "0 m²";
  }

  return `${Math.round(value).toLocaleString("tr-TR")} m²`;
}

function getPolygonRadiusMeters(center: MapPoint, polygon: MapPoint[]) {
  return polygon.reduce((maxDistance, point) => Math.max(maxDistance, distanceMeters(center, point)), 0);
}

function isSavedPolygonUnsafe(savedPolygon: MapPoint[], referencePolygon: MapPoint[]) {
  if (savedPolygon.length < 3 || referencePolygon.length < 3) {
    return false;
  }

  const referenceCenter = getCenter(referencePolygon);
  const savedCenter = getCenter(savedPolygon);
  const referenceRadius = Math.max(getPolygonRadiusMeters(referenceCenter, referencePolygon), 15);
  const savedRadius = getPolygonRadiusMeters(referenceCenter, savedPolygon);
  const referenceArea = calculatePolygonArea(referencePolygon);
  const savedArea = calculatePolygonArea(savedPolygon);
  const centerLimit = Math.max(SAVED_POLYGON_CENTER_TOLERANCE_METERS, referenceRadius * 1.75);
  const radiusLimit = Math.max(MAX_POLYGON_DISTANCE_METERS, referenceRadius * 2.4);
  const areaLimit = Math.max(referenceArea * SAVED_POLYGON_OVERFLOW_RATIO, referenceArea + 700);
  const minimumAreaLimit = referenceArea > 120 ? referenceArea * 0.22 : 0;

  return (
    distanceMeters(referenceCenter, savedCenter) > centerLimit ||
    savedRadius > radiusLimit ||
    (referenceArea > 0 && savedArea > areaLimit) ||
    (minimumAreaLimit > 0 && savedArea < minimumAreaLimit)
  );
}

function getSafeInitialPolygon(task: any, units: CbsUnit[]) {
  const taskCenter =
    task?.latitude && task?.longitude
      ? { latitude: Number(task.latitude), longitude: Number(task.longitude) }
      : { latitude: ANTALYA_REGION.latitude, longitude: ANTALYA_REGION.longitude };
  const taskUnit = findTaskUnit(task, units);
  const referencePolygon = taskUnit?.greenhousePolygon || [];
  let nextPoints: MapPoint[] = [];
  let corrected = false;

  if (task?.greenhouse_polygon) {
    nextPoints = parsePolygon(task.greenhouse_polygon, taskCenter);
  } else {
    const descriptionPoints = parseDescriptionPolygon(task?.description);

    if (descriptionPoints.length >= 3) {
      nextPoints = descriptionPoints;
    }
  }

  if (referencePolygon.length >= 3 && (!nextPoints.length || isSavedPolygonUnsafe(nextPoints, referencePolygon))) {
    corrected = nextPoints.length >= 3;
    nextPoints = referencePolygon;
  }

  return { corrected, points: nextPoints };
}

function hasMeaningfulUnitValue(value: unknown) {
  const text = String(value || "").trim();

  return Boolean(text && text !== "-" && text.toLocaleLowerCase("tr-TR") !== "null");
}

function findTaskUnit(task: any, units: CbsUnit[]) {
  return units.find((unit) => {
    if (task?.greenhouse_unit_id && String(unit.greenhouseUnitId) === String(task.greenhouse_unit_id)) return true;
    if (task?.cbs_unit_id && String(unit.cbsUnitId) === String(task.cbs_unit_id)) return true;
    if (hasMeaningfulUnitValue(task?.unit_no) && hasMeaningfulUnitValue(unit.unitNo) && String(unit.unitNo) === String(task.unit_no)) return true;

    return (
      hasMeaningfulUnitValue(task?.ada_no) &&
      hasMeaningfulUnitValue(task?.parcel_no) &&
      hasMeaningfulUnitValue(unit.adaNo) &&
      hasMeaningfulUnitValue(unit.parcelNo) &&
      String(unit.adaNo) === String(task.ada_no) &&
      String(unit.parcelNo) === String(task.parcel_no)
    );
  });
}

function getReferenceCenter(task: any, units: CbsUnit[], points: MapPoint[]) {
  const taskUnit = findTaskUnit(task, units);

  if (taskUnit?.greenhousePolygon?.length) {
    return getCenter(taskUnit.greenhousePolygon);
  }

  if (points.length) {
    return getCenter(points);
  }

  if (task?.latitude && task?.longitude) {
    return {
      latitude: Number(task.latitude),
      longitude: Number(task.longitude),
    };
  }

  return null;
}

function stripPolygonDescription(description: unknown) {
  const lines = String(description || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const nextLines: string[] = [];
  let skippingCoordinates = false;

  lines.forEach((line) => {
    const normalized = line.toLocaleLowerCase("tr-TR");

    if (normalized.startsWith("cbs köşe koordinatları:")) {
      skippingCoordinates = true;
      return;
    }

    if (normalized.startsWith("cbs köşe koordinatları sonu")) {
      skippingCoordinates = false;
      return;
    }

    if (skippingCoordinates || normalized.startsWith("cbs poligonu:") || normalized.startsWith("cbs alanı:")) {
      return;
    }

    nextLines.push(line);
  });

  return nextLines;
}

function mergePolygonDescription(description: unknown, points: MapPoint[]) {
  const coordinateLines = points.map(formatPoint);
  const area = calculatePolygonArea(points);

  return [
    ...stripPolygonDescription(description),
    `CBS Poligonu: ${points.length} köşe`,
    `CBS Alanı: ${formatAreaLabel(area)}`,
    "CBS Köşe Koordinatları:",
    ...coordinateLines,
    "CBS Köşe Koordinatları Sonu",
  ].join("\n");
}

function removePolygonDescription(description: unknown) {
  return stripPolygonDescription(description).join("\n");
}

function parseDescriptionPolygon(description: unknown): MapPoint[] {
  return String(description || "")
    .split("\n")
    .map((line) => {
      const match = line.match(/-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/);

      if (!match) {
        return null;
      }

      const [latitudeText, longitudeText] = match[0].split(",").map((item) => item.trim());
      const latitude = Number(latitudeText);
      const longitude = Number(longitudeText);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }

      return { latitude, longitude };
    })
    .filter((point): point is MapPoint => Boolean(point));
}

function getPolygonFallbackPayload(description: unknown, points: MapPoint[]) {
  const polygonCenter = getCenter(points);
  const area = Math.round(calculatePolygonArea(points));

  return {
    latitude: polygonCenter.latitude,
    longitude: polygonCenter.longitude,
    greenhouse_area: String(area),
    description: mergePolygonDescription(description, points),
  };
}

function getDeleteFallbackPayload(description: unknown) {
  return {
    description: removePolygonDescription(description),
  };
}

type LayerKey =
  | "contextGreenhouses"
  | "selectedPolygon"
  | "selectedCorners"
  | "orthophoto";

const MINISTRY_LAYERS: {
  key: LayerKey;
  title: string;
  subtitle: string;
  color: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  defaultActive: boolean;
  dataBacked: boolean;
}[] = [
  { key: "contextGreenhouses", title: "Yakın Seralar", subtitle: "Seçili ünitenin çevresindeki referans üniteler", color: "#22c55e", icon: "greenhouse", defaultActive: true, dataBacked: true },
  { key: "selectedPolygon", title: "Çizilen Poligon", subtitle: "Sahada seçilen ünite alanı", color: "#16a34a", icon: "vector-polygon", defaultActive: true, dataBacked: true },
  { key: "selectedCorners", title: "Köşe Koordinatları", subtitle: "Seçilen tüm köşe noktaları", color: "#a3e635", icon: "crosshairs-gps", defaultActive: true, dataBacked: true },
  { key: "orthophoto", title: "Ortofoto / Uydu", subtitle: "Google hibrit altlık", color: "#94a3b8", icon: "satellite-variant", defaultActive: false, dataBacked: true },
];

function createDefaultLayerState() {
  return MINISTRY_LAYERS.reduce<Record<LayerKey, boolean>>((state, layer) => {
    state[layer.key] = layer.defaultActive;
    return state;
  }, {} as Record<LayerKey, boolean>);
}

function isUnitLayerVisible(_unit: CbsUnit, layers: Record<LayerKey, boolean>) {
  return layers.contextGreenhouses;
}

function getLayerCount(units: CbsUnit[], key: LayerKey) {
  if (key === "contextGreenhouses") return Math.min(units.length, POLYGON_CONTEXT_LIMIT);
  return 0;
}

function getLayerSubtitle(layer: (typeof MINISTRY_LAYERS)[number], units: CbsUnit[]) {
  const count = getLayerCount(units, layer.key);

  if (layer.dataBacked && count) {
    return `${layer.subtitle} · ${count} kayıt`;
  }

  if (!layer.dataBacked) {
    return `${layer.subtitle} · veri tabanı bağlantısı bekliyor`;
  }

  return layer.subtitle;
}

function getPolygonPayload(description: unknown, points: MapPoint[]) {
  const normalizedPoints = points.map(normalizePoint);
  const polygonCenter = getCenter(normalizedPoints);
  const area = Math.round(calculatePolygonArea(normalizedPoints));

  return {
    greenhouse_polygon: normalizedPoints,
    latitude: polygonCenter.latitude,
    longitude: polygonCenter.longitude,
    greenhouse_area: String(area),
    description: mergePolygonDescription(description, normalizedPoints),
  };
}

function getDeletePayload(description: unknown) {
  return {
    greenhouse_polygon: null,
    description: removePolygonDescription(description),
  };
}

export default function TaskPolygonScreen() {
  const { id } = useLocalSearchParams();
  const taskId = singleParam(id);
  const mapRef = useRef<MapView | null>(null);
  const [task, setTask] = useState<any>(null);
  const [units, setUnits] = useState<CbsUnit[]>([]);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [polygonAutoCorrected, setPolygonAutoCorrected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(() => createDefaultLayerState());
  const taskUnit = useMemo(() => (task ? findTaskUnit(task, units) || null : null), [task, units]);
  const referenceCenter = useMemo(
    () => (taskUnit?.greenhousePolygon?.length ? getCenter(taskUnit.greenhousePolygon) : getReferenceCenter(task, units, points)),
    [points, task, taskUnit, units],
  );
  const polygonArea = useMemo(() => calculatePolygonArea(points), [points]);

  const center = useMemo(() => {
    if (taskUnit?.greenhousePolygon?.length) {
      return getCenter(taskUnit.greenhousePolygon);
    }

    if (points.length) {
      return getCenter(points);
    }

    if (task?.latitude && task?.longitude) {
      return {
        latitude: Number(task.latitude),
        longitude: Number(task.longitude),
      };
    }

    return {
      latitude: ANTALYA_REGION.latitude,
      longitude: ANTALYA_REGION.longitude,
    };
  }, [points, task, taskUnit]);

  const renderedUnits = useMemo(() => {
    return [...units]
      .sort((first, second) => {
        if (taskUnit?.id && first.id === taskUnit.id) return -1;
        if (taskUnit?.id && second.id === taskUnit.id) return 1;
        return distanceMeters(center, getCenter(first.greenhousePolygon)) - distanceMeters(center, getCenter(second.greenhousePolygon));
      })
      .slice(0, POLYGON_CONTEXT_LIMIT);
  }, [center, taskUnit, units]);

  useEffect(() => {
    let active = true;

    Promise.all([getTaskById(taskId), loadCbsUnits().catch(() => [])])
      .then(([result, cbsUnits]) => {
        if (!active) {
          return;
        }

        const nextTask = result.data;
        const initialPolygon = getSafeInitialPolygon(nextTask, cbsUnits);

        setTask(nextTask);
        setUnits(cbsUnits);
        setPoints(initialPolygon.points);
        setPolygonAutoCorrected(initialPolygon.corrected);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [taskId]);

  useEffect(() => {
    if (loading) {
      return undefined;
    }

    const timer = setTimeout(() => {
      mapRef.current?.animateCamera(
        {
          center,
          zoom: taskUnit ? 18 : 16,
        },
        { duration: 450 },
      );
    }, 120);

    return () => clearTimeout(timer);
  }, [center, loading, taskUnit]);

  async function locateMe() {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== "granted") {
      return;
    }

    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const coordinate = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };

    mapRef.current?.animateToRegion(
      {
        ...coordinate,
        latitudeDelta: 0.006,
        longitudeDelta: 0.006,
      },
      350,
    );
  }

  function addPoint(event: MapPressEvent) {
    const coordinate = event.nativeEvent.coordinate;

    if (!Number.isFinite(coordinate.latitude) || !Number.isFinite(coordinate.longitude)) {
      return;
    }

    if (referenceCenter && distanceMeters(referenceCenter, coordinate) > MAX_POLYGON_DISTANCE_METERS) {
      Alert.alert(
        "Poligon çok uzakta",
        "Saha poligonu seçilen ünitenin bulunduğu alana yakın çizilmeli. Haritada ilgili sera çevresinden köşe seçin.",
      );
      return;
    }

    setPoints((current) => [...current, coordinate]);
  }

  function undoPoint() {
    setPoints((current) => current.slice(0, -1));
  }

  function movePoint(index: number, coordinate: MapPoint) {
    if (!Number.isFinite(coordinate.latitude) || !Number.isFinite(coordinate.longitude)) {
      return;
    }

    if (referenceCenter && distanceMeters(referenceCenter, coordinate) > MAX_POLYGON_DISTANCE_METERS) {
      Alert.alert(
        "Poligon çok uzakta",
        "Taşınan köşe seçilen ünitenin bulunduğu alana yakın kalmalı.",
      );
      return;
    }

    setPoints((current) => current.map((point, pointIndex) => (pointIndex === index ? coordinate : point)));
  }

  function toggleLayer(key: LayerKey) {
    setLayers((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  async function savePolygon() {
    if (points.length < 3) {
      Alert.alert("Poligon eksik", "Sera poligonu için en az 3 nokta işaretlenmeli.");
      return;
    }

    if (referenceCenter && points.some((point) => distanceMeters(referenceCenter, point) > MAX_POLYGON_DISTANCE_METERS)) {
      Alert.alert(
        "Poligon çok uzakta",
        "Çizilen köşeler seçilen üniteden çok uzak. Saha poligonunu seranın bulunduğu alana yakın yeniden çizin.",
      );
      return;
    }

    if (taskUnit?.greenhousePolygon?.length && isSavedPolygonUnsafe(points, taskUnit.greenhousePolygon)) {
      Alert.alert(
        "Poligon uyumsuz",
        "Çizilen saha poligonu seçilen ünitenin gerçek alanına göre çok küçük, çok büyük veya uzak görünüyor. Köşe noktalarını sera sınırına göre düzeltin.",
      );
      return;
    }

    setSaving(true);

    try {
      const payload = getPolygonPayload(task?.description, points);
      const fallbackPayload = getPolygonFallbackPayload(task?.description, points);
      const result = await updateTaskOnlineOrQueue(taskId, payload, "CBS poligonu kaydı", fallbackPayload);

      setTask((current: any) => ({
        ...current,
        ...(result.data || payload),
      }));
      setPolygonAutoCorrected(false);

      if (result.queued) {
        Alert.alert("Sıraya alındı", "CBS poligonu internet geldiğinde sisteme aktarılacak.");
      } else {
        Alert.alert("Kaydedildi", "CBS poligonu göreve aktarıldı.");
      }

      router.back();
    } catch (error: any) {
      Alert.alert("Kaydedilemedi", error?.message || "CBS poligonu kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function deletePolygon() {
    if (!points.length && !task?.greenhouse_polygon) {
      return;
    }

    Alert.alert("Poligonu sil", "Çizilen saha poligonu ve kayıtlı köşe koordinatları silinecek.", [
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
            const payload = getDeletePayload(task?.description);
            const fallbackPayload = getDeleteFallbackPayload(task?.description);
            const result = await updateTaskOnlineOrQueue(taskId, payload, "CBS poligonu silme", fallbackPayload);

            setPoints([]);
            setPolygonAutoCorrected(false);
            setTask((current: any) => ({
              ...current,
              ...payload,
            }));

            Alert.alert(
              result.queued ? "Sıraya alındı" : "Silindi",
              result.queued ? "Poligon silme işlemi internet geldiğinde sisteme aktarılacak." : "Çizilen poligon silindi.",
            );
          } catch (error: any) {
            Alert.alert("Silinemedi", error?.message || "CBS poligonu silinemedi.");
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#22c55e" />
        <BottomTabMenu />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: center.latitude,
          longitude: center.longitude,
          latitudeDelta: 0.012,
          longitudeDelta: 0.012,
        }}
        mapType={layers.orthophoto ? "hybrid" : "standard"}
        onPress={addPoint}
      >
        {renderedUnits.map((unit) => {
          const isFocusedUnit = taskUnit?.id === unit.id;
          const color = isFocusedUnit ? "#facc15" : "#22c55e";
          const unitVisible = isFocusedUnit || isUnitLayerVisible(unit, layers);

          return (
            <Fragment key={unit.id}>
              {unitVisible ? (
                <Polygon
                  key={`greenhouse-${unit.id}`}
                  coordinates={unit.greenhousePolygon}
                  strokeColor={color}
                  fillColor={isFocusedUnit ? "rgba(250,204,21,0.22)" : "rgba(34,197,94,0.08)"}
                  strokeWidth={isFocusedUnit ? 4 : 2}
                  tappable={false}
                />
              ) : null}
            </Fragment>
          );
        })}
        {layers.selectedPolygon && points.length >= 3 ? (
          <>
            <Polygon key={`selected-${points.length}`} coordinates={points} strokeColor="#facc15" fillColor="rgba(250,204,21,0.28)" strokeWidth={3} />
            <Marker coordinate={getCenter(points)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={styles.areaMarker}>
                <Text style={styles.areaMarkerText}>{formatAreaLabel(polygonArea)}</Text>
              </View>
            </Marker>
          </>
        ) : null}
        {layers.selectedCorners
          ? points.map((point, index) => (
              <Marker
                key={`${point.latitude}-${point.longitude}-${index}`}
                coordinate={point}
                anchor={{ x: 0.5, y: 0.5 }}
                draggable
                tracksViewChanges={false}
                onDragEnd={(event) => movePoint(index, event.nativeEvent.coordinate)}
              >
                <View style={styles.cornerMarker}>
                  <Text style={styles.cornerMarkerText}>{index + 1}</Text>
                </View>
              </Marker>
            ))
          : null}
      </MapView>

      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.iconButton}>
          <MaterialCommunityIcons name="chevron-left" color="white" size={26} />
        </Pressable>
        <View style={styles.counterPill}>
          <Text style={styles.counterText}>{points.length} nokta{points.length >= 3 ? ` · ${formatAreaLabel(polygonArea)}` : ""}</Text>
        </View>
        <View style={styles.topRightButtons}>
          <Pressable onPress={locateMe} style={styles.iconButton}>
            <MaterialCommunityIcons name="crosshairs-gps" color="white" size={22} />
          </Pressable>
          <Pressable onPress={() => setShowLayerPanel((value) => !value)} style={[styles.iconButton, showLayerPanel && styles.iconButtonActive]}>
            <MaterialCommunityIcons name="layers-outline" color="white" size={22} />
          </Pressable>
        </View>
      </View>

      {taskUnit && !showLayerPanel ? (
        <View style={styles.focusNotice}>
          <MaterialCommunityIcons name="vector-polygon" color="#facc15" size={18} />
          <Text style={styles.focusNoticeText} numberOfLines={2}>
            {taskUnit.unitNo || "Ünite"} odakta. Haritada sarı alan işlem yapılan sera poligonudur.
          </Text>
        </View>
      ) : null}

      {polygonAutoCorrected && !showLayerPanel ? (
        <View style={[styles.focusNotice, styles.correctedNotice]}>
          <MaterialCommunityIcons name="alert-circle-outline" color="#fed7aa" size={18} />
          <Text style={styles.correctedNoticeText} numberOfLines={2}>
            Eski taşmış poligon ünite sınırına çekildi. Kaydet ile görev kaydı güncellenir.
          </Text>
        </View>
      ) : null}

      {showLayerPanel ? (
        <View style={styles.layerPanel}>
          <View style={styles.layerPanelHeader}>
            <Text style={styles.layerPanelTitle}>CBS Katmanları</Text>
            <Text style={styles.layerPanelCount}>{MINISTRY_LAYERS.length} katman</Text>
          </View>
          <ScrollView style={styles.layerList} contentContainerStyle={styles.layerListContent} nestedScrollEnabled>
            {MINISTRY_LAYERS.map((layer) => (
              <LayerRow
                key={layer.key}
                active={layers[layer.key]}
                color={layer.color}
                icon={layer.icon}
                subtitle={getLayerSubtitle(layer, units)}
                title={layer.title}
                onPress={() => toggleLayer(layer.key)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {points.length ? (
        <View style={styles.coordinatePanel}>
          <Text style={styles.coordinateTitle}>Köşe koordinatları</Text>
          {points.slice(0, 5).map((point, index) => (
            <Text key={`${point.latitude}-${point.longitude}-${index}`} style={styles.coordinateText}>
              {formatPoint(point, index)}
            </Text>
          ))}
          {points.length > 5 ? <Text style={styles.coordinateText}>+{points.length - 5} köşe daha</Text> : null}
        </View>
      ) : null}

      <View style={styles.bottomBar}>
        <Pressable onPress={undoPoint} style={[styles.toolbarButton, !points.length && styles.disabledButton]} disabled={!points.length}>
          <MaterialCommunityIcons name="undo" color="white" size={18} />
          <Text style={styles.toolbarText}>Geri Al</Text>
        </Pressable>
        <Pressable onPress={deletePolygon} style={[styles.deleteButton, (!points.length && !task?.greenhouse_polygon) || deleting ? styles.disabledButton : null]} disabled={(!points.length && !task?.greenhouse_polygon) || deleting}>
          <MaterialCommunityIcons name="trash-can-outline" color="white" size={18} />
          <Text style={styles.toolbarText}>{deleting ? "Siliniyor" : "Sil"}</Text>
        </Pressable>
        <Pressable onPress={savePolygon} style={[styles.saveButton, (points.length < 3 || saving) && styles.disabledButton]} disabled={points.length < 3 || saving}>
          <MaterialCommunityIcons name="content-save-outline" color="white" size={18} />
          <Text style={styles.toolbarText}>{saving ? "Kaydediliyor" : "Kaydet"}</Text>
        </Pressable>
      </View>
      <BottomTabMenu />
    </View>
  );
}

function LayerRow({
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
  onPress: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <Pressable onPress={onPress} style={styles.layerRow}>
      <View style={[styles.layerSymbol, { borderColor: color }]}>
        <MaterialCommunityIcons name={icon} color={color} size={17} />
      </View>
      <View style={styles.layerTextWrap}>
        <Text style={styles.layerText}>{title}</Text>
        <Text style={styles.layerSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={[styles.layerSwitch, active && styles.layerSwitchActive]}>
        <View style={[styles.layerSwitchKnob, active && styles.layerSwitchKnobActive]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#020617",
  },
  center: {
    flex: 1,
    backgroundColor: "#020617",
    alignItems: "center",
    justifyContent: "center",
  },
  map: {
    flex: 1,
  },
  areaMarker: {
    minHeight: 30,
    borderRadius: 8,
    backgroundColor: "rgba(15,23,42,0.88)",
    borderWidth: 1,
    borderColor: "rgba(250,204,21,0.85)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  areaMarkerText: {
    color: "#fef9c3",
    fontSize: 12,
    fontWeight: "900",
  },
  cornerMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#ca8a04",
    borderWidth: 2,
    borderColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  cornerMarkerText: {
    color: "white",
    fontSize: 11,
    fontWeight: "900",
  },
  topBar: {
    position: "absolute",
    top: 48,
    left: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: "rgba(15,23,42,0.82)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonActive: {
    borderWidth: 1,
    borderColor: "#22c55e",
  },
  topRightButtons: {
    flexDirection: "row",
    gap: 8,
  },
  counterPill: {
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: "rgba(15,23,42,0.82)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  counterText: {
    color: "white",
    fontWeight: "800",
  },
  focusNotice: {
    position: "absolute",
    top: 102,
    left: 14,
    right: 14,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: "rgba(113,63,18,0.88)",
    borderWidth: 1,
    borderColor: "rgba(250,204,21,0.58)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  focusNoticeText: {
    flex: 1,
    color: "#fef9c3",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  correctedNotice: {
    top: 154,
    backgroundColor: "rgba(67,20,7,0.9)",
    borderColor: "rgba(251,146,60,0.62)",
  },
  correctedNoticeText: {
    flex: 1,
    color: "#fed7aa",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  layerPanel: {
    position: "absolute",
    top: 102,
    right: 14,
    width: 292,
    maxHeight: "62%",
    borderRadius: 8,
    backgroundColor: "rgba(15,23,42,0.96)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    padding: 10,
    gap: 8,
  },
  layerPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  layerPanelTitle: {
    color: "white",
    fontWeight: "800",
  },
  layerPanelCount: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "800",
  },
  layerList: {
    maxHeight: 430,
  },
  layerListContent: {
    gap: 8,
    paddingBottom: 2,
  },
  layerRow: {
    minHeight: 52,
    borderRadius: 8,
    backgroundColor: "rgba(17,24,39,0.92)",
    borderWidth: 1,
    borderColor: "rgba(30,41,59,0.95)",
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
  layerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  layerText: {
    color: "white",
    fontSize: 12,
    fontWeight: "800",
  },
  layerSubtitle: {
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
  coordinatePanel: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 154,
    borderRadius: 8,
    backgroundColor: "rgba(15,23,42,0.9)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.25)",
    padding: 10,
    gap: 3,
  },
  coordinateTitle: {
    color: "white",
    fontSize: 12,
    fontWeight: "800",
  },
  coordinateText: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "700",
  },
  bottomBar: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 96,
    flexDirection: "row",
    gap: 8,
  },
  toolbarButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  deleteButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "#991b1b",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  saveButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  disabledButton: {
    opacity: 0.55,
  },
  toolbarText: {
    color: "white",
    fontWeight: "800",
  },
});
