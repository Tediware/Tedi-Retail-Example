/**
 * GS1 SSCC-18 generation for carton and pallet labels.
 *
 * Layout: extension digit + GS1 company prefix + serial reference + mod-10
 * check digit, 18 digits total. The company prefix is a placeholder; a real
 * supplier would use their licensed GS1 prefix.
 */

const EXTENSION_DIGIT = "0";
const COMPANY_PREFIX = "0999999";

/** Builds an SSCC-18 from a numeric serial (only the last 9 digits are used). */
export function generateSscc(serial: number): string {
  const reference = String(Math.abs(Math.trunc(serial)) % 1_000_000_000).padStart(
    9,
    "0",
  );
  const body = `${EXTENSION_DIGIT}${COMPANY_PREFIX}${reference}`;
  return body + gs1CheckDigit(body);
}

/** GS1 mod-10 check digit: weight 3 on the rightmost body digit, alternating. */
function gs1CheckDigit(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}
