import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { RoleGate } from "../../components/RoleGate";

export default function ReportsTab() {
  return <RoleGate><View style={styles.screen}><View style={styles.card}><View style={styles.icon}><MaterialCommunityIcons name="file-document-outline" size={30} color="#bbf7d0" /></View><Text style={styles.title}>Tespit raporu</Text><Text style={styles.copy}>Görev denetimlerinden bağımsız Ek 8 tespit raporu oluşturun. Konumlar yalnızca sahada alınan gerçek GPS noktalarından oluşur.</Text><Pressable style={styles.button} onPress={() => router.push("/reports/detection" as any)}><MaterialCommunityIcons name="plus" size={20} color="#052e16"/><Text style={styles.buttonText}>Tespit raporu oluştur</Text></Pressable></View></View></RoleGate>;
}

const styles = StyleSheet.create({screen:{flex:1,backgroundColor:"#020617",padding:20,justifyContent:"center"},card:{padding:24,borderRadius:16,backgroundColor:"#0f172a",borderWidth:1,borderColor:"#1e293b",alignItems:"center",gap:14},icon:{width:64,height:64,borderRadius:16,backgroundColor:"#14532d",alignItems:"center",justifyContent:"center"},title:{color:"white",fontSize:23,fontWeight:"900"},copy:{color:"#cbd5e1",fontSize:14,lineHeight:21,textAlign:"center"},button:{marginTop:8,backgroundColor:"#86efac",borderRadius:10,paddingHorizontal:18,paddingVertical:14,flexDirection:"row",alignItems:"center",gap:8},buttonText:{color:"#052e16",fontWeight:"900",fontSize:15}});
