import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { canUseManagementScreens, getMyProfile } from "../../services/profile";
import {
  createQFieldFeedbackGeoPackage,
  inspectQFieldGeoPackage,
  loadQFieldUnmatchedRecords,
  loadLatestQFieldBatchId,
  loadLatestQFieldExportRecords,
  resolveQFieldUnit,
  saveQFieldImport,
  searchKobuksUnits,
  type QFieldImportPreview,
  type QFieldUnmatchedRecord,
} from "../../services/qfieldGeoPackage";

export default function QFieldTransferScreen() {
  const [preview, setPreview] = useState<QFieldImportPreview | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<QFieldUnmatchedRecord[]>([]);

  useEffect(() => {
    let active = true;
    loadLatestQFieldBatchId()
      .then(async (latestId) => {
        if (!latestId || !active) return;
        const records = await loadQFieldUnmatchedRecords(latestId);
        if (active) {
          setBatchId(latestId);
          setUnmatched(records);
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function allowed() {
    const profile = await getMyProfile();
    if (!canUseManagementScreens(profile) || profile?.is_active !== true || profile?.status === "passive") {
      Alert.alert("Yetki gerekli", "QField dosya aktarımını yalnızca yönetici ve müdür rolleri kullanabilir.");
      return false;
    }
    return true;
  }

  async function chooseFile() {
    if (!(await allowed())) return;
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["application/geopackage+sqlite3", "application/octet-stream", "*/*"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    setWorking(true);
    setMessage("");
    setPreview(null);
    try {
      const result = await inspectQFieldGeoPackage(new File(picked.assets[0].uri));
      setPreview(result);
      setMessage("Dosya incelendi. Veriyi ancak aktar düğmesiyle Supabase’e kaydedersiniz.");
    } catch (error: any) {
      Alert.alert("Dosya okunamadı", error?.message || "GeoPackage incelenemedi.");
    } finally {
      setWorking(false);
    }
  }

  async function importFile() {
    if (!preview || !(await allowed())) return;
    setWorking(true);
    try {
      const savedBatchId = await saveQFieldImport(preview);
      setBatchId(savedBatchId);
      setPreview({ ...preview, duplicateBatchId: "imported" });
      setUnmatched(await loadQFieldUnmatchedRecords(savedBatchId));
      setMessage("Aktarım tamamlandı. Eşleşmeyen kayıtlar ayrı tutuldu; otomatik birleştirme yapılmadı.");
      Alert.alert("Aktarım tamamlandı", `${preview.featureCount} sınıflandırma kaydı güvenli alan listesiyle kaydedildi.`);
    } catch (error: any) {
      Alert.alert("Aktarım başarısız", error?.message || "Kayıtlar kaydedilemedi.");
    } finally {
      setWorking(false);
    }
  }

  async function exportFile() {
    if (!(await allowed())) return;
    setWorking(true);
    try {
      const records = await loadLatestQFieldExportRecords();
      const file = await createQFieldFeedbackGeoPackage(records);
      if (!(await Sharing.isAvailableAsync())) throw new Error("Bu cihazda dosya paylaşımı kullanılamıyor.");
      await Sharing.shareAsync(file.uri, { mimeType: "application/geopackage+sqlite3", UTI: "org.geopackage.sqlite3" });
      setMessage(`${records.length} kayıt ayrı KOBÜDS geri bildirim katmanı olarak dışa aktarıldı.`);
    } catch (error: any) {
      Alert.alert("Dışa aktarma başarısız", error?.message || "GeoPackage oluşturulamadı.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>Yerel dosya alışverişi</Text>
      <Text style={styles.title}>QField aktarımı</Text>
      <Text style={styles.body}>QField’den alınan GeoPackage’ı seçip önizleyin. KOBÜDS sınıflandırması isteğe bağlıdır; dışa aktarım QField’in mevcut verisini değiştirmeyen ayrı bir geri bildirim katmanı üretir.</Text>

      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Veri sahipliği</Text>
        <Text style={styles.body}>Sera geometrisi ve saha sınıflandırması QField kaynağında kalır. KOBÜKS kimliği ve KOBÜDS görev durumu ayrı alanlarda paylaşılır. Eşleşmeyen kayıtlar otomatik bağlanmaz. “Sahibi” ve serbest not alanları aktarılmaz.</Text>
      </View>

      <Pressable disabled={working} onPress={chooseFile} style={styles.button}>
        {working ? <ActivityIndicator color="white" /> : <MaterialCommunityIcons name="folder-open-outline" color="white" size={20} />}
        <Text style={styles.buttonText}>GeoPackage seç ve incele</Text>
      </Pressable>

      {preview ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{preview.fileName}</Text>
          <Text style={styles.body}>Katman: {preview.sourceLayer} · SHA-256 ile tekrar aktarım kontrolü</Text>
          <View style={styles.stats}>
            <Metric label="Kayıt" value={preview.featureCount} />
            <Metric label="Eşleşen" value={preview.matchedCount} />
            <Metric label="Eşleşmeyen" value={preview.unmatchedCount} />
            <Metric label="Kimliksiz" value={preview.missingIdentifierCount} />
          </View>
          {preview.duplicateBatchId ? <Text style={styles.warning}>Bu dosya zaten aktarılmış veya bu ekranda aktarımı tamamlanmış.</Text> : null}
          <Pressable disabled={working || !!preview.duplicateBatchId} onPress={importFile} style={[styles.button, styles.secondary, (!!preview.duplicateBatchId || working) && styles.disabled]}>
            <Text style={styles.buttonText}>Önizlemeyi Supabase’e aktar</Text>
          </Pressable>
        </View>
      ) : null}

      {batchId && unmatched.length ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Elle eşleştirme ({unmatched.length})</Text>
          <Text style={styles.body}>Her eşleştirme kullanıcı seçimiyle kaydedilir. Seçmeden bırakılan kayıtlar eşleşmeden kalır.</Text>
          {unmatched.slice(0, 100).map((record) => (
            <UnmatchedCard
              key={record.id}
              record={record}
              onResolved={(id) => setUnmatched((current) => current.filter((item) => item.id !== id))}
            />
          ))}
          {unmatched.length > 100 ? <Text style={styles.warning}>İlk 100 eşleşmeyen kayıt gösteriliyor; kalanlar eşleşmeden tutuldu.</Text> : null}
        </View>
      ) : null}

      <Pressable disabled={working} onPress={exportFile} style={[styles.button, styles.export]}>
        {working ? <ActivityIndicator color="white" /> : <MaterialCommunityIcons name="export-variant" color="white" size={20} />}
        <Text style={styles.buttonText}>Son aktarımı QField için dışa ver</Text>
      </Pressable>

      {message ? <Text style={styles.message}>{message}</Text> : null}
    </ScrollView>
  );
}

function UnmatchedCard({ record, onResolved }: { record: QFieldUnmatchedRecord; onResolved: (id: string) => void }) {
  const [query, setQuery] = useState(record.unit_no || "");
  const [candidates, setCandidates] = useState<{ id: number; unit_no: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchKobuksUnits(query).then(setCandidates).catch(() => setCandidates([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  async function selectCandidate(candidate: { id: number; unit_no: string }) {
    setBusy(true);
    try {
      await resolveQFieldUnit(record.id, candidate.id);
      onResolved(record.id);
    } catch (error: any) {
      Alert.alert("Eşleştirme kaydedilemedi", error?.message || "Kayıt güncellenemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.unmatchedCard}>
      <Text style={styles.unmatchedTitle}>QField fid {record.source_fid} · {record.unit_no || "Ünite no yok"}</Text>
      <Text style={styles.metricLabel}>QField kimliği: {record.qfield_id || "yok"}</Text>
      <TextInput value={query} onChangeText={setQuery} placeholder="KOBÜKS ünite numarası ara" placeholderTextColor="#64748b" style={styles.searchInput} />
      {candidates.map((candidate) => (
        <Pressable key={candidate.id} disabled={busy} onPress={() => selectCandidate(candidate)} style={styles.candidate}>
          <Text style={styles.candidateText}>{candidate.unit_no}</Text>
          {busy ? <ActivityIndicator color="#86efac" /> : null}
        </Pressable>
      ))}
      {query.trim().length >= 2 && !candidates.length ? <Text style={styles.metricLabel}>Eşleşen KOBÜKS ünitesi bulunamadı.</Text> : null}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#020617" },
  content: { padding: 20, paddingBottom: 60, gap: 14 },
  kicker: { color: "#4ade80", fontSize: 13, fontWeight: "800", textTransform: "uppercase" },
  title: { color: "white", fontSize: 30, fontWeight: "800" },
  body: { color: "#cbd5e1", lineHeight: 21 },
  notice: { backgroundColor: "#0f172a", borderColor: "#334155", borderWidth: 1, borderRadius: 10, padding: 16, gap: 8 },
  noticeTitle: { color: "white", fontWeight: "800", fontSize: 17 },
  card: { backgroundColor: "#0f172a", borderColor: "#334155", borderWidth: 1, borderRadius: 10, padding: 16, gap: 12 },
  cardTitle: { color: "white", fontSize: 17, fontWeight: "800" },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: { minWidth: "46%", flexGrow: 1, padding: 12, borderRadius: 8, backgroundColor: "#1e293b" },
  metricValue: { color: "white", fontSize: 22, fontWeight: "800" },
  metricLabel: { color: "#94a3b8", marginTop: 3 },
  button: { minHeight: 52, backgroundColor: "#15803d", borderRadius: 9, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 9, paddingHorizontal: 14 },
  secondary: { backgroundColor: "#0369a1" },
  export: { backgroundColor: "#475569" },
  disabled: { opacity: 0.45 },
  buttonText: { color: "white", fontWeight: "800", textAlign: "center" },
  warning: { color: "#fbbf24", lineHeight: 20 },
  unmatchedCard: { padding: 12, borderRadius: 8, backgroundColor: "#1e293b", gap: 8 },
  unmatchedTitle: { color: "white", fontWeight: "700" },
  searchInput: { minHeight: 44, borderWidth: 1, borderColor: "#475569", borderRadius: 7, paddingHorizontal: 12, color: "white" },
  candidate: { minHeight: 44, paddingHorizontal: 12, borderRadius: 7, backgroundColor: "#064e3b", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  candidateText: { color: "white", fontWeight: "700" },
  message: { color: "#86efac", lineHeight: 20 },
});
