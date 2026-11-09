import { Stack } from "expo-router";
import { useEffect } from "react";
import { StatusBar, StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { startOfflineSyncListener } from "../services/sync";

export default function RootLayout() {
  useEffect(() => {
    const stopOfflineSync = startOfflineSyncListener();
    // startLiveTracking();
    // startBackgroundTracking();
    return stopOfflineSync;
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#020617" translucent={false} />
      <SafeAreaView edges={["top"]} style={styles.safeArea}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: styles.stackContent,
          }}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#020617",
  },
  stackContent: {
    backgroundColor: "#020617",
  },
});
