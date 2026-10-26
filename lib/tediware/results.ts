import fs from "node:fs";
import path from "node:path";

import { apiGetJson, apiRequest, TediwareError } from "./client";
import { isApiConfigured } from "./env";

/**
 * Reading documents back from the platform after a webhook.
 *
 * The webhook only notifies; the data is fetched here in two steps, per the
 * results API docs: `GET /platform/results/:id` returns metadata whose
 * `detail.artifacts` lists the files this step produced, and
 * `GET /platform/artifacts/:id` downloads one as raw bytes (not a JSON
 * envelope). For inbound processing the translated JSON is the artifact with
 * `usage: "output"` and `contentType: "application/json"`.
 *
 * When Tediware is not configured, results are read from local fixtures under
 * `fixtures/results/<id>.json` (the fixture is the document itself), so the
 * whole inbound path (verify, store, fetch, create order) is runnable locally
 * via `npm run webhook:send`.
 */

const FIXTURES_DIR = path.join(process.cwd(), "fixtures", "results");

export type ResultArtifact = {
  id: string;
  usage: "input" | "output";
  /** MIME type, e.g. "application/json" or "application/edi-x12". Older results may omit it. */
  contentType?: string;
};

export type ResultResponse = {
  id: string;
  traceGuid: string;
  createdAt: string;
  updatedAt: string;
  nodeName: string;
  detail: {
    direction: "inbound" | "outbound";
    errorMessage?: string;
    /**
     * Individual validation failures on a failed node, as JSON-pointer
     * messages, e.g. "/detail/.../DTM/1 must have required property 'date_02'".
     * Present on a failed validation result fetched via GET /platform/results.
     */
    errors?: string[];
    /** Which trading partner this result belongs to. Seen in prod; absent from some instances. */
    partner?: { key?: string };
    /** Pipeline steps that produced this result, e.g. "edi_to_json > transaction_set_extractor". Seen in prod; absent from some instances. */
    transformations?: string;
    x12?: Record<string, unknown>;
    artifacts?: ResultArtifact[];
  };
};

// Ids arrive in webhook payloads, so they are external input. Constrain them
// before they reach a filesystem path or a URL.
function safeId(kind: string, id: string | number): string {
  const text = String(id);
  if (!/^[A-Za-z0-9_-]+$/.test(text)) {
    throw new Error(`Refusing ${kind} id with unexpected characters: ${text}`);
  }
  return text;
}

function readFixture(kind: string, id: string): unknown {
  const file = path.join(FIXTURES_DIR, `${id}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Tediware not configured and no local fixture for ${kind} ${id} ` +
        `(expected ${file}). Set TEDIWARE_BASE_URL/API_KEY, or create the fixture.`,
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export async function fetchResult(resultId: string | number): Promise<ResultResponse> {
  const id = safeId("result", resultId);
  return apiGetJson<ResultResponse>(`/platform/results/${id}`);
}

/** Downloads an artifact's raw file content as text. */
export async function fetchArtifactText(artifactId: string | number): Promise<string> {
  const id = safeId("artifact", artifactId);
  const response = await apiRequest(`/platform/artifacts/${id}`, { method: "GET" });
  const text = await response.text();
  if (!response.ok) {
    throw new TediwareError(
      `GET /platform/artifacts/${id} returned ${response.status}`,
      response.status,
      text,
    );
  }
  return text;
}

/**
 * The inbound document for a processed result: fetches the result, picks the
 * translated-JSON artifact (usage "output", contentType "application/json"),
 * and downloads it. Returns both so the caller can audit-log what it saw.
 *
 * Unconfigured, the fixture file stands in for the downloaded document and
 * there is no result metadata.
 */
export async function fetchInboundDocument(
  resultId: string | number,
): Promise<{ result: ResultResponse | null; document: unknown }> {
  const id = safeId("result", resultId);
  if (!isApiConfigured()) {
    return { result: null, document: readFixture("result", id) };
  }

  const result = await fetchResult(id);
  console.log(`[tediware] GET /platform/results/${id} ->`, JSON.stringify(result, null, 2));
  const artifacts = result.detail?.artifacts ?? [];
  const artifact =
    artifacts.find((a) => a.usage === "output" && a.contentType === "application/json") ??
    // Older results may omit contentType; fall back to the output artifact.
    artifacts.find((a) => a.usage === "output");
  if (!artifact) {
    throw new Error(
      `Result ${id} has no output artifact to download ` +
        `(artifacts: ${JSON.stringify(artifacts)})`,
    );
  }

  const text = await fetchArtifactText(artifact.id);
  console.log(`[tediware] GET /platform/artifacts/${artifact.id} ->`, text);
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error(
      `Artifact ${artifact.id} for result ${id} is not valid JSON ` +
        `(contentType ${artifact.contentType ?? "unknown"})`,
    );
  }
  return { result, document };
}
