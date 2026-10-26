import { describe, it, expect } from "vitest";
import {
  buildInvoiceRepaymentBreakdown,
  buildRepaymentBreakdown,
  formatUnits,
  parseAmount,
} from "./repaymentBreakdown";
import type { Invoice } from "@/types";

const base = {
  decimals: 7,
  asset: "USDC",
  source: "indexer-repayments",
} as const;

describe("formatUnits", () => {
  it("formats with BigInt math and separators", () => {
    expect(formatUnits(1_000_000_000n, 7, "USDC")).toBe("100.00 USDC");
    expect(formatUnits(1n, 7)).toBe("0.0000001");
    expect(formatUnits(0n, 7)).toBe("0.00");
    expect(formatUnits(12_345_678_901n, 7)).toBe("1,234.5678901");
    expect(formatUnits(5n, 0)).toBe("5");
  });
  it("keeps exact precision for values beyond 2^53", () => {
    const big = 123_456_789_012_345_678_901_234_567n;
    expect(formatUnits(big, 7)).toBe("12,345,678,901,234,567,890.1234567");
  });
});

describe("parseAmount", () => {
  it("accepts non-negative integers only", () => {
    expect(parseAmount(5n)).toBe(5n);
    expect(parseAmount("42")).toBe(42n);
    expect(parseAmount(7)).toBe(7n);
    for (const bad of [
      -1n,
      -1,
      1.5,
      "1.5",
      "abc",
      "",
      null,
      undefined,
      NaN,
      2 ** 60,
      {},
    ]) {
      expect(parseAmount(bad)).toBeNull();
    }
  });
});

describe("buildRepaymentBreakdown", () => {
  it("zero repayments: full amount due", () => {
    const b = buildRepaymentBreakdown({
      ...base,
      faceValue: 1000n,
      repayments: [],
    });
    expect(b.ok).toBe(true);
    expect(b.amountDue).toBe(1000n);
    expect(b.totalRepaid).toBe(0n);
    expect(b.lines).toHaveLength(0);
    expect(b.isFullyRepaid).toBe(false);
  });

  it("partial repayments produce lines and remaining balance", () => {
    const b = buildRepaymentBreakdown({
      ...base,
      faceValue: 1_000_000_000n,
      repayments: [
        { amount: 250_000_000n, timestamp: 1_700_000_000, txHash: "abc" },
        { amount: "100000000" },
      ],
    });
    expect(b.totalRepaid).toBe(350_000_000n);
    expect(b.amountDue).toBe(650_000_000n);
    expect(b.formatted.amountDue).toBe("65.00 USDC");
    expect(b.lines.map((l) => l.formattedAmount)).toEqual([
      "25.00 USDC",
      "10.00 USDC",
    ]);
    expect(b.lines[0].txHash).toBe("abc");
    expect(b.lines[1].timestamp).toBeNull();
  });

  it("exactly paid is fully repaid, not overpaid", () => {
    const b = buildRepaymentBreakdown({
      ...base,
      faceValue: 100n,
      repayments: [{ amount: 100n }],
    });
    expect(b.amountDue).toBe(0n);
    expect(b.isFullyRepaid).toBe(true);
    expect(b.isOverpaid).toBe(false);
  });

  it("overpayment clamps to zero and flags", () => {
    const b = buildRepaymentBreakdown({
      ...base,
      faceValue: 100n,
      repayments: [{ amount: 60n }, { amount: 70n }],
    });
    expect(b.amountDue).toBe(0n);
    expect(b.overpaid).toBe(30n);
    expect(b.isOverpaid).toBe(true);
  });

  it("zero face value is not 'fully repaid'", () => {
    const b = buildRepaymentBreakdown({
      ...base,
      faceValue: 0n,
      repayments: [],
    });
    expect(b.ok).toBe(true);
    expect(b.isFullyRepaid).toBe(false);
  });

  it("ignores invalid repayment records and counts them", () => {
    const b = buildRepaymentBreakdown({
      ...base,
      faceValue: 100n,
      repayments: [
        { amount: 10n },
        { amount: -5 },
        { amount: "x" },
        { amount: null },
        null as never,
      ],
    });
    expect(b.totalRepaid).toBe(10n);
    expect(b.invalidRecordCount).toBe(4);
    expect(b.lines).toHaveLength(1);
  });

  it("handles very large values exactly", () => {
    const face = 2n ** 100n;
    const b = buildRepaymentBreakdown({
      ...base,
      faceValue: face,
      repayments: [{ amount: 1n }],
    });
    expect(b.amountDue).toBe(face - 1n);
  });

  it("supports max precision and zero precision", () => {
    expect(
      buildRepaymentBreakdown({
        ...base,
        decimals: 18,
        faceValue: 10n ** 18n,
        repayments: [],
      }).formatted.faceValue,
    ).toBe("1.00 USDC");
    expect(
      buildRepaymentBreakdown({
        ...base,
        decimals: 0,
        faceValue: 5n,
        repayments: [],
      }).formatted.faceValue,
    ).toBe("5 USDC");
  });

  it.each([-1, 19, 1.5, NaN])(
    "rejects unsupported precision %s",
    (decimals) => {
      const b = buildRepaymentBreakdown({
        ...base,
        decimals,
        faceValue: 1n,
        repayments: [],
      });
      expect(b.ok).toBe(false);
      expect(b.error).toBe("invalid-precision");
    },
  );

  it.each([-1n, "1.2", undefined, null, "abc"])(
    "rejects invalid face value %s",
    (faceValue) => {
      const b = buildRepaymentBreakdown({ ...base, faceValue, repayments: [] });
      expect(b.ok).toBe(false);
      expect(b.error).toBe("invalid-face-value");
    },
  );

  it("reports data unavailable", () => {
    expect(
      buildRepaymentBreakdown({ ...base, faceValue: 1n, repayments: null })
        .error,
    ).toBe("data-unavailable");
    expect(
      buildRepaymentBreakdown({
        ...base,
        source: "unavailable",
        faceValue: 1n,
        repayments: [],
      }).error,
    ).toBe("data-unavailable");
  });
});

describe("buildInvoiceRepaymentBreakdown", () => {
  const inv = (o: Partial<Invoice> = {}) =>
    ({
      id: "x",
      status: "Confirmed",
      asset: "USDC",
      faceValue: 1_000_000_000n,
      repaidAt: null,
      ...o,
    }) as Invoice;

  it("unrepaid invoice: full balance due, source invoice-status", () => {
    const b = buildInvoiceRepaymentBreakdown(inv());
    expect(b.amountDue).toBe(1_000_000_000n);
    expect(b.source).toBe("invoice-status");
  });

  it("repaid invoice: one line for face value", () => {
    const b = buildInvoiceRepaymentBreakdown(
      inv({ status: "Repaid", repaidAt: 1_700_000_000 }),
    );
    expect(b.amountDue).toBe(0n);
    expect(b.lines).toHaveLength(1);
    expect(b.lines[0].timestamp).toBe(1_700_000_000);
  });

  it("prefers explicit repayment records", () => {
    const b = buildInvoiceRepaymentBreakdown({
      ...inv(),
      repayments: [{ amount: 100_000_000n }],
    } as Invoice);
    expect(b.source).toBe("indexer-repayments");
    expect(b.amountDue).toBe(900_000_000n);
  });

  it("missing invoice is unavailable; unsupported asset is invalid precision", () => {
    expect(buildInvoiceRepaymentBreakdown(null).error).toBe("data-unavailable");
    expect(
      buildInvoiceRepaymentBreakdown(inv({ asset: "BTC" as never })).error,
    ).toBe("invalid-precision");
  });
});
