"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { resendSubmission } from "./actions";

/** Redelivers an accepted outbound submission when the first delivery did not
 * reach the partner. See `resendSubmission` for what this does and does not
 * record. */
export function ResendButton({ submissionId }: { submissionId: number }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const result = await resendSubmission(submissionId);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={pending}>
      {pending ? "Resending..." : "Resend"}
    </Button>
  );
}
