import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RepaymentBreakdown } from "./RepaymentBreakdown";
import type { Invoice } from "@/types";

const inv = (o: Partial<Invoice> = {}) =>
  ({
    id: "x",
    status: "Confirmed",
    asset: "USDC",
    faceValue: 1_000_000_000n,
    repaidAt: null,
    ...o,
  }) as Invoice;

describe("RepaymentBreakdown", () => {
  it("shows amount due, empty repayments and data source", () => {
    render(<RepaymentBreakdown invoice={inv()} />);
    expect(screen.getByTestId("rb-amount-due")).toHaveTextContent(
      "100.00 USDC",
    );
    expect(screen.getByTestId("rb-total-repaid")).toHaveTextContent(
      "0.00 USDC",
    );
    expect(screen.getByText("No repayments recorded.")).toBeInTheDocument();
    expect(
      screen.getByText(/Data source: Indexed invoice record/),
    ).toBeInTheDocument();
    expect(screen.getByText("7 decimals")).toBeInTheDocument();
  });

  it("shows fully repaid with a line", () => {
    render(
      <RepaymentBreakdown
        invoice={inv({ status: "Repaid", repaidAt: 1_700_000_000 })}
      />,
    );
    expect(screen.getByText("Fully repaid.")).toBeInTheDocument();
    expect(screen.getByTestId("rb-amount-due")).toHaveTextContent("0.00 USDC");
    expect(
      screen.getByRole("list", { name: "Recorded repayments" }).children,
    ).toHaveLength(1);
  });

  it("flags overpayment and invalid records", () => {
    render(
      <RepaymentBreakdown
        invoice={
          {
            ...inv(),
            repayments: [{ amount: 1_100_000_000n }, { amount: "bad" }],
          } as Invoice
        }
      />,
    );
    expect(screen.getByText(/Overpaid by 10.00 USDC/)).toBeInTheDocument();
    expect(
      screen.getByText(/1 repayment record\(s\) with invalid amounts/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Indexed repayment records/)).toBeInTheDocument();
  });

  it("renders loading, error, missing and invalid-asset states", () => {
    const { rerender } = render(<RepaymentBreakdown isLoading />);
    expect(screen.getByText("Loading repayment data...")).toBeInTheDocument();
    rerender(<RepaymentBreakdown invoice={inv()} error={new Error("boom")} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "currently unavailable",
    );
    rerender(<RepaymentBreakdown invoice={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
    rerender(<RepaymentBreakdown invoice={inv({ asset: "BTC" as never })} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "precision is unsupported",
    );
  });
});
