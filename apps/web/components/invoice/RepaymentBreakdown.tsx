import React from "react";
import { formatDate } from "@/lib/format";
import {
  REPAYMENT_SOURCE_LABELS,
  buildInvoiceRepaymentBreakdown,
  type RepaymentBreakdown as Breakdown,
} from "@/lib/repaymentBreakdown";
import type { Invoice } from "@/types";

const ERROR_TEXT: Record<string, string> = {
  "invalid-face-value": "The invoice face value is missing or invalid.",
  "invalid-precision": "This asset's precision is unsupported.",
  "data-unavailable": "Repayment data is currently unavailable.",
};

interface Props {
  invoice?: Invoice | null;
  isLoading?: boolean;
  error?: unknown;
  /** Override for tests/other callers; defaults to a breakdown of `invoice`. */
  breakdown?: Breakdown;
}

export function RepaymentBreakdown({
  invoice,
  isLoading,
  error,
  breakdown,
}: Props) {
  const heading = (
    <h3 className="text-xs font-bold font-mono text-white uppercase tracking-wider border-b border-border/40 pb-2">
      Repayment Breakdown
    </h3>
  );

  if (isLoading) {
    return (
      <section
        aria-label="Repayment breakdown"
        aria-busy="true"
        className="bg-card border border-border rounded-lg p-5 space-y-3"
      >
        {heading}
        <p className="text-xs font-mono text-slate-500">
          Loading repayment data...
        </p>
      </section>
    );
  }

  const data = error
    ? ({ ok: false, error: "data-unavailable", source: "unavailable" } as const)
    : (breakdown ?? buildInvoiceRepaymentBreakdown(invoice));

  if (!data.ok) {
    return (
      <section
        aria-label="Repayment breakdown"
        className="bg-card border border-border rounded-lg p-5 space-y-3"
      >
        {heading}
        <p className="text-xs font-mono text-red-400" role="alert">
          {ERROR_TEXT[data.error ?? "data-unavailable"]}
        </p>
      </section>
    );
  }

  const row = (label: string, value: string, testId: string) => (
    <div className="flex flex-wrap justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300 font-bold" data-testid={testId}>
        {value}
      </span>
    </div>
  );

  return (
    <section
      aria-label="Repayment breakdown"
      className="bg-card border border-border rounded-lg p-5 space-y-4"
    >
      {heading}
      <div className="space-y-3 font-mono text-xs">
        {row("Face value", data.formatted.faceValue, "rb-face-value")}
        {row("Total repaid", data.formatted.totalRepaid, "rb-total-repaid")}
        {row("Amount due", data.formatted.amountDue, "rb-amount-due")}
        <div className="flex flex-wrap justify-between gap-2">
          <span className="text-slate-500">Precision</span>
          <span className="text-slate-300">{data.decimals} decimals</span>
        </div>
        {data.isFullyRepaid && !data.isOverpaid && (
          <p className="text-emerald-400">Fully repaid.</p>
        )}
        {data.isOverpaid && (
          <p className="text-amber-500" role="status">
            Overpaid by {data.formatted.overpaid}. Amount due is shown as zero.
          </p>
        )}
        {data.invalidRecordCount > 0 && (
          <p className="text-amber-500" role="status">
            {data.invalidRecordCount} repayment record(s) with invalid amounts
            were ignored.
          </p>
        )}
        {data.lines.length === 0 ? (
          <p className="text-slate-500">No repayments recorded.</p>
        ) : (
          <ul className="space-y-1" aria-label="Recorded repayments">
            {data.lines.map((l) => (
              <li key={l.index} className="flex justify-between gap-2">
                <span className="text-slate-500">
                  #{l.index}
                  {l.timestamp ? ` · ${formatDate(l.timestamp)}` : ""}
                </span>
                <span className="text-slate-300">{l.formattedAmount}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-slate-500 border-t border-border/20 pt-2">
          Data source: {REPAYMENT_SOURCE_LABELS[data.source]}
        </p>
      </div>
    </section>
  );
}

export default RepaymentBreakdown;
