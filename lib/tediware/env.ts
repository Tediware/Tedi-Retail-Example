/**
 * Tediware configuration, read from the environment.
 *
 * Config is validated per capability, not all-or-nothing, so the app is usable
 * on seed data with nothing configured: verifying signatures needs only the
 * webhook secret, fetching results needs the base URL and API key, submitting
 * also needs the partner key. Each getter fails loudly and lists exactly what is
 * missing when the capability it guards is used without its config.
 */

export type ApiConfig = { baseUrl: string; apiKey: string };
export type SigningConfig = { secret: string; toleranceSeconds: number };

const DEFAULT_TOLERANCE_SECONDS = 300;

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function missingError(names: string[]): Error {
  return new Error(
    `Tediware is not configured: missing ${names.join(", ")}. ` +
      `Set these in .env.local (see .env.example).`,
  );
}

/** True when the read side of the API (results, artifacts) is usable. */
export function isApiConfigured(): boolean {
  return !!read("TEDIWARE_BASE_URL") && !!read("TEDIWARE_API_KEY");
}

/** True when everything an outbound submission needs is present. */
export function isTediwareConfigured(): boolean {
  return isApiConfigured() && !!read("TEDIWARE_PARTNER_KEY");
}

/** Base URL + API key for reading from the platform API. Throws if unset. */
export function getApiConfig(): ApiConfig {
  const baseUrl = read("TEDIWARE_BASE_URL");
  const apiKey = read("TEDIWARE_API_KEY");
  const missing: string[] = [];
  if (!baseUrl) missing.push("TEDIWARE_BASE_URL");
  if (!apiKey) missing.push("TEDIWARE_API_KEY");
  if (missing.length) throw missingError(missing);
  return { baseUrl: baseUrl!.replace(/\/+$/, ""), apiKey: apiKey! };
}

/**
 * Fallback partner key for labeling inbound orders when the result detail does
 * not carry partner.key. Outbound URLs use the partner stored on the order,
 * not this value. Throws if unset.
 */
export function getPartnerKey(): string {
  const key = read("TEDIWARE_PARTNER_KEY");
  if (!key) throw missingError(["TEDIWARE_PARTNER_KEY"]);
  return key;
}

/** A human-readable summary of what is configured, for the startup log. */
export function describeConfig(): {
  present: string[];
  missing: string[];
  lines: string[];
} {
  const vars = [
    "TEDIWARE_BASE_URL",
    "TEDIWARE_API_KEY",
    "TEDIWARE_WEBHOOK_SECRET",
    "TEDIWARE_OUTBOUND_WEBHOOK_SECRET",
    "TEDIWARE_ERROR_WEBHOOK_SECRET",
    "TEDIWARE_PARTNER_KEY",
  ];
  const present = vars.filter((v) => read(v));
  const missing = vars.filter((v) => !read(v));

  const canVerify = !!read("TEDIWARE_WEBHOOK_SECRET");
  const verifies = (role: "outbound" | "error") =>
    !!read(roleSecretVar[role]!) || canVerify;
  const canFetch = !!read("TEDIWARE_BASE_URL") && !!read("TEDIWARE_API_KEY");
  const canSubmit = isTediwareConfigured();

  const lines = [
    `webhook signature verification: ${canVerify ? "enabled" : "disabled (set TEDIWARE_WEBHOOK_SECRET)"}`,
    `delivery notifications: outbound ${verifies("outbound") ? "enabled" : "disabled"}, error ${verifies("error") ? "enabled" : "disabled"} (set TEDIWARE_OUTBOUND_WEBHOOK_SECRET / TEDIWARE_ERROR_WEBHOOK_SECRET, or TEDIWARE_WEBHOOK_SECRET)`,
    `inbound result fetch: ${canFetch ? "live" : "local fixtures (set TEDIWARE_BASE_URL + TEDIWARE_API_KEY)"}`,
    `outbound submission: ${canSubmit ? "live" : "stubbed as accepted (set base URL, API key, partner key)"}`,
  ];
  return { present, missing, lines };
}

/**
 * The role a webhook plays for a partner. Tediware sends the outbound
 * (delivered) and error notifications with the same body, so the app gives
 * each role its own URL and tells them apart by route.
 */
export type WebhookRole = "inbound" | "outbound" | "error";

const roleSecretVar: Record<WebhookRole, string | null> = {
  inbound: null,
  outbound: "TEDIWARE_OUTBOUND_WEBHOOK_SECRET",
  error: "TEDIWARE_ERROR_WEBHOOK_SECRET",
};

/**
 * Webhook signing secret and replay tolerance for one role. Each Tediware
 * webhook has its own secret; the outbound and error roles read theirs from a
 * role-specific variable and fall back to TEDIWARE_WEBHOOK_SECRET, for when
 * one webhook serves several roles. Throws if no secret is set.
 */
export function getSigningConfig(role: WebhookRole = "inbound"): SigningConfig {
  const roleVar = roleSecretVar[role];
  const secret =
    (roleVar ? read(roleVar) : undefined) ?? read("TEDIWARE_WEBHOOK_SECRET");
  if (!secret) {
    throw missingError(
      roleVar
        ? [roleVar, "TEDIWARE_WEBHOOK_SECRET"]
        : ["TEDIWARE_WEBHOOK_SECRET"],
    );
  }
  const raw = read("TEDIWARE_WEBHOOK_TOLERANCE_SECONDS");
  const toleranceSeconds = raw ? Number(raw) : DEFAULT_TOLERANCE_SECONDS;
  return {
    secret,
    toleranceSeconds: Number.isFinite(toleranceSeconds)
      ? toleranceSeconds
      : DEFAULT_TOLERANCE_SECONDS,
  };
}
