// Ready-made looks for the COD form. Applying one merges its appearance into
// the Form builder settings; wording, the form type and the trust line are
// left exactly as the merchant set them. Client-safe.

export type FormTemplate = {
  id: string;
  name: string;
  description: string;
  builder: Record<string, string | number | boolean>;
};

export const TEMPLATES: FormTemplate[] = [
  {
    id: "classic",
    name: "Classic",
    description: "Black pill button, clean white form.",
    builder: {
      buttonBg: "#111111", buttonTextColor: "#ffffff", buttonHoverBg: "#333333",
      buttonRadius: 999, buttonPaddingY: 14, buttonBold: true, buttonAnimation: "none", buttonIcon: "none",
      accentColor: "#e02424", modalBg: "#ffffff", modalTextColor: "#1a1a1a", modalRadius: 14,
      overlayOpacity: 45, overlayBlur: 0, headingAlign: "center",
      inputRadius: 8, inputBorderColor: "#d0d0d0", inputBg: "#ffffff",
      submitBg: "#111111", submitTextColor: "#ffffff", fontFamily: "theme",
    },
  },
  {
    id: "bold-green",
    name: "Bold green",
    description: "High-contrast green with a pulsing cart button — the classic COD look.",
    builder: {
      buttonBg: "#16a34a", buttonTextColor: "#ffffff", buttonHoverBg: "#15803d",
      buttonRadius: 10, buttonPaddingY: 16, buttonBold: true, buttonAnimation: "pulse", buttonIcon: "cart",
      accentColor: "#16a34a", modalBg: "#ffffff", modalTextColor: "#0f172a", modalRadius: 16,
      overlayOpacity: 55, overlayBlur: 2, headingAlign: "center",
      inputRadius: 10, inputBorderColor: "#bbf7d0", inputBg: "#f0fdf4",
      submitBg: "#16a34a", submitTextColor: "#ffffff", fontFamily: "system",
    },
  },
  {
    id: "urgent-red",
    name: "Urgent red",
    description: "Red with a shine effect and lightning icon, for flash sales.",
    builder: {
      buttonBg: "#dc2626", buttonTextColor: "#ffffff", buttonHoverBg: "#b91c1c",
      buttonRadius: 8, buttonPaddingY: 16, buttonBold: true, buttonAnimation: "shine", buttonIcon: "bolt",
      accentColor: "#dc2626", modalBg: "#ffffff", modalTextColor: "#111827", modalRadius: 12,
      overlayOpacity: 60, overlayBlur: 0, headingAlign: "left",
      inputRadius: 6, inputBorderColor: "#fecaca", inputBg: "#ffffff",
      submitBg: "#dc2626", submitTextColor: "#ffffff", fontFamily: "system",
    },
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Thin outlines, square corners, lots of white space.",
    builder: {
      buttonBg: "#ffffff", buttonTextColor: "#111111", buttonHoverBg: "#f3f4f6",
      buttonRadius: 0, buttonPaddingY: 13, buttonBold: false, buttonAnimation: "none", buttonIcon: "none",
      accentColor: "#111111", modalBg: "#ffffff", modalTextColor: "#111111", modalRadius: 0,
      overlayOpacity: 30, overlayBlur: 4, headingAlign: "left",
      inputRadius: 0, inputBorderColor: "#111111", inputBg: "#ffffff",
      submitBg: "#111111", submitTextColor: "#ffffff", fontFamily: "theme",
    },
  },
  {
    id: "dark",
    name: "Midnight",
    description: "Dark form with a gold accent and truck icon.",
    builder: {
      buttonBg: "#f59e0b", buttonTextColor: "#111111", buttonHoverBg: "#d97706",
      buttonRadius: 12, buttonPaddingY: 15, buttonBold: true, buttonAnimation: "none", buttonIcon: "truck",
      accentColor: "#f59e0b", modalBg: "#111827", modalTextColor: "#f9fafb", modalRadius: 18,
      overlayOpacity: 65, overlayBlur: 3, headingAlign: "center",
      inputRadius: 10, inputBorderColor: "#374151", inputBg: "#1f2937",
      submitBg: "#f59e0b", submitTextColor: "#111111", fontFamily: "rounded",
    },
  },
  {
    id: "soft",
    name: "Soft blue",
    description: "Rounded, friendly blue with a shield icon for trust.",
    builder: {
      buttonBg: "#2563eb", buttonTextColor: "#ffffff", buttonHoverBg: "#1d4ed8",
      buttonRadius: 999, buttonPaddingY: 14, buttonBold: true, buttonAnimation: "none", buttonIcon: "shield",
      accentColor: "#2563eb", modalBg: "#f8fafc", modalTextColor: "#0f172a", modalRadius: 22,
      overlayOpacity: 40, overlayBlur: 6, headingAlign: "center",
      inputRadius: 14, inputBorderColor: "#cbd5e1", inputBg: "#ffffff",
      submitBg: "#2563eb", submitTextColor: "#ffffff", fontFamily: "rounded",
    },
  },
];
