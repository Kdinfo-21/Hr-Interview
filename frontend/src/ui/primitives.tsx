import { ReactNode } from "react";

/** Rounded status pill with a leading dot, used across dashboard/report views. */
export function StatusBadge({
  label,
  className = "bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200",
  dotClassName,
}: {
  label: string;
  className?: string;
  dotClassName?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-tight ${className}`}
    >
      {dotClassName && <span className={`h-1.5 w-1.5 rounded-full ${dotClassName}`} />}
      {label}
    </span>
  );
}

/** Compact metric card for dashboard summary rows. Purely presentational. */
export function StatCard({
  label,
  value,
  icon,
  accent = "text-brand-700 bg-brand-50 ring-1 ring-inset ring-brand-200/70",
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-ink-200 bg-white p-4 shadow-card transition-shadow duration-200 hover:shadow-card-hover">
      {icon && (
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${accent}`}>{icon}</div>
      )}
      <div className="min-w-0">
        <div className="font-display text-2xl font-semibold leading-tight text-ink-900">{value}</div>
        <div className="truncate text-xs font-medium text-ink-500">{label}</div>
      </div>
    </div>
  );
}

/** Thin horizontal progress bar, e.g. for "question X of N". */
export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-ink-200 ${className}`}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400 transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Consistent section heading used across pages for clear visual hierarchy. */
export function SectionHeading({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
  return (
    <div>
      {eyebrow && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">{eyebrow}</p>
      )}
      <h1 className="font-display text-[1.9rem] font-semibold leading-tight tracking-tight text-ink-900">{title}</h1>
      {description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-500">{description}</p>}
    </div>
  );
}
