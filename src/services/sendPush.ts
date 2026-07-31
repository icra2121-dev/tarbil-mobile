import { supabase } from "../lib/supabase";

type PushMetadata = {
  data?: Record<string, unknown>;
  taskId?: unknown;
  type?: string;
  userId?: string | null;
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

async function insertNotificationWithFallback(payload: Record<string, unknown>) {
  const attempts = [
    payload,
    omitNotificationColumns(payload, ["data"]),
    omitNotificationColumns(payload, ["data", "push_token"]),
    omitNotificationColumns(payload, ["data", "push_token", "task_id"]),
    omitNotificationColumns(payload, ["data", "push_token", "task_id", "type", "read"]),
  ];
  let lastResult: any = null;

  for (const attempt of attempts) {
    const result = await supabase.from("notifications").insert(attempt).select().maybeSingle();

    if (!result.error) {
      return result;
    }

    lastResult = result;

    if (!isNotificationSchemaError(result.error)) {
      return result;
    }
  }

  return lastResult;
}

function omitNotificationColumns(payload: Record<string, unknown>, columns: string[]) {
  const nextPayload = { ...payload };
  columns.forEach((column) => {
    delete nextPayload[column];
  });
  return nextPayload;
}

export async function sendPushToUser(pushToken: string | null | undefined, title: string, body: string, metadata: PushMetadata = {}) {
  const notificationResult = await insertNotificationWithFallback({
    user_id: metadata.userId || null,
    push_token: pushToken || null,
    title,
    body,
    task_id: metadata.taskId || null,
    type: metadata.type || "task_assigned",
    read: false,
    data: metadata.data || {},
  });

  if (pushToken) {
    try {
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: pushToken,
          title,
          body,
          data: metadata.data || {},
          sound: "default",
        }),
      });
    } catch {
      // Push servisi geçici olarak erişilemezse görev atamasını bozmayalım.
    }
  }

  return notificationResult;
}
