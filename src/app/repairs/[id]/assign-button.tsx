"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { AssignModal, type AssignModalItem } from "@/components/assign-modal";

/**
 * دکمهٔ «ارجاع به تعمیرکار» در صفحهٔ پذیرش — همان مودال و همان منطق سرور
 * که کارتابل مدیر شعبه استفاده می‌کند (تک‌مسیره، بدون نسخهٔ جداگانه).
 */
export function AssignButton({ item }: { item: AssignModalItem }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button className="btn-secondary btn-sm inline-flex items-center gap-1.5 no-underline" onClick={() => setOpen(true)} title="ارجاع یا ارجاع مجدد به تعمیرکار">
        <Icon name="user-check" size={13} />
        {item.expect != null ? "ارجاع مجدد" : "ارجاع به تعمیرکار"}
      </button>
      {open && (
        <AssignModal
          open
          items={[item]}
          onClose={() => setOpen(false)}
          onDone={() => {
            // تازه‌سازی نرم صفحه (بدون رفرش کامل مرورگر)
            router.refresh();
          }}
        />
      )}
    </>
  );
}
