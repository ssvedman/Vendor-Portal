/* ============================================================
   CONFIG — edit this file to connect your backend.
   Leave the placeholders as-is to run in DEMO mode
   (any @lennar.com email + code 123456, data read from /data/*.json).
   ============================================================ */
window.APP_CONFIG = {
  // Paste from Supabase > Project Settings > API
  SUPABASE_URL:  "https://memhzqphludiruovuzwt.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lbWh6cXBobHVkaXJ1b3Z1end0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMTI3MjUsImV4cCI6MjA5OTc4ODcyNX0.hTJBtb3WtkgY66xqzZ22GT7V4VNllxPyb4C7qXRFFVI",

  // Login is restricted to this email domain.
  ALLOWED_DOMAIN: "@lennar.com",

  // ---- Role tiers ----------------------------------------------------------
  // admin  : full access + upload any division + change history + role list
  // editor : may upload/update ONLY the divisions listed for them
  // viewer : read-only (everyone at @lennar.com not listed below)
  ROLES: {
    "stephen.svedman@lennar.com": { role: "admin" }
    // Example editor:
    // "jane.doe@lennar.com": { role: "editor", divisions: ["tampa"] }
  },
  DEFAULT_ROLE: "viewer",

  // Divisions in the dropdown.
  DIVISIONS: [
    { key: "tampa",   label: "Tampa",   code: "TPU" },
    { key: "orlando", label: "Orlando", code: "OLH" }
  ],

  // Default date range for displayed (starts) data = current calendar year.
  DEFAULT_RANGE: (() => { const y = new Date().getFullYear();
    return { from: y + "-01-01", to: y + "-12-31" }; })(),

  // Anti-abuse: per-browser limits on requesting a login code (protects your
  // email provider quota). The authoritative cap is Supabase Auth > Rate Limits.
  OTP_LIMITS: { cooldownSec: 45, perHour: 5, perDay: 15 },

  // Demo verification code used only when Supabase is not configured.
  DEMO_CODE: "123456"
};
