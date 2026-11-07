/** Report sources require their own permission in addition to reports.view. */
export const REPORT_SOURCE_PERMISSIONS:Record<string,string>={
  repairs:"repairs.view",invoices:"invoices.view",sales:"sales.view",payments:"payments.view",parts:"inventory.view",customers:"customers.view",
};
