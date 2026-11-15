"use client";

import { Input, Label, Separator, TextField, toast } from "@heroui/react";

import { toAppError } from "@/lib/query/errors";

/** Toasts for every write: the receipt confirms, the error explains. */
export function feedback(done: string, then?: () => void) {
  return {
    onSuccess: () => {
      toast.success(done);
      then?.();
    },
    onError: (error: unknown) => toast.danger(toAppError(error).message),
  };
}

/** Runs a sandbox call with the same toasts as a contract write. */
export async function attempt(task: () => Promise<void>, done: string) {
  try {
    await task();
    toast.success(done);
  } catch (error) {
    toast.danger(toAppError(error).message);
  }
}

export function Row({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Separator />
      <span className="text-xs font-semibold">{title}</span>
      {children}
    </div>
  );
}

export function Note({ children }: { readonly children: React.ReactNode }) {
  return <span className="text-xs text-muted">{children}</span>;
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
}) {
  return (
    <TextField
      className="flex flex-col gap-1"
      value={value}
      onChange={onChange}
    >
      <Label className="text-xs">{label}</Label>
      <Input placeholder={placeholder} variant="secondary" />
    </TextField>
  );
}
