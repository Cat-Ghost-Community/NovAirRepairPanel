"use client";

import { useToast } from "@/components/ui";

export function EstimateActions({ estimateId, status, token }: { estimateId: number; status: string; token: string }) {
  const toast = useToast();
  return (
    <button
      className="btn-secondary btn-sm"
      onClick={() => {
        const url = `${window.location.origin}/track/estimate/${token}`;
        navigator.clipboard.writeText(url).then(
          () => toast("لینک تأیید مشتری کپی شد"),
          () => toast(url, "info")
        );
      }}
    >
      کپی لینک مشتری
    </button>
  );
}
