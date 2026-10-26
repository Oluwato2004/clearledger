"use client";

import React from "react";
import { ExternalLink } from "lucide-react";
import { useInvoiceEventTimeline } from "@/hooks/useInvoiceEventTimeline";
import type { InvoiceEventTimelineEntry } from "@/lib/invoiceEventTimeline";
import { truncateTxHash } from "@/lib/invoiceTimeline";

interface ViewProps {
  entries: InvoiceEventTimelineEntry[];
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
}

/** Presentational timeline; separated from the data hook for testing. */
export function InvoiceEventTimelineView({
  entries,
  isLoading,
  error,
  onRetry,
}: ViewProps) {
  if (isLoading) {
    return (
      <p
        className="font-mono text-xs text-slate-500"
        role="status"
        aria-live="polite"
      >
        Loading indexed ledger events...
      </p>
    );
  }
  if (error) {
    return (
      <div role="alert" className="space-y-2 font-mono text-xs text-red-400">
        <p>Could not load indexed events.</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-border px-2 py-1 text-slate-300 hover:text-white"
          >
            Retry
          </button>
        )}
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <p className="font-mono text-xs text-slate-500">
        No indexed events for this invoice yet.
      </p>
    );
  }

  return (
    <ol className="space-y-3" aria-label="Invoice lifecycle events">
      {entries.map((entry) => (
        <li
          key={entry.key}
          className="rounded border border-border/40 bg-[#080c10]/40 p-3 font-mono text-xs"
        >
          <div className="font-bold text-slate-200">
            {entry.label}
            {!entry.isKnownType && entry.eventType && (
              <span className="ml-2 font-normal text-slate-500">
                ({entry.eventType})
              </span>
            )}
          </div>
          <div className="mt-1 text-slate-400">
            {entry.ledgerTimeLabel ?? "Ledger time unavailable"}
            {entry.ledger !== null && <span> · Ledger {entry.ledger}</span>}
          </div>
          <div className="mt-1 text-slate-400">
            {entry.txHash && entry.explorerUrl ? (
              <a
                href={entry.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
                aria-label={`View transaction ${entry.txHash} on Stellar Expert`}
              >
                <span title={entry.txHash}>{truncateTxHash(entry.txHash)}</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ) : entry.txHash ? (
              <span title={entry.txHash}>{truncateTxHash(entry.txHash)}</span>
            ) : entry.txHashInvalid ? (
              <span>Invalid transaction hash</span>
            ) : (
              <span>Transaction hash unavailable</span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function InvoiceEventTimeline({ invoiceId }: { invoiceId: string }) {
  const { entries, isLoading, error, refetch } =
    useInvoiceEventTimeline(invoiceId);
  return (
    <InvoiceEventTimelineView
      entries={entries}
      isLoading={isLoading}
      error={error}
      onRetry={() => void refetch()}
    />
  );
}
