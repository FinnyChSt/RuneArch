import type { FeatureRole } from '@flowcanvas/shared';
import type { CSSProperties } from 'react';
import { ROLE_LABEL } from '../canvas/featureView';

const STYLE: Record<FeatureRole, string> = {
  added: 'border-transparent bg-[var(--feature-color,var(--accent))] text-canvas',
  changed: 'border-[var(--feature-color,var(--accent))] text-[var(--feature-color,var(--accent))]',
  uses: 'border-border text-text-muted',
  removed: 'border-danger text-danger',
};

/** NEW / CHANGED / EXISTING / REMOVED, like the canvas badges (colored by --feature-color) */
export function RoleBadge({ role, color }: { role: FeatureRole; color?: string }) {
  return (
    <span
      className={`inline-block rounded border px-1 text-[9px] leading-[14px] font-semibold tracking-wide uppercase ${STYLE[role]}`}
      style={color ? ({ '--feature-color': color } as CSSProperties) : undefined}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}
