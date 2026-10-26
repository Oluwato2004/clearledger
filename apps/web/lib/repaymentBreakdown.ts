import type { AssetType, Invoice } from "@/types";
import { ASSET_INFO } from "@/lib/assets";

/** Where the numbers in a repayment breakdown came from. */
export type RepaymentDataSource =
  | "indexer-repayments" // explicit repayment records supplied by the indexer API
  | "invoice-status" // derived from the indexed invoice record (status/repaidAt)
  | "unavailable";

export const REPAYMENT_SOURCE_LABELS: Record<RepaymentDataSource, string> = {
  "indexer-repayments": "Indexed repayment records (ClearLedger API)",
  "invoice-status":
    "Indexed invoice record (status and repaid timestamp); the contract settles repayment in full",
  unavailable: "No repayment data available",
};

export interface RepaymentRecord {
  /** Amount in the asset's smallest unit. Must be a non-negative integer. */
  amount: bigint | number | string | null | undefined;
  /** Unix timestamp (seconds), if known. */
  timestamp?: number | null;
  txHash?: string | null;
}

export interface RepaymentLine {
  index: number;
  amount: bigint;
  formattedAmount: string;
  timestamp: number | null;
  txHash: string | null;
}

export type RepaymentBreakdownError =
  "invalid-face-value" | "invalid-precision" | "data-unavailable";

export interface RepaymentBreakdown {
  ok: boolean;
  error: RepaymentBreakdownError | null;
  source: RepaymentDataSource;
  asset: string;
  decimals: number;
  faceValue: bigint;
  totalRepaid: bigint;
  /** Face value minus recorded repayments; never negative. */
  amountDue: bigint;
  /** Repayments beyond face value (0 when not overpaid). */
  overpaid: bigint;
  isOverpaid: boolean;
  isFullyRepaid: boolean;
  lines: RepaymentLine[];
  /** Number of repayment records that were ignored as invalid. */
  invalidRecordCount: number;
  formatted: {
    faceValue: string;
    totalRepaid: string;
    amountDue: string;
    overpaid: string;
  };
}

/** Highest precision supported; matches BigInt-safe display and Stellar's 7. */
export const MAX_ASSET_DECIMALS = 18;

