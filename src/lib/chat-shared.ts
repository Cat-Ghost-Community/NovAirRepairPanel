/**
 * ثابت‌ها و ابزارهای مشترک چت — بدون وابستگی سروری (قابل استفاده در کلاینت و سرور).
 * نرمال‌سازی جست‌وجو باید «حفظ‌طول» باشد تا موقعیت تطبیق در متن اصلی قابل محاسبه بماند.
 */

export const CHAT_TYPES = ["direct", "group", "channel"] as const;
export type ChatType = (typeof CHAT_TYPES)[number];

export const CHAT_TYPE_FA: Record<string, string> = {
  direct: "خصوصی",
  group: "گروه",
  channel: "کانال",
};

export const ENTITY_TYPE_FA: Record<string, string> = {
  repair: "پذیرش",
  customer: "مشتری",
  purchase_order: "سفارش خرید",
  part: "قطعه",
  invoice: "فاکتور",
  warranty: "گارانتی",
  branch: "شعبه",
};

/** واکنش‌های مجاز — مجموعهٔ کوچک و پرکاربرد */
export const REACTION_SET = ["👍", "❤️", "😂", "🎉", "✅", "👀", "🙏"] as const;

/** پسوندهای پیش‌فرض مجاز (قابل تنظیم در تنظیمات → گفتگوی داخلی) */
export const DEFAULT_ALLOWED_EXT = [
  "jpg", "jpeg", "png", "webp", "gif", "mp4", "webm", "pdf",
  "doc", "docx", "xls", "xlsx", "txt", "csv", "zip", "rar", "7z",
].join(",");

/** پسوندهایی که هرگز آپلود نمی‌شوند (اجرایی/اسکریپتی) */
export const BLOCKED_EXT = [
  "html", "htm", "svg", "js", "mjs", "cjs", "php", "jsp", "asp", "aspx",
  "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "sh", "jar", "apk", "dll", "vbs",
];

export function fileExt(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

export function isImageMime(mime: string): boolean {
  return /^image\//i.test(mime);
}

/** پیش‌نمایش امن متن پیام برای فهرست و اعلان */
export function chatPreview(body: string | null | undefined, kind?: string | null, attachmentCount = 0): string {
  if (kind === "system") return Array.from(body ?? "").slice(0, 120).join("");
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (text) {const characters=Array.from(text);return characters.length>90?characters.slice(0,90).join("")+"…":text;}
  if (attachmentCount > 0) return "📎 پیوست";
  return "پیام";
}

/** نرمال‌سازی برای جست‌وجوی فارسی: ي→ی، ك→ک، حذف نیم‌فاصله/کنترل‌ها و اعراب، لاتین کوچک */
export function normalizeFaWithMap(input: string): { text: string; map: number[] } {
  const src = String(input ?? "");
  let out = "";
  const map: number[] = [];
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    const code = ch.charCodeAt(0);
    // نویسه‌های نامرئی: نیم‌فاصله، نشانه‌های جهت و کاراکترهای کنترلی قالب‌بندی
    if (code === 0x200c || code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) || code === 0x2066 || code === 0x2069) continue;
    // اعراب عربی
    if ((code >= 0x064b && code <= 0x065f) || code === 0x0670) continue;
    if (ch === "ي") ch = "ی";
    else if (ch === "ك") ch = "ک";
    else if (ch === "ة" || ch === "ۀ") ch = "ه";
    out += ch.toLowerCase();
    map.push(i);
  }
  return { text: out, map };
}

export function normalizeFa(input: string): string {
  return normalizeFaWithMap(input).text;
}

export function fmtSize(bytes: number | null | undefined): string {
  const n = Number(bytes ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "۰";
  const fa = (v: string) => v.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  if (n < 1024) return fa(String(Math.round(n))) + " بایت";
  if (n < 1024 * 1024) return fa((n / 1024).toFixed(1).replace(/\.0$/, "")) + " کیلوبایت";
  return fa((n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")) + " مگابایت";
}

// ---- شکل داده‌های مشترک بین API و UI ----

export type ChatUserBrief = {
  id: number;
  name: string;
  role: string;
  branch_id: number | null;
  branch_name?: string | null;
  avatar_color: string;
  online?: boolean;
  last_seen_at?: string | null;
};

export type ChatAttachmentInfo = {
  id: number;
  filename: string;
  mime: string;
  size: number;
};

export type ChatReactionInfo = {
  emoji: string;
  count: number;
  mine: boolean;
};

export type ChatReplyInfo = {
  id: number;
  sender_name: string | null;
  body: string;
  kind: string;
  deleted: boolean;
  has_attachment: boolean;
};

export type ChatMessage = {
  id: number;
  conversation_id: number;
  sender_id: number | null;
  sender_name: string | null;
  sender_color: string | null;
  kind: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  pinned: boolean;
  reply_to: ChatReplyInfo | null;
  attachments: ChatAttachmentInfo[];
  reactions: ChatReactionInfo[];
  mentions: number[];
  client_key: string | null;
};

export type ChatMemberInfo = {
  user_id: number;
  name: string;
  role: string;
  conv_role: string;
  avatar_color: string;
  joined_at: string;
  last_read_message_id: number;
  online?: boolean;
  last_seen_at?: string | null;
};

export type ChatEntityCard = {
  entity_type: string;
  entity_id: number;
  title: string;
  subtitle: string;
  status?: string | null;
  status_color?: string | null;
  tech_name?: string | null;
  branch_name?: string | null;
  updated_at?: string | null;
  href: string | null;
  missing?: boolean;
};

export type ChatConversationListItem = {
  id: number;
  type: ChatType;
  title: string;
  description: string | null;
  avatar_color: string | null;
  entity_type: string | null;
  entity_id: number | null;
  entity_title: string | null;
  branch_id: number | null;
  last_message_at: string | null;
  last_message: {
    sender_name: string | null;
    body: string;
    kind: string;
    created_at: string;
    mine: boolean;
    status?: "sent" | "read";
  } | null;
  unread_count: number;
  mention_count: number;
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  member_count: number;
  dm_user: ChatUserBrief | null;
  last_read_message_id: number;
};

export type ChatConversationDetails = {
  conversation: ChatConversationListItem & { history_for_new_members: boolean; created_by: number | null };
  members: ChatMemberInfo[];
  my_role: string;
  entity_card: ChatEntityCard | null;
  pinned_messages: ChatMessage[];
  files: Array<{ id: number; filename: string; mime: string; size: number; created_at: string; sender_name: string | null }>;
  can_post: boolean;
  can_manage: boolean;
};

export type ChatEventsResponse = {
  cursor: number;
  events: Array<{ id: number; conversation_id: number; type: string; payload: any; actor_id: number | null }>;
  typing: Array<{ conversation_id: number; user_id: number; name: string }>;
  presence: Array<{ user_id: number; online: boolean; last_seen_at: string | null }>;
  unread_total: number;
};

export const CHAT_FILTERS = [
  { key: "all", label: "همه" },
  { key: "unread", label: "نخوانده" },
  { key: "direct", label: "خصوصی" },
  { key: "group", label: "گروهی" },
  { key: "channel", label: "کانال‌ها" },
  { key: "pinned", label: "سنجاق‌شده" },
  { key: "mentions", label: "منشن من" },
  { key: "archived", label: "آرشیو" },
] as const;
export type ChatFilter = (typeof CHAT_FILTERS)[number]["key"];
