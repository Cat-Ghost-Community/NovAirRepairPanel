/** Stored kinds retain catalog provenance and historical financial evidence. */
export const REPAIR_SERVICE_LABEL = 'خدمات تعمیر';
export function isRepairService(kind: unknown): boolean {
  return kind === 'labor' || kind === 'service' || kind === 'fee';
}
export function chargeKindLabel(kind: string, documentType='repair'): string {
  if (kind==='fee'&&documentType==='purchase') return 'هزینه جانبی';
  if (isRepairService(kind)) return documentType==='repair'?REPAIR_SERVICE_LABEL:'خدمات';
  return ({part:'قطعه / کالا',product:'محصول',device:'دستگاه',other:'سایر'} as Record<string,string>)[kind] ?? kind;
}
