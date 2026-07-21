import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { supabase } from "../lib/supabase";
import { CbsUnit } from "./cbs";
import { buildUnitEk8Html, buildUnitEk8Source } from "./ek8Template";

export type Ek8ReportRecord = {
  id: string;
  task_id?: string;
  unit_no?: string;
  producer_name?: string;
  ada_no?: string;
  parcel_no?: string;
  crop_name?: string;
  pdf_uri?: string;
  report_payload?: any;
  created_at?: string;
};

export function buildEk8Html(unit: CbsUnit) {
  return buildUnitEk8Html(unit);
}

export async function createEk8PdfFromUnit(unit: CbsUnit) {
  const html = buildEk8Html(unit);
  const file = await Print.printToFileAsync({ html });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    const result = await supabase.from("ek8_reports").insert({
      greenhouse_unit_id: unit.greenhouseUnitId || null,
      unit_no: unit.unitNo,
      producer_name: unit.producerName,
      ada_no: unit.adaNo,
      parcel_no: unit.parcelNo,
      crop_name: unit.crop,
      report_payload: buildUnitEk8Source(unit),
      pdf_uri: file.uri,
      created_by: user?.id || null,
    });

    if (result.error) {
      console.warn("ek8_reports kaydı oluşturulamadı", result.error);
    }
  } catch (error) {
    console.warn("ek8_reports kaydı oluşturulamadı", error);
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: "application/pdf",
    UTI: ".pdf",
  });

  return file.uri;
}

export async function getRecentEk8Reports(): Promise<Ek8ReportRecord[]> {
  const result = await supabase
    .from("ek8_reports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(25);

  if (result.error) {
    return [];
  }

  return result.data || [];
}

export async function getLatestEk8ReportForTask(taskId: string): Promise<Ek8ReportRecord | null> {
  if (!taskId) {
    return null;
  }

  const result = await supabase
    .from("ek8_reports")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    return null;
  }

  return result.data || null;
}

export async function shareEk8ReportPdf(report: Ek8ReportRecord) {
  if (!report.pdf_uri) {
    return false;
  }

  await Sharing.shareAsync(report.pdf_uri, {
    mimeType: "application/pdf",
    UTI: ".pdf",
  });

  return true;
}
