'use client';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface QuantitySelectorProps {
  /** Current quantity value. */
  value: number;
  /** Called when the user changes the quantity. */
  onChange: (quantity: number) => void;
  /** Minimum allowed value (default 1). */
  min?: number;
  /** Maximum allowed value (default 99). */
  max?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Numeric input for quantity with +/- buttons.
 *
 * Clamps between {@link min} (default 1) and {@link max} (default 99).
 */
export default function QuantitySelector({
  value,
  onChange,
  min = 1,
  max = 99,
}: QuantitySelectorProps) {
  function clamp(n: number): number {
    return Math.max(min, Math.min(max, n));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    // Allow empty input while typing
    if (raw === '') return;
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n)) {
      onChange(clamp(n));
    }
  }

  function decrement() {
    onChange(clamp(value - 1));
  }

  function increment() {
    onChange(clamp(value + 1));
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="quantity" className="text-sm font-medium text-gray-700">
        Quantity
      </label>
      <div className="flex items-center">
        <button
          type="button"
          onClick={decrement}
          disabled={value <= min}
          className="inline-flex h-8 w-8 items-center justify-center rounded-l-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Decrease quantity"
        >
          −
        </button>
        <input
          id="quantity"
          type="number"
          value={value}
          onChange={handleChange}
          min={min}
          max={max}
          className="h-8 w-16 border-y border-gray-300 text-center text-sm [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          onClick={increment}
          disabled={value >= max}
          className="inline-flex h-8 w-8 items-center justify-center rounded-r-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>
      <span className="text-xs text-gray-400">(1–{max})</span>
    </div>
  );
}