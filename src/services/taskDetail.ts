import { supabase } from "../lib/supabase";
import { fixRecordText } from "../utils/text";

export async function getTaskById(id: unknown) {
  const result = await supabase.from("tasks").select("*").eq("id", id).single();

  return result.data
    ? {
        ...result,
        data: fixRecordText(result.data),
      }
    : result;
}
