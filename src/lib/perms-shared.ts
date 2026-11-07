/**
 * بررسی مجوز در سمت کلاینت — هیچ وابستگی‌ای به node:sqlite ندارد.
 *
 * فهرست مؤثر مجوزهای کاربر سمت سرور محاسبه می‌شود (effectivePermissions) و
 * به‌صورت آرایه به پوسته (Shell) می‌رسد. این ماژول فقط همان آرایه را می‌خواند،
 * پس هم در سرور و هم در کلاینت قابل استفاده است.
 */

/** پشتیبانی از wildcard: «repairs.*» همهٔ repairs.anything را پوشش می‌دهد */
export function hasPerm(perms: string[] | null | undefined, perm: string): boolean {
  if (!perms || perms.length === 0) return false;
  const mod = perm.split(".")[0];
  if (perms.includes("!*") || perms.includes(`!${mod}.*`) || perms.includes(`!${perm}`)) return false;
  if (perms.includes("*")) return true;
  if (perms.includes(perm)) return true;
  return perms.includes(`${mod}.*`);
}

/** آیا کاربر با این فهرست مجوز، حداقل یکی از موارد را دارد؟ */
export function hasAnyPerm(perms: string[] | null | undefined, list: string[]): boolean {
  return list.some((p) => hasPerm(perms, p));
}
