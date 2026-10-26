import { describe, it, expect } from "vitest";
import {
  buildInvoiceEventTimeline,
  eventBelongsToInvoice,
  formatLedgerTimeUtc,
  labelForEventType,
  type IndexedInvoiceEvent,
} from "./invoiceEventTimeline";

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);

function ev(over: Partial<IndexedInvoiceEvent> = {}): IndexedInvoiceEvent {
  return {
    id: 1,
    event_id: "0000000100-0000000001",
    ledger: 100,
    ledger_closed_at: 1700000000,
    event_type: "InvoiceCreated",
    tx_hash: H1,
    data: { invoice_id: "inv-1" },
    ...over,
  };
}

describe("formatLedgerTimeUtc", () => {
  it("formats explicitly as UTC", () => {
    expect(formatLedgerTimeUtc(1700000000)).toBe("2023-11-14 22:13:20 UTC");
  });
  it.each([0, -5, NaN, Infinity, "1700000000", null, undefined, 1e20])(
    "returns null for %s",
    (v) => expect(formatLedgerTimeUtc(v)).toBeNull(),
  );
});

describe("labelForEventType", () => {
  it("maps known names and both naming styles", () => {
    expect(labelForEventType("fund_invoice")).toBe("Funded by pool");
    expect(labelForEventType("InvoiceFunded")).toBe("Funded by pool");
  });
  it("labels unknown types", () => {
    expect(labelForEventType("Mystery")).toBe("Unknown event");
  });
});

describe("eventBelongsToInvoice", () => {
  it("matches case-insensitively and rejects blank ids", () => {
    expect(
      eventBelongsToInvoice(ev({ data: { invoice_id: "INV-1" } }), "inv-1"),
    ).toBe(true);
    expect(eventBelongsToInvoice(ev(), "  ")).toBe(false);
    expect(eventBelongsToInvoice(ev({ data: null }), "inv-1")).toBe(false);
    expect(eventBelongsToInvoice(ev({ data: { invoice_id: 5 } }), "5")).toBe(
      false,
    );
  });
});