/** Strict non-negative integer parse; returns null when invalid. */
export function parseAmount(value: unknown): bigint | null {
  try {
    if (typeof value === "bigint") return value >= 0n ? value : null;
    if (typeof value === "number") {
      return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
      return BigInt(value.trim());
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Formats an integer amount with exactly `decimals` fractional digits using
 * BigInt math only (no floating point), with thousands separators and a
 * minimum of 2 fractional digits trimmed of trailing zeros beyond that.
 */
export function formatUnits(
  amount: bigint,
  decimals: number,
  code?: string,
): string {
  const base = 10n ** BigInt(decimals);
  const whole = (amount / base)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = (amount % base).toString().padStart(decimals, "0");
  frac = frac.replace(/0+$/, "");
  if (frac.length < Math.min(2, decimals)) {
    frac = frac.padEnd(Math.min(2, decimals), "0");
  }
  const text = frac ? `${whole}.${frac}` : whole;
  return code ? `${text} ${code}` : text;
}

interface BuildInput {
  faceValue: unknown;
  repayments: readonly RepaymentRecord[] | null | undefined;
  /** Asset precision (decimal places). */
  decimals: number;
  asset?: string;
  source: RepaymentDataSource;
}

/**
 * Pure repayment breakdown: amount due = face value - recorded repayments,
 * clamped at zero (overpayment is flagged, not negated).
 */
export function buildRepaymentBreakdown(input: BuildInput): RepaymentBreakdown {
  const asset = input.asset ?? "";
  const precisionOk =
    Number.isInteger(input.decimals) &&
    input.decimals >= 0 &&
    input.decimals <= MAX_ASSET_DECIMALS;
  const decimals = precisionOk ? input.decimals : 0;
  const faceParsed = parseAmount(input.faceValue);

  const fmt = (v: bigint) => formatUnits(v, decimals, asset || undefined);
  const empty = (error: RepaymentBreakdownError): RepaymentBreakdown => ({
    ok: false,
    error,
    source: input.source,
    asset,
    decimals,
    faceValue: 0n,
    totalRepaid: 0n,
    amountDue: 0n,
    overpaid: 0n,
    isOverpaid: false,
    isFullyRepaid: false,
    lines: [],
    invalidRecordCount: 0,
    formatted: {
      faceValue: "—",
      totalRepaid: "—",
      amountDue: "—",
      overpaid: "—",
    },
  });

  if (!precisionOk) return empty("invalid-precision");
  if (faceParsed === null) return empty("invalid-face-value");
  if (input.source === "unavailable" || !input.repayments) {
    return empty("data-unavailable");
  }

  const lines: RepaymentLine[] = [];
  let invalidRecordCount = 0;
  let totalRepaid = 0n;
  for (const rec of input.repayments) {
    const amount = rec ? parseAmount(rec.amount) : null;
    if (amount === null) {
      invalidRecordCount += 1;
      continue;
    }
    totalRepaid += amount;
    lines.push({
      index: lines.length + 1,
      amount,
      formattedAmount: fmt(amount),
      timestamp:
        typeof rec.timestamp === "number" && Number.isFinite(rec.timestamp)
          ? rec.timestamp
          : null,
      txHash: rec.txHash || null,
    });
  }

  const remaining = faceParsed - totalRepaid;
  const amountDue = remaining > 0n ? remaining : 0n;
  const overpaid = remaining < 0n ? -remaining : 0n;

  return {
    ok: true,
    error: null,
    source: input.source,
    asset,
    decimals,
    faceValue: faceParsed,
    totalRepaid,
    amountDue,
    overpaid,
    isOverpaid: overpaid > 0n,
    isFullyRepaid: amountDue === 0n && faceParsed > 0n,
    lines,
    invalidRecordCount,
    formatted: {
      faceValue: fmt(faceParsed),
      totalRepaid: fmt(totalRepaid),
      amountDue: fmt(amountDue),
      overpaid: fmt(overpaid),
    },
  };
}

/** Optional per-repayment records some API payloads attach to an invoice. */
type InvoiceWithRepayments = Invoice & {
  repayments?: readonly RepaymentRecord[];
  repaidTxHash?: unknown;
};

/**
 * Builds the breakdown for an invoice using the data the web app already has.
 * Prefers explicit repayment records; otherwise derives from the indexed
 * invoice status (the Invoice contract's `repay` settles the full face value).
 */
export function buildInvoiceRepaymentBreakdown(
  invoice: Invoice | null | undefined,
): RepaymentBreakdown {
  if (!invoice) {
    return buildRepaymentBreakdown({
      faceValue: 0,
      repayments: null,
      decimals: ASSET_INFO.USDC.decimals,
      source: "unavailable",
    });
  }
  const info = ASSET_INFO[invoice.asset as AssetType];
  const inv = invoice as InvoiceWithRepayments;
  const base = {
    faceValue: invoice.faceValue,
    // Unsupported asset -> NaN precision -> reported as invalid-precision.
    decimals: info ? info.decimals : Number.NaN,
    asset: info ? info.code : String(invoice.asset ?? ""),
  };

  if (Array.isArray(inv.repayments)) {
    return buildRepaymentBreakdown({
      ...base,
      repayments: inv.repayments,
      source: "indexer-repayments",
    });
  }

  const repaid = invoice.status === "Repaid";
  return buildRepaymentBreakdown({
    ...base,
    repayments: repaid
      ? [
          {
            amount: invoice.faceValue,
            timestamp: invoice.repaidAt,
            txHash:
              typeof inv.repaidTxHash === "string" ? inv.repaidTxHash : null,
          },
        ]
      : [],
    source: "invoice-status",
  });
}
