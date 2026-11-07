import {HttpError} from './http-error';
import {validateId} from './validate-id';
import {accountingDate} from './accounting-date';
import {rial,sumRial} from './money';
export type JournalLine = { account_code: string; debit?: number; credit?: number; memo?: string;
  customer_id?: number | null; supplier_id?: number | null; employee_id?: number | null; part_id?: number | null; bank_account_id?: number | null };
export type JournalInput = { branch_id: number; posting_date: string; memo: string; event_key: string;
  source_type: string; source_id: string; lines: JournalLine[]; reversal_of?: number | null };
export type Line=Required<JournalLine>&{position:number};
export const journalDimensions=['customer_id','supplier_id','employee_id','part_id','bank_account_id'] as const;
const dimensions=journalDimensions;
export function ledgerText(value: unknown, name: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new HttpError(400, `${name} معتبر نیست.`);
  return value.trim();
}
export function normalizeJournal(input: JournalInput): Omit<JournalInput,"lines"> & {lines: Line[]} {
  if(!input||typeof input!=='object')throw new HttpError(400,'اطلاعات سند معتبر نیست.');
  const lines = input.lines;
  if (!Array.isArray(lines) || lines.length<2 || lines.length>500) throw new HttpError(400,"سند باید بین دو تا پانصد سطر داشته باشد.");
  const normalized = lines.map((line,position) => {
    if (!line || typeof line!=="object") throw new HttpError(400,"سطر سند معتبر نیست.");
    const debit = rial(line.debit ?? 0), credit = rial(line.credit ?? 0);
    if ((debit===0)===(credit===0)) throw new HttpError(400,"هر سطر فقط یک مبلغ بدهکار یا بستانکار مثبت دارد.");
    const dimensionsValue = Object.fromEntries(dimensions.map(key => [key,line[key]==null?null:validateId(line[key])]));
    if (line.memo!=null && (typeof line.memo!=="string" || line.memo.length>500)) throw new HttpError(400,"شرح سطر معتبر نیست.");
    return {position,account_code:ledgerText(line.account_code,"کد سرفصل",20),debit,credit,memo:line.memo?.trim()??"",...dimensionsValue} as Line;
  });
  if (sumRial(normalized.map(l=>l.debit))!==sumRial(normalized.map(l=>l.credit))) throw new HttpError(400,"جمع بدهکار و بستانکار سند برابر نیست.");
  return {branch_id:validateId(input.branch_id),posting_date:accountingDate(input.posting_date),memo:ledgerText(input.memo,"شرح سند"),
    source_type:ledgerText(input.source_type,"نوع مرجع",60),source_id:ledgerText(input.source_id,"شناسهٔ مرجع",100),event_key:ledgerText(input.event_key,"شناسهٔ رویداد",160),
    reversal_of:input.reversal_of==null?null:validateId(input.reversal_of),lines:normalized};
}
