/**
 * The one module that touches Tediware. Route handlers and server actions call
 * this; nothing else issues fetches against Tediware URLs. This is the rough
 * draft of a future official SDK, so keep the surface small and readable.
 */
export {
  getApiConfig,
  getPartnerKey,
  getSigningConfig,
  isApiConfigured,
  isTediwareConfigured,
  type ApiConfig,
  type SigningConfig,
  type WebhookRole,
} from "./env";
export { TediwareError } from "./client";
export {
  computeSignature,
  signWebhookBody,
  verifyWebhookSignature,
  type VerifyResult,
} from "./signature";
export {
  readWebhook,
  type ReadWebhookResult,
  type WebhookNotification,
} from "./webhook";
export {
  fetchArtifactText,
  fetchInboundDocument,
  fetchResult,
  type ResultArtifact,
  type ResultResponse,
} from "./results";
export {
  isTranslated850,
  resolveOrderPayload,
  translateInbound850,
} from "./inbound-order";
export { submitTransaction, type SubmitResult, type TsCode } from "./submit";
export {
  findOutboundEdiTransaction,
  resendEdiTransaction,
  type EdiTransaction,
  type ResendResult,
} from "./edi-transactions";
