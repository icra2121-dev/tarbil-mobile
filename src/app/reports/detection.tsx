import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { buildOfficialEk8Html, type Ek8Source } from "../../services/ek8Template";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "../../lib/supabase";

type Point = { latitude: number; longitude: number; accuracy: number; photo_uri: string; captured_at: string };
const fields: [string,string][] = [["province","İl"],["district","İlçe"],["neighborhood","Mahalle"],["block_no","Ada numarası"],["parcel_no","Parsel numarası"],["product","Ürün"],["harvest_start","Hasat başlangıç tarihi"],["harvest_end","Hasat bitiş tarihi"]];

export default function DetectionReportScreen() {
  const [data,setData]=useState<Record<string,string>>({}); const [points,setPoints]=useState<Point[]>([]); const [targetCount,setTargetCount]=useState(4); const [busy,setBusy]=useState(false);
  async function capturePoint(){
    if(points.length>=targetCount){Alert.alert("Nokta sayısı tamam","Seçilen sayıda GPS fotoğrafı kaydedildi.");return;}
    setBusy(true);try{
      const permission=await ImagePicker.requestCameraPermissionsAsync(); if(!permission.granted)throw new Error("Fotoğraf için kamera izni gerekli.");
      const gpsPermission=await Location.requestForegroundPermissionsAsync(); if(!gpsPermission.granted)throw new Error("Gerçek koordinat almak için konum izni gerekli.");
      const position=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});
      if(!Number.isFinite(position.coords.latitude)||!Number.isFinite(position.coords.longitude)||position.coords.accuracy===null||position.coords.accuracy>30)throw new Error("GPS doğruluğu 30 metrenin dışında. Daha iyi GPS sinyali olan bir yerde tekrar deneyin.");
      const photo=await ImagePicker.launchCameraAsync({mediaTypes:["images"],quality:0.82,exif:true}); if(photo.canceled||!photo.assets?.[0]?.uri)return;
      setPoints((old)=>[...old,{latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,photo_uri:photo.assets[0].uri,captured_at:new Date().toISOString()}]);
    }catch(e:any){Alert.alert("Koordinat alınamadı",e?.message||"Gerçek GPS koordinatı alınamadı.");}finally{setBusy(false);}
  }
  async function createReport(){
    const missing=fields.filter(([key])=>!data[key]?.trim()); if(missing.length){Alert.alert("Bilgiler eksik",`Doldurun: ${missing.map(([,label])=>label).join(", ")}`);return;}
    if(points.length!==targetCount){Alert.alert("Koordinat sayısı eksik",`Seçilen ${targetCount} noktanın tamamı için fotoğraf ve GPS koordinatı alın.`);return;}
    setBusy(true);try{
      const {data:userData}=await supabase.auth.getUser(); if(!userData.user)throw new Error("Oturum bulunamadı.");
      const photoUrls=await Promise.all(points.map(async(p,i)=>{const response=await fetch(p.photo_uri);const blob=await response.blob();const path=`standalone-detection/${userData.user!.id}/${Date.now()}-${i}.jpg`;const upload=await supabase.storage.from("task-evidence").upload(path,blob,{contentType:"image/jpeg",upsert:false});if(upload.error)throw upload.error;return supabase.storage.from("task-evidence").getPublicUrl(upload.data.path).data.publicUrl;}));
      const reportData={...data,target_coordinate_count:targetCount,photo_urls:photoUrls};
      const saved=await supabase.from("standalone_detection_reports").insert({created_by:userData.user.id,report_data:reportData,coordinate_points:points.map(({photo_uri,...point})=>point)}).select("id").single(); if(saved.error)throw saved.error;
      const coordinatePoints=points.map(({latitude,longitude})=>({latitude,longitude}));
      const ek8Source:Ek8Source={city:data.province,district:data.district,village:data.neighborhood,adaNo:data.block_no,parcelNo:data.parcel_no,crop:data.product,harvestDate:[data.harvest_start,data.harvest_end].filter(Boolean).join(" – "),detectionDate:new Date().toISOString(),parcelPolygon:[],greenhousePolygon:coordinatePoints,greenhouseCoordinatePoints:coordinatePoints,producerTc:"",producerName:"",unitNo:"",area:"",type:"",coverMaterial:"",cultivationMethod:"",productionMaterial:"",plantingDate:"",productionAmount:"",detectionNo:""};
      const html=buildOfficialEk8Html(ek8Source);
      const pdf=await Print.printToFileAsync({html}); await Sharing.shareAsync(pdf.uri,{mimeType:"application/pdf",dialogTitle:"Ek 8 tespit raporunu paylaş"}); router.back();
    }catch(e:any){Alert.alert("Rapor oluşturulamadı",e?.message||"Kayıt başarısız.");}finally{setBusy(false);}
  }
  return <ScrollView style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"><Text style={s.kicker}>BAĞIMSIZ RAPOR HİZMETİ</Text><Text style={s.title}>Ek 8 · Tespit raporu</Text><Text style={s.copy}>Parsel bilgilerini girin ve parsel sınırındaki her nokta için fotoğrafla birlikte gerçek GPS ölçümü alın.</Text><View style={s.card}><Text style={s.section}>Saha bilgileri</Text>{fields.map(([key,label])=><TextInput key={key} style={s.input} placeholder={label} placeholderTextColor="#94a3b8" value={data[key]||""} onChangeText={(v)=>setData(old=>({...old,[key]:v}))}/>)}</View><View style={s.card}><Text style={s.section}>Gerçek koordinat noktaları</Text><Text style={s.copy}>Nokta sayısı: {targetCount} · Kaydedilen: {points.length}/{targetCount}</Text><View style={s.row}>{[3,4,5,6,7,8].map(n=><Pressable key={n} onPress={()=>{if(n===targetCount)return;if(!points.length){setTargetCount(n);return;}Alert.alert("Noktaları sıfırla?","Nokta sayısını değiştirmek kaydedilen koordinatları temizler.", [{text:"Vazgeç",style:"cancel"},{text:"Sıfırla",style:"destructive",onPress:()=>{setPoints([]);setTargetCount(n);}}]);}} style={[s.countButton,targetCount===n&&s.countActive]}><Text style={s.countText}>{n}</Text></Pressable>)}</View>{points.map((p,i)=><Text key={p.captured_at} style={s.point}>{String.fromCharCode(65+i)} · {p.latitude.toFixed(6)}, {p.longitude.toFixed(6)} · ±{Math.round(p.accuracy)} m</Text>)}<Pressable style={s.secondary} onPress={capturePoint} disabled={busy||points.length>=targetCount}>{busy?<ActivityIndicator color="white"/>:<><MaterialCommunityIcons name="camera-marker-outline" size={20} color="white"/><Text style={s.secondaryText}>Fotoğraf çek ve GPS noktası kaydet</Text></>}</Pressable></View><Pressable style={s.primary} onPress={createReport} disabled={busy}><Text style={s.primaryText}>Raporu kaydet ve PDF oluştur</Text></Pressable></ScrollView>;
}
function esc(v:string){return v.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));}
const s=StyleSheet.create({root:{flex:1,backgroundColor:"#020617"},content:{padding:18,paddingBottom:40,gap:14},kicker:{color:"#86efac",fontSize:11,fontWeight:"900",letterSpacing:1},title:{color:"white",fontSize:24,fontWeight:"900"},copy:{color:"#cbd5e1",lineHeight:20},card:{padding:16,backgroundColor:"#0f172a",borderColor:"#1e293b",borderWidth:1,borderRadius:12,gap:10},section:{color:"white",fontSize:16,fontWeight:"900"},input:{minHeight:48,borderWidth:1,borderColor:"#334155",borderRadius:8,paddingHorizontal:12,color:"white",backgroundColor:"#111c30"},row:{flexDirection:"row",gap:8},countButton:{width:38,height:38,borderRadius:8,backgroundColor:"#1e293b",alignItems:"center",justifyContent:"center"},countActive:{backgroundColor:"#166534"},countText:{color:"white",fontWeight:"800"},point:{color:"#bbf7d0",fontSize:12},secondary:{minHeight:48,backgroundColor:"#1e3a8a",borderRadius:8,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8},secondaryText:{color:"white",fontWeight:"800"},primary:{minHeight:52,backgroundColor:"#86efac",borderRadius:8,alignItems:"center",justifyContent:"center"},primaryText:{color:"#052e16",fontWeight:"900"}});
