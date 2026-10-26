import { stellarExpertTxUrl } from "@/lib/explorer";

/**
 * Lifecycle timeline built from events the indexer recorded (`GET /events`).
 * Pure functions only: fetching lives in `hooks/useInvoiceEventTimeline.ts`.
 *
 * Stellar semantics: `ledger` is the ledger sequence, `ledger_closed_at` is the
 * ledger close time in Unix seconds and is always displayed as UTC. Explorer
 * links follow `NEXT_PUBLIC_STELLAR_NETWORK` (Testnet by default).
 */

/** Wire shape of one indexed event. Everything is optional: input is untrusted. */
export interface IndexedInvoiceEvent {
  id?: number;
  event_id?: string;
  ledger?: number;
  ledger_closed_at?: number;
  event_type?: string;
  tx_hash?: string | null;
  data?: Record<string, unknown> | null;
}

export interface InvoiceEventTimelineEntry {
  /** Stable key for rendering. */
  key: string;
  eventType: string;
  /** Human label; "Unknown event" for types we do not recognise. */
  label: string;
  isKnownType: boolean;
  ledger: number | null;
  /** Ledger close time, Unix seconds, when valid. */
  ledgerTime: number | null;
  /** `YYYY-MM-DD HH:mm:ss UTC`, or null when the ledger time is missing/invalid. */
  ledgerTimeLabel: string | null;
  /** Lower-cased 64-hex hash when valid, else null. */
  txHash: string | null;
  /** True when a hash was supplied but is not a valid 64-hex transaction hash. */
  txHashInvalid: boolean;
  /** Stellar Expert URL for the configured network, or null. */
  explorerUrl: string | null;
}

const EVENT_LABELS: Record<string, string> = {
  create: "Invoice created",
  InvoiceCreated: "Invoice created",
  list_for_financing: "Listed for financing",
  InvoiceListed: "Listed for financing",
  fund_invoice: "Funded by pool",
  InvoiceFunded: "Funded by pool",
  mark_shipped: "Marked as shipped",
  InvoiceShipped: "Marked as shipped",
  confirm_delivery: "Delivery confirmed",
  DeliveryConfirmed: "Delivery confirmed",
  repay: "Repaid",
  InvoiceRepaid: "Repaid",
  receive_repayment: "Repayment received by pool",
  repayment_received: "Repayment received by pool",
  yield_distribution: "Repayment received by pool",
  trigger_default: "Defaulted",
  InvoiceDefaulted: "Defaulted",
  handle_default: "Default handled by pool",
  invoice_defaulted: "Default handled by pool",
  submit_attestation: "Attestation submitted",
  AttestationSubmitted: "Attestation submitted",
};

const TX_HASH_PATTERN = /^[0-9a-fA-F]{64}$/;

/** Label for an indexer event type; unknown types are reported, never hidden. */
export function labelForEventType(eventType: string): string {
  return EVENT_LABELS[eventType] ?? "Unknown event";
}

/**
 * Formats a ledger close time (Unix seconds) as `YYYY-MM-DD HH:mm:ss UTC`.
 *
 * @returns null for non-finite, non-positive, or out-of-range values.
 */
export function formatLedgerTimeUtc(seconds: unknown): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0)
    return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

/** True when the event's payload references `invoiceId` (case-insensitive). */
export function eventBelongsToInvoice(
  event: IndexedInvoiceEvent,
  invoiceId: string,
): boolean {
  const target = invoiceId.trim().toLowerCase();
  const value = event?.data?.invoice_id;
  return (
    target.length > 0 &&
    typeof value === "string" &&
    value.trim().toLowerCase() === target
  );
}

function compareEvents(a: IndexedInvoiceEvent, b: IndexedInvoiceEvent): number {
  // Events without a ledger sort last.
  const la = positiveInt(a.ledger) ?? Number.MAX_SAFE_INTEGER;
  const lb = positiveInt(b.ledger) ?? Number.MAX_SAFE_INTEGER;
  if (la !== lb) return la - lb;
  // Same ledger: Soroban event ids ("<toid>-<index>") encode in-ledger order,
  // and are zero-padded, so a plain string compare is correct.
  const ea = a.event_id ?? "";
  const eb = b.event_id ?? "";
  if (ea && eb && ea !== eb) return ea < eb ? -1 : 1;
  // Fall back to indexer insertion order.
  return (a.id ?? 0) - (b.id ?? 0);
}

/**
 * Builds the ordered lifecycle timeline for one invoice.
 *
 * - Keeps only events whose `data.invoice_id` matches `invoiceId`.
 * - Orders by ledger sequence, then in-ledger event id, then indexer id.
 * - Drops duplicates (same `event_id`, or same ledger + type + tx hash when no
 *   event id is present). Input is not mutated.
 * - Unknown event types are kept and labelled "Unknown event".
 * - Missing/invalid tx hashes yield no explorer link rather than a broken one.
 *
 * @param events - Indexed events in any order; non-object entries are ignored.
 * @param invoiceId - Invoice to build the timeline for.
 * @param network - Stellar network name; defaults to `NEXT_PUBLIC_STELLAR_NETWORK` or testnet.
 */
export function buildInvoiceEventTimeline(
  events: readonly IndexedInvoiceEvent[] | null | undefined,
  invoiceId: string,
  network?: string,
): InvoiceEventTimelineEntry[] {
  if (!Array.isArray(events)) return [];

  const relevant = events.filter(
    (e): e is IndexedInvoiceEvent =>
      !!e && typeof e === "object" && eventBelongsToInvoice(e, invoiceId),
  );

  const seen = new Set<string>();
  const unique = [...relevant].sort(compareEvents).filter((e) => {
    const hash = typeof e.tx_hash === "string" ? e.tx_hash.toLowerCase() : "";
    const dedupKey = e.event_id
      ? `id:${e.event_id}`
      : `${e.ledger ?? ""}|${e.event_type ?? ""}|${hash}`;
    if (seen.has(dedupKey)) return false;
    seen.add(dedupKey);
    return true;
  });

  return unique.map((e, index) => {
    const eventType = typeof e.event_type === "string" ? e.event_type : "";
    const rawHash = typeof e.tx_hash === "string" ? e.tx_hash.trim() : "";
    const validHash = TX_HASH_PATTERN.test(rawHash);
    const ledgerTimeLabel = formatLedgerTimeUtc(e.ledger_closed_at);
    return {
      key: e.event_id || `${e.id ?? "n"}-${index}`,
      eventType,
      label: labelForEventType(eventType),
      isKnownType: eventType in EVENT_LABELS,
      ledger: positiveInt(e.ledger),
      ledgerTime: ledgerTimeLabel ? (e.ledger_closed_at as number) : null,
      ledgerTimeLabel,
      txHash: validHash ? rawHash.toLowerCase() : null,
      txHashInvalid: rawHash.length > 0 && !validHash,
      explorerUrl: validHash ? stellarExpertTxUrl(rawHash, network) : null,
    };
  });
}
