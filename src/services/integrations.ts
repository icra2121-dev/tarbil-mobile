import { supabase } from "../lib/supabase";

export type IntegrationStatus = {
  mode: "gateway" | "local";
  label: string;
  detail: string;
};

const gatewayUrl = process.env.EXPO_PUBLIC_INTEGRATION_API_URL?.replace(/\/$/, "");
const INTEGRATION_REQUEST_TIMEOUT_MS = 10000;

export function getIntegrationStatus(): IntegrationStatus {
  if (gatewayUrl) {
    return {
      mode: "gateway",
      label: "Resmi entegrasyon hazır",
      detail: "KOBÜKS ve CBS sorguları kurumsal arka uç üzerinden çalışacak.",
    };
  }

  return {
    mode: "local",
    label: "Hazırlık modu",
    detail:
      "API anahtarları mobil uygulamaya gömülmeden, bakanlık arka ucunda tutulacak şekilde entegrasyon noktaları hazır.",
  };
}

export async function integrationFetch<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  if (!gatewayUrl) {
    return null;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), INTEGRATION_REQUEST_TIMEOUT_MS);
  options.signal?.addEventListener("abort", abortFromCaller);

  let response: Response;

  try {
    response = await fetch(`${gatewayUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...options.headers,
      },
    });
  } catch (error: any) {
    if (controller.signal.aborted) {
      throw new Error("Entegrasyon servisi zaman aşımına uğradı.");
    }

    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.message || `Entegrasyon servisi yanıt vermedi. HTTP ${response.status}`);
  }

  return response.json();
}
