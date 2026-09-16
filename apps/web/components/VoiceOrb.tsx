/**
 * Decorative presence orb used on the marketing hero and (at a larger size)
 * as the visual heart of the live interview studio.
 */
export function VoiceOrb({
  size = 220,
  speaking = false,
  listening = false,
  label,
}: {
  size?: number;
  speaking?: boolean;
  listening?: boolean;
  label?: string;
}) {
  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
      aria-hidden={!label}
      aria-label={label}
    >
      <span
        className="absolute inset-0 rounded-full opacity-70 blur-2xl"
        style={{
          background:
            "conic-gradient(from 180deg, oklch(0.62 0.18 278), oklch(0.78 0.1 200), oklch(0.7 0.12 85), oklch(0.62 0.18 278))",
          animation: speaking || listening ? "orb-spin 10s linear infinite" : "orb-spin 22s linear infinite",
        }}
      />
      <span
        className="absolute rounded-full"
        style={{
          inset: size * 0.1,
          background:
            "radial-gradient(circle at 35% 30%, oklch(0.92 0.04 90), oklch(0.22 0.06 275) 70%)",
          animation: listening ? "orb-pulse 3.2s ease-in-out infinite" : speaking ? "breathe 1.6s ease-in-out infinite" : undefined,
          boxShadow: speaking
            ? "0 0 0 1px oklch(0.8 0.1 278 / 0.4), 0 20px 60px oklch(0.4 0.16 278 / 0.35)"
            : "0 20px 50px oklch(0.25 0.08 275 / 0.28)",
        }}
      />
      <span
        className="relative z-10 rounded-full bg-[var(--color-ink)] text-white shadow-[inset_0_1px_0_oklch(1_0_0_/_0.18)]"
        style={{ width: size * 0.34, height: size * 0.34 }}
      />
    </div>
  );
}
