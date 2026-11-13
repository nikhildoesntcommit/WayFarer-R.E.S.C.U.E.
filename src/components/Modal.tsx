import type { ReactNode } from 'react';

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label={title} onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** A number with its unit in small caps, per the visual spec. */
export function Num({ v, unit, digits = 0, className = '' }: { v: number; unit?: string; digits?: number; className?: string }) {
  const text = Number.isFinite(v) ? v.toFixed(digits) : '—';
  return (
    <span className={`num ${className}`}>
      {text}
      {unit ? <span className="unit">{unit}</span> : null}
    </span>
  );
}

export function Stamp({ kind, children }: { kind: 'pass' | 'warn' | 'critical'; children: ReactNode }) {
  return <span className={`stamp ${kind}`}>{children}</span>;
}
