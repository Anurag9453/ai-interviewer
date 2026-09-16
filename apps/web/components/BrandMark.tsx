export function BrandMark({
  size = 28,
  className = "",
  inverted = false,
}: {
  size?: number;
  className?: string;
  inverted?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-[10px] shadow-[inset_0_1px_0_oklch(1_0_0_/_0.18)] ${
        inverted ? "bg-white text-[var(--color-ink)]" : "bg-[var(--color-ink)] text-white"
      } ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 4v2.5M8.2 6.4l1.4 2.1M15.8 6.4l-1.4 2.1"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M7 13.5c1.4 2.4 3 3.6 5 3.6s3.6-1.2 5-3.6"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12.2" r="2.15" fill="currentColor" />
      </svg>
    </span>
  );
}

export function BrandWordmark({ className = "", inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <BrandMark inverted={inverted} />
      <span className={`text-[15px] font-semibold tracking-tight ${inverted ? "text-white" : ""}`}>
        Interviewer
      </span>
    </span>
  );
}
