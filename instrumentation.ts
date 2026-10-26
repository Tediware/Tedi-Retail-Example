/**
 * Runs once when the server boots. Prints a Tediware configuration summary so it
 * is obvious, at a glance, which integration capabilities are live and which are
 * running in local/stub mode. The app deliberately does not hard-fail on missing
 * config; it runs on seed data with everything stubbed.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { describeConfig } = await import("./lib/tediware/env");
  const { present, missing, lines } = describeConfig();

  console.log("[tediware] configuration:");
  for (const line of lines) console.log(`  - ${line}`);
  if (missing.length) {
    console.log(
      `  set in .env.local to enable more: ${missing.join(", ")} (see .env.example)`,
    );
  }
  if (present.length === 0) {
    console.log(
      "  running fully local: seed data, fixture webhooks, stubbed submissions",
    );
  }
}
