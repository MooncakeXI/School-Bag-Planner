"use client";

import type { ComponentProps, MouseEvent } from "react";
import { Button } from "@/components/ui/button";

export function ConfirmSubmitButton({
  confirmMessage,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick"> & { confirmMessage: string }) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (!window.confirm(confirmMessage)) event.preventDefault();
  }

  return <Button {...props} onClick={handleClick} />;
}
