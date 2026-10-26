import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { InvoiceEventTimelineView } from "./InvoiceEventTimeline";
import { buildInvoiceEventTimeline } from "@/lib/invoiceEventTimeline";

const H = "c".repeat(64);
const entries = buildInvoiceEventTimeline(
  [
    {
      id: 1,
      event_id: "a",
      ledger: 10,
      ledger_closed_at: 1700000000,
      event_type: "InvoiceCreated",
      tx_hash: H,
      data: { invoice_id: "i" },
    },
    {
      id: 2,
      event_id: "b",
      ledger: 11,
      ledger_closed_at: 0,
      event_type: "Weird",
      tx_hash: "bad",
      data: { invoice_id: "i" },
    },
    {
      id: 3,
      event_id: "c",
      ledger: 12,
      ledger_closed_at: 1700000100,
      event_type: "InvoiceFunded",
      data: { invoice_id: "i" },
    },
  ],
  "i",
  "testnet",
);

describe("InvoiceEventTimelineView", () => {
  it("renders ordered events with UTC time and an explorer link", () => {
    render(
      <InvoiceEventTimelineView
        entries={entries}
        isLoading={false}
        error={null}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Invoice created");
    expect(items[0]).toHaveTextContent("2023-11-14 22:13:20 UTC");
    expect(items[0]).toHaveTextContent("Ledger 10");
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/tx/${H}`,
    );
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows fallbacks for unknown type, missing time and bad/missing hash", () => {
    render(
      <InvoiceEventTimelineView
        entries={entries}
        isLoading={false}
        error={null}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items[1]).toHaveTextContent("Unknown event");
    expect(items[1]).toHaveTextContent("(Weird)");
    expect(items[1]).toHaveTextContent("Ledger time unavailable");
    expect(items[1]).toHaveTextContent("Invalid transaction hash");
    expect(items[2]).toHaveTextContent("Transaction hash unavailable");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("renders the loading state", () => {
    render(<InvoiceEventTimelineView entries={[]} isLoading error={null} />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  });

  it("renders the empty state", () => {
    render(
      <InvoiceEventTimelineView entries={[]} isLoading={false} error={null} />,
    );
    expect(screen.getByText(/no indexed events/i)).toBeInTheDocument();
  });

  it("renders the failure state with retry", () => {
    const onRetry = vi.fn();
    render(
      <InvoiceEventTimelineView
        entries={[]}
        isLoading={false}
        error={new Error("x")}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load indexed events",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
