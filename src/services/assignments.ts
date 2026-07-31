import { supabase } from "../lib/supabase";
import { startInspectionFromUnit, type CbsUnit } from "./cbs";
import { sendPushToUser } from "./sendPush";
import { taskStatuses, validateTaskForAssignment, type TaskWorkflowKind } from "./workflowGuard";

export async function assignTaskToInspector(taskId: unknown, inspector: any) {
  if (!inspector?.id) {
    throw new Error("Denetçi seçmeden görev atanamaz.");
  }

  const taskResult = await supabase.from("tasks").select("*").eq("id", taskId).single();

  if (taskResult.error) {
    throw taskResult.error;
  }

  const missing = validateTaskForAssignment(taskResult.data);

  if (missing.length) {
    throw new Error(`Görev atanamaz. Eksik işlemler:\n${missing.join("\n")}`);
  }

  const assigneeName = inspector.full_name || inspector.email || inspector.id;

  const updateResult = await supabase
    .from("tasks")
    .update({
      assigned_to: inspector.id,
      assigned_name: assigneeName,
      user_id: inspector.id,
      workflow_status: taskStatuses.assigned,
      status: taskStatuses.waiting,
    })
    .eq("id", taskId)
    .select("*")
    .single();

  if (updateResult.error) {
    throw updateResult.error;
  }

  const title = "Yeni denetim görevi";
  const body = `${updateResult.data?.unit_no || "Ünite"} için yeni saha denetimi atandı.`;
  const tokenResult = inspector.push_token
    ? { data: { push_token: inspector.push_token } }
    : await supabase.from("profiles").select("push_token").eq("id", inspector.id).maybeSingle();
  const pushToken = tokenResult.data?.push_token || null;

  try {
    await sendPushToUser(pushToken, title, body, {
      data: {
        taskId,
        unitNo: updateResult.data?.unit_no || null,
      },
      taskId,
      type: "task_assigned",
      userId: inspector.id,
    });
  } catch {
    // Bildirim kaydı yardımcı bir akış; görev ataması başarılıysa ekranı bloke etmeyelim.
  }

  return updateResult;
}

export async function assignUnitsToInspector(
  units: CbsUnit[],
  inspector: any,
  workflowKind: TaskWorkflowKind,
) {
  const assigned: { unit: CbsUnit; task: any }[] = [];
  const failed: { unit: CbsUnit; error: string }[] = [];

  for (const unit of units) {
    try {
      const taskResult = await startInspectionFromUnit(unit, "Bekliyor", workflowKind, {
        unassigned: true,
      });
      const task = taskResult.task;

      if (!task?.id) {
        throw new Error("Görev kaydı oluşturulamadı.");
      }

      if (String(task.assigned_to || "") === String(inspector?.id || "")) {
        assigned.push({ unit, task });
        continue;
      }

      const assignmentResult = await assignTaskToInspector(task.id, inspector);
      assigned.push({ unit, task: assignmentResult.data });
    } catch (error: any) {
      failed.push({
        unit,
        error: error?.message || String(error),
      });
    }
  }

  return { assigned, failed };
}
