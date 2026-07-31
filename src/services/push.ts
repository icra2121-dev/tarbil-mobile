import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";

export async function registerForPush() {
  if (Platform.OS === "web") {
    return null;
  }

  const settings = await Notifications.getPermissionsAsync();

  let finalStatus = settings.status;

  if (finalStatus !== "granted") {
    const request = await Notifications.requestPermissionsAsync();

    finalStatus = request.status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
  const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

  return token.data;
}
