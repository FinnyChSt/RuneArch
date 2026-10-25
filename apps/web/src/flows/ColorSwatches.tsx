import { FLOW_COLORS, flowColorVar } from '../canvas/flowColors';

/** Radio group of the flow palette */
export function ColorSwatches({ value, onChange }: { value: string; onChange(color: string): void }) {
  return (
    <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-1.5">
      {FLOW_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          title={c}
          onClick={() => onChange(c)}
          className={`size-5 rounded-full ring-offset-2 ring-offset-surface-raised ${value === c ? 'ring-2 ring-text' : ''}`}
          style={{ background: flowColorVar(c) }}
        />
      ))}
    </div>
  );
}
