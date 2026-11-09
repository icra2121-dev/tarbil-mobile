import "react-native-url-polyfill/auto";

import AsyncStorage
from "@react-native-async-storage/async-storage";

import {
  createClient,
} from "@supabase/supabase-js";

const configuredSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const configuredSupabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(
  configuredSupabaseUrl && /^https?:\/\//i.test(configuredSupabaseUrl) && configuredSupabaseAnonKey,
);

// Do not throw while loading the app when a build is missing its backend
// configuration. The sign-in screen can explain the problem instead.
const supabaseUrl = isSupabaseConfigured
  ? configuredSupabaseUrl!
  : "https://missing-supabase-configuration.invalid";
const supabaseAnonKey = configuredSupabaseAnonKey || "missing-supabase-anon-key";

export const supabase =
  createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      auth:{
        storage:AsyncStorage,
        autoRefreshToken:true,
        persistSession:true,
        detectSessionInUrl:false,
      },
    }
  );
