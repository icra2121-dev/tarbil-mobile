import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { supabase } from "../lib/supabase";
import { buildTaskEk8Html, getEk8ReportPayloadSummary } from "./ek8Template";

function isSchemaColumnError(error: any) {
  const text = [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
  return text.includes("does not exist") || text.includes("schema cache") || text.includes("pgrst204") || text.includes("could not find");
}

function omitColumns(payload: Record<string, unknown>, columns: string[]) {
  const nextPayload = { ...payload };
  columns.forEach((column) => {
    delete nextPayload[column];
  });
  return nextPayload;
}

async function insertReport(payload: Record<string, unknown>) {
  const attempts = [
    payload,
    omitColumns(payload, ["task_id"]),
    omitColumns(payload, ["task_id", "created_by"]),
    omitColumns(payload, ["task_id", "created_by", "pdf_uri"]),
    omitColumns(payload, ["task_id", "created_by", "pdf_uri", "report_payload"]),
  ];
  const tried = new Set<string>();
  let lastResult: any = null;

  for (const attempt of attempts) {
    const signature = Object.keys(attempt).sort().join("|");

    if (tried.has(signature)) {
      continue;
    }

    tried.add(signature);
    const result = await supabase.from("ek8_reports").insert(attempt).select("*").maybeSingle();

    if (!result.error) {
      return result.data || null;
    }

    lastResult = result;

    if (!isSchemaColumnError(result.error)) {
      break;
    }
  }

  if (lastResult?.error) {
    console.warn("ek8_reports kaydı oluşturulamadı", lastResult.error);
    return null;
  }

  return null;
}

export async function exportTaskPdf(task: any, options: { share?: boolean } = {}) {
  const html = buildTaskEk8Html(task);
  const shouldShare = options.share ?? true;
  const file = await Print.printToFileAsync({ html });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const report = await insertReport({
    task_id: task?.id || null,
    unit_no: task?.unit_no || null,
    producer_name: task?.producer_name || null,
    ada_no: task?.ada_no || null,
    parcel_no: task?.parcel_no || null,
    crop_name: task?.detected_crop || task?.crop_name || task?.crop || null,
    report_payload: {
      ...getEk8ReportPayloadSummary(task),
      task,
    },
    pdf_uri: file.uri,
    created_by: user?.id || null,
  });

  if (shouldShare) {
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/pdf",
      UTI: ".pdf",
    });
  }

  return { uri: file.uri, saved: Boolean(report), report };
}