describe("buildInvoiceEventTimeline", () => {
  it("builds an entry with UTC time, hash and testnet explorer link", () => {
    const [e] = buildInvoiceEventTimeline([ev()], "inv-1", "testnet");
    expect(e).toMatchObject({
      label: "Invoice created",
      isKnownType: true,
      ledger: 100,
      ledgerTimeLabel: "2023-11-14 22:13:20 UTC",
      txHash: H1,
      txHashInvalid: false,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${H1}`,
    });
  });

  it("defaults to testnet links when no network is passed", () => {
    const [e] = buildInvoiceEventTimeline([ev()], "inv-1");
    expect(e.explorerUrl).toContain("/explorer/testnet/");
  });

  it("uses the public explorer only when the network says so", () => {
    const [e] = buildInvoiceEventTimeline([ev()], "inv-1", "mainnet");
    expect(e.explorerUrl).toContain("/explorer/public/");
  });

  it("returns no link for an unrecognised network", () => {
    const [e] = buildInvoiceEventTimeline([ev()], "inv-1", "futurenet");
    expect(e.explorerUrl).toBeNull();
    expect(e.txHash).toBe(H1);
  });

  it("handles empty, null and non-array input", () => {
    expect(buildInvoiceEventTimeline([], "inv-1")).toEqual([]);
    expect(buildInvoiceEventTimeline(null, "inv-1")).toEqual([]);
    expect(buildInvoiceEventTimeline(undefined, "inv-1")).toEqual([]);
    expect(
      buildInvoiceEventTimeline(
        {} as unknown as IndexedInvoiceEvent[],
        "inv-1",
      ),
    ).toEqual([]);
  });

  it("ignores null entries and other invoices' events", () => {
    const out = buildInvoiceEventTimeline(
      [
        null as unknown as IndexedInvoiceEvent,
        ev({ data: { invoice_id: "other" } }),
        ev(),
      ],
      "inv-1",
    );
    expect(out).toHaveLength(1);
  });

  it("orders out-of-order input by ledger", () => {
    const out = buildInvoiceEventTimeline(
      [
        ev({ id: 3, event_id: "c", ledger: 300, event_type: "InvoiceRepaid" }),
        ev({ id: 1, event_id: "a", ledger: 100 }),
        ev({ id: 2, event_id: "b", ledger: 200, event_type: "InvoiceFunded" }),
      ],
      "inv-1",
    );
    expect(out.map((e) => e.ledger)).toEqual([100, 200, 300]);
  });

  it("breaks same-ledger ties by event id, then by indexer id", () => {
    const tie = buildInvoiceEventTimeline(
      [
        ev({
          id: 9,
          event_id: "0000000100-0000000002",
          event_type: "InvoiceFunded",
          tx_hash: H2,
        }),
        ev({ id: 8, event_id: "0000000100-0000000001" }),
      ],
      "inv-1",
    );
    expect(tie.map((e) => e.eventType)).toEqual([
      "InvoiceCreated",
      "InvoiceFunded",
    ]);

    const noEventId = buildInvoiceEventTimeline(
      [
        ev({ id: 2, event_id: "", event_type: "InvoiceFunded", tx_hash: H2 }),
        ev({ id: 1, event_id: "" }),
      ],
      "inv-1",
    );
    expect(noEventId.map((e) => e.eventType)).toEqual([
      "InvoiceCreated",
      "InvoiceFunded",
    ]);
  });

  it("sorts events with a missing ledger last", () => {
    const out = buildInvoiceEventTimeline(
      [
        ev({ id: 1, event_id: "x", ledger: undefined }),
        ev({ id: 2, event_id: "y", ledger: 5 }),
      ],
      "inv-1",
    );
    expect(out.map((e) => e.ledger)).toEqual([5, null]);
  });

  it("removes duplicates by event id and by ledger/type/hash", () => {
    expect(
      buildInvoiceEventTimeline([ev(), ev({ id: 2 })], "inv-1"),
    ).toHaveLength(1);
    const noId = { event_id: "", tx_hash: H1.toUpperCase() };
    expect(
      buildInvoiceEventTimeline(
        [ev(noId), ev({ ...noId, id: 2, tx_hash: H1 })],
        "inv-1",
      ),
    ).toHaveLength(1);
  });

  it("keeps distinct events that share a transaction", () => {
    const out = buildInvoiceEventTimeline(
      [
        ev(),
        ev({
          id: 2,
          event_id: "0000000100-0000000002",
          event_type: "InvoiceListed",
        }),
      ],
      "inv-1",
    );
    expect(out).toHaveLength(2);
  });

  it("keeps unknown event types and labels them", () => {
    const [e] = buildInvoiceEventTimeline(
      [ev({ event_type: "Weird" })],
      "inv-1",
    );
    expect(e).toMatchObject({
      label: "Unknown event",
      isKnownType: false,
      eventType: "Weird",
    });
  });

  it.each([undefined, null, ""])("treats tx hash %s as unavailable", (hash) => {
    const [e] = buildInvoiceEventTimeline([ev({ tx_hash: hash })], "inv-1");
    expect(e).toMatchObject({
      txHash: null,
      txHashInvalid: false,
      explorerUrl: null,
    });
  });

  it.each(["abc", "z".repeat(64), "a".repeat(65)])(
    "flags invalid hash %s",
    (hash) => {
      const [e] = buildInvoiceEventTimeline([ev({ tx_hash: hash })], "inv-1");
      expect(e).toMatchObject({
        txHash: null,
        txHashInvalid: true,
        explorerUrl: null,
      });
    },
  );

  it("normalises uppercase hashes", () => {
    const [e] = buildInvoiceEventTimeline(
      [ev({ tx_hash: H1.toUpperCase() })],
      "inv-1",
    );
    expect(e.txHash).toBe(H1);
  });

  it("handles missing ledger time", () => {
    const [e] = buildInvoiceEventTimeline(
      [ev({ ledger_closed_at: 0 })],
      "inv-1",
    );
    expect(e.ledgerTime).toBeNull();
    expect(e.ledgerTimeLabel).toBeNull();
  });

  it("handles a single event and many events", () => {
    expect(buildInvoiceEventTimeline([ev()], "inv-1")).toHaveLength(1);
    const many = Array.from({ length: 500 }, (_, i) =>
      ev({
        id: i + 1,
        event_id: `e${String(500 - i).padStart(4, "0")}`,
        ledger: 1000 - i,
      }),
    );
    const out = buildInvoiceEventTimeline(many, "inv-1");
    expect(out).toHaveLength(500);
    expect(out[0].ledger).toBe(501);
    expect(out[499].ledger).toBe(1000);
  });

  it("does not mutate its input", () => {
    const input = [
      ev({ id: 2, event_id: "b", ledger: 2 }),
      ev({ id: 1, event_id: "a", ledger: 1 }),
    ];
    const copy = JSON.parse(JSON.stringify(input));
    buildInvoiceEventTimeline(input, "inv-1");
    expect(input).toEqual(copy);
  });
});
