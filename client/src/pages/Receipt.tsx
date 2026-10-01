import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api, type Receipt } from "../api";
import { Nav } from "../components/Nav";
import { StepForm, type FlowStep } from "../flow/StepForm";
import { formatKes, formatWhen } from "../format";

const STEPS: Record<Receipt["kind"], readonly FlowStep[]> = {
  deposit: [
    { id: "amount", title: "How much?" },
    { id: "phone", title: "Pay with M-Pesa" },
    { id: "wait", title: "Approve on your phone" },
    { id: "receipt", title: "Receipt" },
  ],
  withdraw: [
    { id: "amount", title: "How much?" },
    { id: "phone", title: "Receive on M-Pesa" },
    { id: "wait", title: "Approve on your phone" },
    { id: "receipt", title: "Receipt" },
  ],
  transfer: [
    { id: "amount", title: "How much?" },
    { id: "confirm", title: "Confirm send" },
    { id: "receipt", title: "Receipt" },
  ],
};

function kindLabel(kind: Receipt["kind"]): string {
  if (kind === "deposit") return "Add";
  if (kind === "withdraw") return "Out";
  return "Send";
}

export function ReceiptPage(): React.ReactElement {
  const params = useParams();
  const navigate = useNavigate();
  const id = params["id"] ?? "";
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (id.length === 0) return;
    let active = true;
    api
      .payment(id)
      .then((row) => {
        if (active) setReceipt(row);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.message : "Could not open that receipt.");
      });
    return () => {
      active = false;
    };
  }, [id]);

  const steps = receipt === null ? STEPS.deposit : STEPS[receipt.kind];
  const last = steps.length - 1;
  const downloadButton =
    receipt?.status === "succeeded" ? (
      <button type="button" className="primary" disabled={downloading} onClick={() => void download()}>
        {downloading ? "Preparing PDF…" : "Download receipt"}
      </button>
    ) : null;

  async function download(): Promise<void> {
    if (receipt === null || downloading) return;
    const paymentId = receipt.id;
    const code = receipt.receiptNumber?.replace(/[^0-9A-Za-z-]/g, "") ?? "receipt";
    setDownloading(true);
    // Leave the receipt immediately and finish the save in the background,
    // the same way Sherehe leaves the stub before the PDF is ready.
    void navigate("/", { replace: true });
    try {
      const response = await fetch(`/api/payments/${paymentId}/receipt.pdf`, { credentials: "include" });
      if (!response.ok) return;
      const raw = await response.blob();
      const blob = new Blob([raw], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pesamatters-${code}.pdf`;
      link.rel = "noopener";
      link.style.display = "none";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
    } catch {
      // Already on the homepage. A failed save should not keep the member on the receipt.
    }
  }

  return (
    <>
      <main className="screen" id="main">
        <StepForm
          steps={steps}
          step={last}
          onBack={() => navigate("/you")}
          {...(downloadButton !== null ? { footer: downloadButton } : {})}
        >
          {error !== null ? (
            <p className="alert" role="alert">
              {error}
            </p>
          ) : null}
          {receipt === null && error === null ? <p className="hint">Opening receipt…</p> : null}
          {receipt !== null ? (
            <article className="receipt-slip">
              <header className="receipt-slip-head">
                <p className="receipt-brand">PesaMatters</p>
                <p className="receipt-kind">{kindLabel(receipt.kind)}</p>
              </header>
              <p className="money-hero">{formatKes(receipt.amountCents)}</p>
              <dl className="receipt-facts">
                <div>
                  <dt>From</dt>
                  <dd>{receipt.actorName}</dd>
                </div>
                {receipt.counterpartyName !== null ? (
                  <div>
                    <dt>To</dt>
                    <dd>{receipt.counterpartyName}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>When</dt>
                  <dd>{formatWhen(receipt.createdAt)}</dd>
                </div>
                {receipt.blockId !== null ? (
                  <div>
                    <dt>Block</dt>
                    <dd>{receipt.blockId}</dd>
                  </div>
                ) : null}
                {receipt.mpesaReceipt !== null ? (
                  <div>
                    <dt>M-Pesa</dt>
                    <dd>{receipt.mpesaReceipt}</dd>
                  </div>
                ) : null}
              </dl>
              {receipt.receiptNumber !== null && receipt.blockHash !== null ? (
                <div className="receipt-code">
                  <p className="receipt-code-label">Receipt</p>
                  <p className="receipt-code-value">{receipt.receiptNumber}</p>
                  <p className="hash">{receipt.blockHash}</p>
                  <p className="receipt-code-note">The first 12 digits of this ledger hash.</p>
                </div>
              ) : null}
              {receipt.status === "pending" || receipt.status === "settling" ? (
                <p className="hint">Still waiting for M-Pesa to confirm.</p>
              ) : null}
              {receipt.status === "failed" ? <p className="alert">This move did not complete.</p> : null}
              <p className="hint">
                <Link to="/you">Back to activity</Link>
              </p>
            </article>
          ) : null}
        </StepForm>
      </main>
      <Nav />
    </>
  );
}
