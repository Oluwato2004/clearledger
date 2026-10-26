import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  buildInvoiceEventTimeline,
  type IndexedInvoiceEvent,
} from "@/lib/invoiceEventTimeline";

/** Maximum page size the indexer's `GET /events` accepts. */
export const INVOICE_EVENTS_LIMIT = 100;

/**
 * Loads indexed events and builds the lifecycle timeline for one invoice.
 * The indexer has no per-invoice events endpoint, so the most recent
 * {@link INVOICE_EVENTS_LIMIT} events are fetched and filtered client-side.
 */
export function useInvoiceEventTimeline(invoiceId: string) {
  const query = useQuery<IndexedInvoiceEvent[]>({
    queryKey: ["invoiceEventTimeline", invoiceId],
    queryFn: () =>
      apiFetch<IndexedInvoiceEvent[]>(`/events?limit=${INVOICE_EVENTS_LIMIT}`),
    enabled: invoiceId.length > 0,
    staleTime: 15000,
  });

  return {
    entries: buildInvoiceEventTimeline(query.data, invoiceId),
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
