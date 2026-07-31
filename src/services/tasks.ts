import { supabase } from "../lib/supabase";
import { fixRecordText } from "../utils/text";
import { createTask as insertTask } from "./createTask";

export async function createTask(values) {
  return await insertTask(values);
}

function normalizeTaskResult(result) {
  if (!result?.data) {
    return result;
  }

  return {
    ...result,
    data: Array.isArray(result.data) ? result.data.map((item) => fixRecordText(item)) : fixRecordText(result.data),
  };
}

export async function getTasks() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      data: [],
    };
  }

  const profile = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const role = profile.data?.role;

  if (role === "admin" || role === "manager") {
    const result = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", {
        ascending: false,
      });

    return normalizeTaskResult(result);
  }

  const assignedResult = await supabase
    .from("tasks")
    .select("*")
    .or(`user_id.eq.${user.id},assigned_to.eq.${user.id}`)
    .order("created_at", {
      ascending: false,
    });

  if (!assignedResult.error) {
    return normalizeTaskResult(assignedResult);
  }

  const fallbackResult = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", {
      ascending: false,
    });

  return normalizeTaskResult(fallbackResult);
}

function isMissingNotificationTaskIdColumn(error) {
  const errorText = [error?.code, error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    errorText.includes("task_id") &&
    (errorText.includes("does not exist") || errorText.includes("schema cache") || errorText.includes("pgrst204"))
  );
}

function isMissingTaskLifecycleSchema(error: any) {
  const errorText = [error?.code, error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("tr-TR");

  return (
    errorText.includes("cancelled_at") ||
    errorText.includes("cancelled_by") ||
    errorText.includes("reactivated_at") ||
    errorText.includes("reactivated_by") ||
    errorText.includes("reactivate_cancelled_task") ||
    errorText.includes("schema cache") ||
    errorText.includes("pgrst202") ||
    errorText.includes("pgrst204") ||
    errorText.includes("does not exist") ||
    errorText.includes("could not find")
  );
}

function normalizeTaskId(taskId: unknown) {
  const normalizedTaskId = String(Array.isArray(taskId) ? taskId[0] : taskId || "");

  if (!/^[1-9]\d*$/.test(normalizedTaskId)) {
    throw new Error("Geçerli görev ID bulunamadı.");
  }

  return normalizedTaskId;
}

export async function cancelTask(taskId: unknown, cancelledBy?: string | null, currentResult?: string | null) {
  const normalizedTaskId = normalizeTaskId(taskId);
  const primaryResult = await supabase
    .from("tasks")
    .update({
      workflow_status: "İptal Edildi",
      status: "İptal Edildi",
      cancelled_at: new Date().toISOString(),
      cancelled_by: cancelledBy || null,
      compliance_result: currentResult || "Admin tarafından iptal edildi",
    })
    .eq("id", normalizedTaskId)
    .select("*")
    .single();

  if (!primaryResult.error) {
    return fixRecordText(primaryResult.data);
  }

  if (!isMissingTaskLifecycleSchema(primaryResult.error)) {
    throw primaryResult.error;
  }

  const fallbackResult = await supabase
    .from("tasks")
    .update({
      workflow_status: "İptal Edildi",
      status: "İptal Edildi",
      compliance_result: currentResult || "Admin tarafından iptal edildi",
    })
    .eq("id", normalizedTaskId)
    .select("*")
    .single();

  if (fallbackResult.error) {
    throw fallbackResult.error;
  }

  return fixRecordText(fallbackResult.data);
}

export async function deleteTaskById(taskId) {
  const normalizedTaskId = String(Array.isArray(taskId) ? taskId[0] : taskId || "");

  if (!normalizedTaskId) {
    throw new Error("Görev ID bulunamadı.");
  }

  const notificationResult = await supabase.from("notifications").delete().eq("task_id", normalizedTaskId);

  if (notificationResult.error && !isMissingNotificationTaskIdColumn(notificationResult.error)) {
    throw notificationResult.error;
  }

  const evidenceResult = await supabase.from("task_evidence").delete().eq("task_id", normalizedTaskId);

  if (evidenceResult.error) {
    throw evidenceResult.error;
  }

  const taskResult = await supabase.from("tasks").delete().eq("id", normalizedTaskId);

  if (taskResult.error) {
    throw taskResult.error;
  }

  return taskResult;
}

export async function reactivateCancelledTask(taskId: unknown) {
  const normalizedTaskId = normalizeTaskId(taskId);

  const result = await supabase.rpc("reactivate_cancelled_task", {
    p_task_id: Number(normalizedTaskId),
  });

  if (!result.error) {
    return Array.isArray(result.data) ? result.data[0] : result.data;
  }

  if (!isMissingTaskLifecycleSchema(result.error)) {
    throw result.error;
  }

  const currentResult = await supabase
    .from("tasks")
    .select("assigned_to")
    .eq("id", normalizedTaskId)
    .single();

  if (currentResult.error) {
    throw currentResult.error;
  }

  const nextStatus = currentResult.data?.assigned_to ? "Sahaya Atandı" : "Bekliyor";
  const fallbackResult = await supabase
    .from("tasks")
    .update({
      workflow_status: nextStatus,
      status: nextStatus,
      compliance_result: "Görev admin tarafından yeniden aktif edildi",
    })
    .eq("id", normalizedTaskId)
    .select("*")
    .single();

  if (fallbackResult.error) {
    throw fallbackResult.error;
  }

  return fixRecordText(fallbackResult.data);
}
