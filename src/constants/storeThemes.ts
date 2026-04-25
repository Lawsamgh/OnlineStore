import type { PlanId } from "./planEntitlements";

export type StoreThemeId =
  | "default"
  | "ocean"
  | "forest"
  | "sunset"
  | "lavender";

export type StoreThemePreset = {
  id: StoreThemeId;
  label: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  primaryText: string;
  accent: string;
};

export const STORE_THEME_PRESETS: StoreThemePreset[] = [
  {
    id: "default",
    label: "Default",
    bg: "#f8fafc",
    surface: "#ffffff",
    text: "#0f172a",
    muted: "#64748b",
    border: "#e2e8f0",
    primary: "#0f172a",
    primaryText: "#ffffff",
    accent: "#059669",
  },
  {
    id: "ocean",
    label: "Ocean",
    bg: "#eff6ff",
    surface: "#ffffff",
    text: "#082f49",
    muted: "#0369a1",
    border: "#bae6fd",
    primary: "#0369a1",
    primaryText: "#ffffff",
    accent: "#0891b2",
  },
  {
    id: "forest",
    label: "Forest",
    bg: "#f0fdf4",
    surface: "#ffffff",
    text: "#14532d",
    muted: "#166534",
    border: "#bbf7d0",
    primary: "#166534",
    primaryText: "#ffffff",
    accent: "#15803d",
  },
  {
    id: "sunset",
    label: "Sunset",
    bg: "#fff7ed",
    surface: "#ffffff",
    text: "#7c2d12",
    muted: "#c2410c",
    border: "#fed7aa",
    primary: "#c2410c",
    primaryText: "#ffffff",
    accent: "#ea580c",
  },
  {
    id: "lavender",
    label: "Lavender",
    bg: "#faf5ff",
    surface: "#ffffff",
    text: "#4c1d95",
    muted: "#7e22ce",
    border: "#e9d5ff",
    primary: "#7e22ce",
    primaryText: "#ffffff",
    accent: "#8b5cf6",
  },
];

export const STORE_THEME_FONTS = [
  { id: "system", label: "System UI", stack: "Inter, ui-sans-serif, system-ui, sans-serif" },
  { id: "poppins", label: "Poppins", stack: "Poppins, Inter, ui-sans-serif, system-ui, sans-serif" },
  { id: "nunito", label: "Nunito", stack: "Nunito, Inter, ui-sans-serif, system-ui, sans-serif" },
] as const;

export type StoreThemeFontId = (typeof STORE_THEME_FONTS)[number]["id"];

export function allowedThemeIdsForPlan(planId: PlanId): StoreThemeId[] {
  if (planId === "pro") return STORE_THEME_PRESETS.map((p) => p.id);
  if (planId === "growth") return ["default", "ocean", "forest"];
  return ["default"];
}

export function resolveThemePreset(id: string | null | undefined): StoreThemePreset {
  const needle = (id ?? "").trim().toLowerCase();
  return (
    STORE_THEME_PRESETS.find((p) => p.id === needle) ?? STORE_THEME_PRESETS[0]
  );
}

export function resolveThemeFont(
  id: string | null | undefined,
): (typeof STORE_THEME_FONTS)[number] {
  const needle = (id ?? "").trim().toLowerCase();
  return STORE_THEME_FONTS.find((f) => f.id === needle) ?? STORE_THEME_FONTS[0];
}

export function normalizeHexOrNull(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}

export type StoreThemeSettingsInput = {
  theme_id?: string | null;
  theme_primary_color?: string | null;
  theme_accent_color?: string | null;
  theme_bg_color?: string | null;
  theme_surface_color?: string | null;
  theme_text_color?: string | null;
  theme_font_family?: string | null;
};

export function resolveStoreThemeTokens(input: StoreThemeSettingsInput) {
  const preset = resolveThemePreset(input.theme_id);
  const font = resolveThemeFont(input.theme_font_family);
  return {
    bg: normalizeHexOrNull(input.theme_bg_color) ?? preset.bg,
    surface: normalizeHexOrNull(input.theme_surface_color) ?? preset.surface,
    text: normalizeHexOrNull(input.theme_text_color) ?? preset.text,
    muted: preset.muted,
    border: preset.border,
    primary: normalizeHexOrNull(input.theme_primary_color) ?? preset.primary,
    primaryText: preset.primaryText,
    accent: normalizeHexOrNull(input.theme_accent_color) ?? preset.accent,
    fontFamily: font.stack,
  };
}
