/** Shared role definitions; no database initialization or server framework imports. */
export const ROLE_LABELS: Record<string, string> = {
  owner: "صاحب کسب‌وکار",
  admin: "مدیر سیستم",
  manager: "مدیر",
  reception: "پذیرش",
  technician: "تعمیرکار",
  inventory: "مسئول انبار",
  accountant: "حسابدار",
  sales: "فروشنده",
};

const ALL = ["*"];
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ALL,
  admin: ALL,
  manager: [
    "repairs.*", "customers.*", "devices.*", "inventory.*", "suppliers.*", "purchasing.*",
    "sales.*", "invoices.*", "payments.*", "estimates.*", "expenses.view", "expenses.manage",
    "reports.view", "communication.view", "communication.send", "warranty.*", "complaints.*", "appointments.*",
    "team.view", "dashboard.*", "portal.manage", "finance.view", "settings.view",
    "repairs.assign",
    "chat.view", "chat.dm", "chat.group.create", "chat.group.manage", "chat.channel.create",
    "chat.channel.post", "chat.files", "chat.moderate", "chat.pin", "chat.presence",
  ],
  reception: [
    "repairs.view", "repairs.create", "repairs.edit", "repairs.status", "repairs.deliver",
    "customers.*", "devices.*", "estimates.view", "estimates.create", "estimates.send",
    "invoices.view", "invoices.create", "payments.view", "payments.create", "payments.refund",
    "sales.*", "communication.view", "communication.send", "appointments.*", "complaints.view", "complaints.manage",
    "warranty.view", "warranty.create", "dashboard.*", "portal.manage",
    "chat.view", "chat.dm", "chat.group.create", "chat.channel.post", "chat.files", "chat.pin", "chat.presence",
  ],
  technician: [
    "repairs.view", "repairs.edit", "repairs.status", "repairs.parts.add", "repairs.notes",
    "devices.view", "customers.view", "estimates.view", "estimates.create", "inventory.view",
    "dashboard.*", "warranty.view", "communication.send",
    "chat.view", "chat.dm", "chat.files", "chat.presence",
  ],
  inventory: [
    "inventory.*", "suppliers.*", "purchasing.*", "parts.view", "dashboard.*",
    "reports.view", "devices.view",
    "chat.view", "chat.dm", "chat.files", "chat.presence",
  ],
  accountant: [
    "invoices.*", "payments.*", "expenses.*", "reports.view", "finance.*",
    "customers.view", "repairs.view", "sales.view", "purchasing.view", "suppliers.view",
    "dashboard.*",
    "chat.view", "chat.dm", "chat.files", "chat.presence",
  ],
  sales: [
    "sales.*", "customers.*", "devices.view", "inventory.view", "invoices.view",
    "invoices.create", "payments.view", "payments.create", "dashboard.*", "estimates.view", "estimates.create",
    "chat.view", "chat.dm", "chat.files", "chat.presence",
  ],
};
