// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';

/**
 * Stepped progress indicator for the calculator flow.
 *
 * Renders a horizontal row of numbered circles connected by lines.
 * Completed steps use a solid primary fill; the current step uses a
 * ring; upcoming steps are gray. The connector line fills up to the
 * current step so the user can see progress at a glance.
 *
 * Server-compatible (no hooks, no client directives) — parent can render
 * it from either a server or client component.
 */
interface StepIndicatorProps {
  /** Ordered step labels. */
  steps: string[];
  /** Zero-based index of the currently active step. */
  currentStep: number;
}

export default function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <nav aria-label="Progress" className="mb-8">
      <ol className="flex items-center">
        {steps.map((label, index) => {
          const isComplete = index < currentStep;
          const isCurrent = index === currentStep;
          const isLast = index === steps.length - 1;

          return (
            <li key={label} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
              {/* Step circle */}
              <div className="flex flex-col items-center">
                <div
                  aria-current={isCurrent ? 'step' : undefined}
                  className={[
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors',
                    isComplete
                      ? 'bg-primary-600 text-white'
                      : isCurrent
                        ? 'border-2 border-primary-600 bg-white text-primary-600'
                        : 'border-2 border-gray-200 bg-white text-gray-400',
                  ].join(' ')}
                >
                  {isComplete ? (
                    <svg
                      aria-hidden="true"
                      focusable="false"
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </div>
                <span
                  className={[
                    'mt-1.5 hidden text-[10px] font-medium sm:block',
                    isCurrent ? 'text-primary-700' : isComplete ? 'text-gray-600' : 'text-gray-400',
                  ].join(' ')}
                >
                  {label}
                </span>
              </div>

              {/* Connector line — fills to the right of each step except the last */}
              {!isLast && (
                <div
                  aria-hidden="true"
                  className={[
                    'mx-2 mt-0 h-0.5 flex-1 self-start pt-4',
                  ].join(' ')}
                >
                  <div
                    className={[
                      'h-0.5 w-full',
                      isComplete ? 'bg-primary-600' : 'bg-gray-200',
                    ].join(' ')}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
