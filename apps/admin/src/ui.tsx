import { clsx } from "clsx";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: Parameters<typeof clsx>): string {
  return twMerge(clsx(inputs));
}

export const c = {
  background: "var(--bg)",
  backgroundAlt: "var(--bg)",
  surface: "var(--surface)",
  surfaceSunken: "var(--sunken)",
  surfaceRaised: "var(--surface)",
  textPrimary: "var(--ink)",
  textSecondary: "var(--ink-2)",
  textTertiary: "var(--ink-3)",
  textOnAccent: "var(--on-acc)",
  textOnBrand: "var(--on-acc)",
  border: "var(--line)",
  borderStrong: "var(--line-2)",
  divider: "var(--line)",
  accent: "var(--acc)",
  accentPressed: "var(--acc-hover)",
  accentSubtle: "var(--acc-sub)",
  brand: "var(--acc)",
  brandPressed: "var(--acc-hover)",
  brandSubtle: "var(--acc-sub)",
  success: "var(--ok)",
  successSubtle: "var(--ok-sub)",
  warning: "var(--warn)",
  warningSubtle: "var(--warn-sub)",
  danger: "var(--bad)",
  dangerSubtle: "var(--bad-sub)",
  onDanger: "var(--on-acc)",
  skeleton: "var(--skeleton)",
  scrim: "var(--scrim)",
} as const;

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
} as const;

export const radius = {
  none: 0,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 10,
  xxl: 12,
  pill: 999,
} as const;

export const typography = {
  display: { fontFamily: "var(--font-ui)", fontSize: 24, lineHeight: 32, letterSpacing: 0 },
  h1: { fontFamily: "var(--font-ui)", fontSize: 20, lineHeight: 28, letterSpacing: 0 },
  h2: { fontFamily: "var(--font-ui)", fontSize: 17, lineHeight: 24, letterSpacing: 0 },
  h3: { fontFamily: "var(--font-ui)", fontSize: 15, lineHeight: 22 },
  bodyLg: { fontFamily: "var(--font-ui)", fontSize: 14, lineHeight: 22 },
  body: { fontFamily: "var(--font-ui)", fontSize: 13, lineHeight: 20 },
  bodyMedium: { fontFamily: "var(--font-ui)", fontSize: 13, lineHeight: 20 },
  caption: { fontFamily: "var(--font-ui)", fontSize: 12, lineHeight: 18 },
  overline: {
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  price: { fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 20 },
  button: { fontFamily: "var(--font-ui)", fontSize: 13, lineHeight: 20 },
} as const;

export const styles = {
  page: {
    minHeight: "100vh",
    background: c.background,
    color: c.textPrimary,
    fontFamily: "var(--font-ui)",
    fontSize: typography.body.fontSize,
    lineHeight: `${typography.body.lineHeight}px`,
  } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    padding: `0 ${spacing.lg}px`,
    background: c.surface,
    borderBottom: `1px solid ${c.border}`,
  } satisfies CSSProperties,

  content: {
    maxWidth: "none",
    margin: 0,
    padding: spacing.lg,
    display: "flex",
    flexDirection: "column",
    gap: spacing.base,
  } satisfies CSSProperties,

  card: {
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: radius.lg,
    overflow: "hidden",
    boxShadow: "var(--sh-1)",
  } satisfies CSSProperties,

  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: typography.body.fontSize,
    lineHeight: `${typography.body.lineHeight}px`,
  } satisfies CSSProperties,

  th: {
    height: 34,
    textAlign: "left" as const,
    padding: `0 ${spacing.md}px`,
    background: c.surfaceSunken,
    borderBottom: `1px solid ${c.border}`,
    fontFamily: "var(--font-mono)",
    fontSize: 10.5,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: c.textTertiary,
    fontWeight: 600,
    whiteSpace: "nowrap" as const,
  } satisfies CSSProperties,

  td: {
    height: 36,
    padding: `${spacing.sm - 1}px ${spacing.md}px`,
    borderBottom: `1px solid ${c.divider}`,
    verticalAlign: "middle" as const,
  } satisfies CSSProperties,

  input: {
    minHeight: 36,
    padding: `7px ${spacing.sm + 2}px`,
    border: `1px solid ${c.borderStrong}`,
    borderRadius: radius.md,
    background: c.surface,
    color: c.textPrimary,
    fontSize: typography.body.fontSize,
    fontFamily: "inherit",
    boxSizing: "border-box" as const,
  } satisfies CSSProperties,
};

type ButtonVariant = "primary" | "ghost" | "quiet" | "danger" | "destructive";
type ButtonSize = "xs" | "sm" | "md";

export function Button({
  children,
  className,
  size = "md",
  tone,
  variant,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  size?: ButtonSize;
  tone?: "brand" | "quiet" | "danger";
  variant?: ButtonVariant;
}) {
  const resolvedVariant: ButtonVariant =
    variant ?? (tone === "quiet" ? "ghost" : tone === "danger" ? "danger" : "primary");

  return (
    <button
      {...props}
      className={cn(
        "button",
        size === "xs" && "button-xs",
        size === "sm" && "button-sm",
        resolvedVariant === "primary" && "button-primary",
        resolvedVariant === "ghost" && "button-ghost",
        resolvedVariant === "quiet" && "button-quiet",
        resolvedVariant === "danger" && "button-danger",
        resolvedVariant === "destructive" && "button-destructive",
        className,
      )}
      type={type}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className,
  size = "md",
  variant = "ghost",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  children: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
}) {
  return (
    <Button
      {...props}
      aria-label={label}
      className={cn("button-icon", className)}
      size={size}
      title={label}
      variant={variant}
    >
      {children}
    </Button>
  );
}

export function Badge({
  text,
  tone,
  className,
}: {
  text: string;
  tone: "ok" | "warn" | "muted" | "bad" | "accent";
  className?: string;
}) {
  return <span className={cn("badge", `badge-${tone}`, className)}>{text}</span>;
}

export type SelectOption = {
  description?: ReactNode;
  disabled?: boolean;
  label: ReactNode;
  value: string;
};

export function Select({
  className,
  disabled = false,
  onChange,
  options,
  placeholder = "Выберите",
  value,
}: {
  className?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  value: string;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;

    const close = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("custom-select", className)} data-open={open || undefined}>
      <button
        aria-controls={id}
        aria-expanded={open}
        className="select-trigger"
        disabled={disabled}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selected ? "select-value" : "select-placeholder"}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={15} aria-hidden />
      </button>
      {open ? (
        <div id={id} className="select-menu" role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              className="select-option"
              data-selected={option.value === value || undefined}
              disabled={option.disabled}
              role="option"
              type="button"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="select-option-copy">
                <span className="select-option-label">{option.label}</span>
                {option.description ? <span className="select-option-description">{option.description}</span> : null}
              </span>
              {option.value === value ? <Check size={14} aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  description,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  className?: string;
}) {
  return (
    <section className={cn("page-stack", className)}>
      <div className="section-head">
        <div className="section-copy-block">
          <h2 className="section-title">{title}</h2>
          {description ? <p className="section-copy">{description}</p> : null}
        </div>
        {action ? <div className="section-action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
