import { supabase } from "../lib/supabase";
import { fixRecordText } from "../utils/text";

export type UserNotification = {
  id?: string;
  user_id?: string;
  title?: string;
  body?: string;
  task_id?: string | null;
  type?: string;
  read?: boolean;
  created_at?: string;
};

function isNotificationSchemaError(error: any) {
  const text = [error?.code, error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    text.includes("schema cache") ||
    text.includes("pgrst204") ||
    text.includes("does not exist") ||
    text.includes("could not find") ||
    text.includes("column")
  );
}

export async function getMyNotifications(limit = 20): Promise<UserNotification[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const fullResult = await supabase
    .from("notifications")
    .select("id,user_id,title,body,task_id,type,read,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!fullResult.error) {
    return (fullResult.data || []).map((item) => fixRecordText(item));
  }

  if (!isNotificationSchemaError(fullResult.error)) {
    return [];
  }

  const fallbackResult = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .limit(limit);

  if (fallbackResult.error) {
    return [];
  }

  return (fallbackResult.data || []).map((item) => fixRecordText(item));
}

export async function markNotificationRead(notificationId: unknown) {
  const id = String(notificationId || "").trim();

  if (!id) {
    return;
  }

  const result = await supabase.from("notifications").update({ read: true }).eq("id", id);

  if (result.error && !isNotificationSchemaError(result.error)) {
    throw result.error;
  }
}
