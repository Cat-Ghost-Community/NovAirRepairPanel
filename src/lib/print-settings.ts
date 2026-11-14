export const PRINT_DEFAULTS = {
  print_paper: 'a4', print_receipt_paper: 'a5', print_font_size: '11', print_margin: '10',
  print_density: 'standard', print_accent: '#222222', print_header_align: 'right',
  print_show_signature: '1', print_footer: '', business_phone: '', business_address: '',
};
export type PrintSettingKey = keyof typeof PRINT_DEFAULTS;
export const PRINT_SETTING_KEYS = Object.keys(PRINT_DEFAULTS) as PrintSettingKey[];
export type PrintPaper = 'a4' | 'a5' | 'roll';
export type PrintSettings = typeof PRINT_DEFAULTS;
const choices: Partial<Record<PrintSettingKey,readonly string[]>> = {
  print_paper:['a4','a5'],print_receipt_paper:['a4','a5','roll'],print_density:['compact','standard'],
  print_header_align:['right','center'],print_show_signature:['0','1'],
};
export function printSettingError(key: PrintSettingKey, value: string): string | null {
  const options=choices[key];
  if (options && !options.includes(value)) return 'گزینهٔ تنظیم چاپ معتبر نیست.';
  if (['print_font_size','print_margin'].includes(key)) {
    const minimum=key==='print_font_size'?9:5,maximum=key==='print_font_size'?14:20;
    if (!/^\d+$/.test(value)||Number(value)<minimum||Number(value)>maximum) return `مقدار چاپ باید عدد صحیح بین ${minimum} و ${maximum} باشد.`;
  }
  if (key==='print_accent'&&!/^#[\da-f]{6}$/i.test(value)) return 'رنگ چاپ باید کد شش‌رقمی مانند #222222 باشد.';
  if (['print_footer','business_address'].includes(key)&&(value.length>600||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))) return 'متن سند حداکثر ۶۰۰ نویسه و بدون نویسهٔ کنترلی باشد.';
  if (key==='business_phone'&&(value.length>80||/[\u0000-\u001f]/.test(value))) return 'شمارهٔ تماس سند معتبر نیست.';
  return null;
}
export function parsePrintSettings(values: Record<string,unknown>): PrintSettings {
  const result={...PRINT_DEFAULTS};
  for (const key of PRINT_SETTING_KEYS) {
    const value=typeof values[key]==='string'?(values[key] as string).trim():undefined;
    if(value!==undefined&&!printSettingError(key,value))result[key]=value;
  }
  return result;
}
export function printPaper(value: unknown, fallback: string): PrintPaper {
  return value==='a4'||value==='a5'||value==='roll'?value:fallback==='roll'?'roll':fallback==='a5'?'a5':'a4';
}
/** Only validated enum, integer and hex values enter CSS. User text stays in escaped markup. */
export function documentPrintCss(values: PrintSettings, paper?: PrintPaper): string {
  const settings=parsePrintSettings(values),selected=printPaper(paper??settings.print_paper,'a4');
  const margin=selected==='roll'?3:Number(settings.print_margin),font=selected==='roll'?10:Number(settings.print_font_size);
  return `.document-sheet{--document-accent:${settings.print_accent};--document-font:${font}pt;--document-cell:${settings.print_density==='compact'?'1.5mm':'2.5mm'};overflow-wrap:anywhere}
.document-brand{text-align:${settings.print_header_align};color:inherit}.document-brand-name{font-size:1.45em;font-weight:800}.document-contact{font-size:.85em;line-height:1.8;white-space:pre-line}.document-footer{white-space:pre-line;font-size:.85em;border-top:1px solid #d4d4d8;margin-top:6mm;padding-top:3mm;line-height:1.8}
${settings.print_show_signature==='0'?'.document-signature-lines{display:none}':''}
@page{size:${selected==='roll'?'80mm 297mm':selected.toUpperCase()};margin:${margin}mm;@bottom-left{content:${selected==='roll'?'none':'counter(page) " / " counter(pages)'};direction:ltr;font-family:Tahoma,sans-serif;font-size:8pt;color:#52525b}}
@media print{.document-sheet{color:#18181b;font-size:var(--document-font);line-height:1.65;font-family:var(--font-vazir),Estedad Variable,Vazirmatn,Tahoma,sans-serif!important;width:100%!important;max-width:none!important;margin:0!important;padding:0!important;border:0!important;box-shadow:none!important;background:#fff!important}
.document-sheet table{width:100%;border-collapse:collapse;table-layout:auto}.document-sheet th,.document-sheet td{font-size:.88em;padding:var(--document-cell);vertical-align:top;overflow-wrap:anywhere}.document-sheet th{font-weight:700;color:#18181b!important;background:#f4f4f5!important;border-bottom:1px solid var(--document-accent)}
.document-sheet thead{display:table-header-group}.document-sheet tr,.document-brand,.document-signature-lines,.document-signed-evidence,.document-footer{break-inside:avoid;page-break-inside:avoid}.document-sheet h1,.document-sheet h2,.document-sheet h3{break-after:avoid}.document-sheet img{max-width:100%;object-fit:contain}.document-sheet [class*="text-zinc-"]{color:#3f3f46!important}.document-sheet [class*="dark:"]{border-color:#d4d4d8}.document-sheet .document-brand{border-color:var(--document-accent)}
.document-sheet .overflow-x-auto{overflow:visible!important}.document-money{white-space:nowrap;font-variant-numeric:tabular-nums}.document-contact{color:#52525b}.document-brand{color:var(--document-accent);print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;
}
