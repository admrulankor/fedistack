import * as React from "react";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      isLoading = false,
      disabled,
      className = "",
      children,
      type = "button",
      ...props
    },
    ref
  ) {
    const baseClasses =
      "inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

    const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> =
      {
        primary:
          "bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline-slate-900",
        secondary:
          "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 focus-visible:outline-slate-900",
        danger:
          "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
        ghost:
          "bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:outline-slate-900"
      };

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        aria-busy={isLoading}
        className={`${baseClasses} ${variantClasses[variant]} ${className}`.trim()}
        {...props}
      >
        {children}
      </button>
    );
  }
);

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    { id, name, label, error, helperText, className = "", ...props },
    ref
  ) {
    const slugifiedLabel = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const inputId = id ?? (name ? `input-${name}` : `input-${slugifiedLabel}`);
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    const describedBy = [
      error ? errorId : undefined,
      helperText ? helperId : undefined
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-slate-900"
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          name={name}
          suppressHydrationWarning
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy.length > 0 ? describedBy : undefined}
          className={`block w-full rounded-md border px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-0 ${
            error
              ? "border-red-500 focus:border-red-500 focus:ring-red-500"
              : "border-slate-300 focus:border-slate-900 focus:ring-slate-900"
          } ${className}`.trim()}
          {...props}
        />
        {helperText && !error ? (
          <p id={helperId} className="text-xs text-slate-500">
            {helperText}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} role="alert" className="text-xs font-medium text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    );
  }
);

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Card({ className = "", children, ...props }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-6 shadow-sm ${className}`.trim()}
      {...props}
    >
      {children}
    </div>
  );
}

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "info" | "success" | "warning" | "error";
  title?: string;
  children: React.ReactNode;
}

export function Alert({
  variant = "info",
  title,
  className = "",
  children,
  ...props
}: AlertProps) {
  const variantStyles: Record<NonNullable<AlertProps["variant"]>, string> = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-900"
  };

  return (
    <div
      role={variant === "error" || variant === "warning" ? "alert" : "status"}
      className={`rounded-lg border p-4 text-sm ${variantStyles[variant]} ${className}`.trim()}
      {...props}
    >
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "admin" | "success";
  children: React.ReactNode;
}

export function Badge({
  variant = "default",
  className = "",
  children,
  ...props
}: BadgeProps) {
  const styles: Record<NonNullable<BadgeProps["variant"]>, string> = {
    default: "bg-slate-100 text-slate-800 border-slate-200",
    admin: "bg-indigo-50 text-indigo-800 border-indigo-200",
    success: "bg-emerald-50 text-emerald-800 border-emerald-200"
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[variant]} ${className}`.trim()}
      {...props}
    >
      {children}
    </span>
  );
}
