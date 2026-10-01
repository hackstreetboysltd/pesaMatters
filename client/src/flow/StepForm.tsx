import type { ReactElement, ReactNode } from "react";

export type FlowStep = { id: string; title: string };

export function StepForm({
  steps,
  step,
  onBack,
  children,
  footer,
  title,
  action,
  showProgress = true,
  className,
}: {
  steps: readonly FlowStep[];
  step: number;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Override the step title. Pass `null` to hide it. React nodes are allowed for designed headings. */
  title?: ReactNode;
  action?: ReactNode;
  /** Progress segments for multi-step flows. Hide on status/desk views. */
  showProgress?: boolean;
  className?: string;
}): ReactElement {
  const current = steps[step];
  const heading = title === undefined ? (current?.title ?? "") : title;
  const showTitleRow = heading !== null || action !== undefined;
  return (
    <div className={className === undefined ? "step-form" : `step-form ${className}`}>
      <header className="step-head">
        {showProgress ? (
          <div className="step-progress-row">
            {onBack !== undefined && step > 0 ? (
              <button type="button" className="back-link step-back" aria-label="Back" onClick={onBack}>
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5" />
                  <path d="M12 5l-7 7 7 7" />
                </svg>
              </button>
            ) : (
              <span className="step-back-spacer" aria-hidden="true" />
            )}
            <div
              className="step-progress"
              role="progressbar"
              aria-valuenow={step + 1}
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-label={`Progress, step ${step + 1} of ${steps.length}`}
            >
              {steps.map((item, index) => (
                <span key={item.id} className="step-progress-seg" data-filled={index <= step ? "true" : "false"} aria-hidden="true" />
              ))}
            </div>
            <span className="step-back-spacer" aria-hidden="true" />
          </div>
        ) : null}
        {showTitleRow ? (
          <div className="step-title-row">
            {heading !== null ? (
              <h1 id="step-title" className="screen-title">
                {heading}
              </h1>
            ) : (
              <span className="step-title-spacer" aria-hidden="true" />
            )}
            {action !== undefined ? <div className="step-title-action">{action}</div> : null}
          </div>
        ) : null}
      </header>
      <div className="step-body">{children}</div>
      {footer !== undefined ? <div className="step-footer">{footer}</div> : null}
    </div>
  );
}
