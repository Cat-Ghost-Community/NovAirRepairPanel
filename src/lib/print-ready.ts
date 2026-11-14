import {escapeHtml} from './html';
import {PRINT_FONT_ROOT} from './network-policy';

/** Print after local fonts and document images settle; failed images never block printing. */
export async function printWhenReady(){
  if(document.fonts)await document.fonts.ready;
  await Promise.all(Array.from(document.images).map(image=>image.decode().catch(()=>undefined)));
  window.print();
}

/** Callers open synchronously and escape data cells before passing their table markup. */
export function printDocumentWindow(target:Window,title:string,content:string){
  const settings=document.querySelector<HTMLElement>('[data-print-settings]')?.dataset;
  const styles=document.querySelector('[data-document-print]')?.textContent??'';
  const footer=settings?.footer?`<footer class="document-footer">${escapeHtml(settings.footer)}</footer>`:'';
  const contact=settings?.phone||settings?.address?`<div class="document-brand document-contact">${escapeHtml(settings.phone??'')}<br>${escapeHtml(settings.address??'')}</div>`:'';
  target.document.write(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@font-face{font-family:Vazirmatn;src:url('${PRINT_FONT_ROOT}/Vazirmatn-Regular.woff2') format('woff2');font-weight:400}
@font-face{font-family:Vazirmatn;src:url('${PRINT_FONT_ROOT}/Vazirmatn-Bold.woff2') format('woff2');font-weight:700}
*{box-sizing:border-box}body{font-family:Vazirmatn,Tahoma,sans-serif;margin:24px;color:#18181b;background:white}table{border-collapse:collapse;width:100%}th,td{padding:6px;border:1px solid #d4d4d8;text-align:right}h1{font-size:18px}h2{font-size:13px}${styles}
</style></head><body class="document-sheet">${contact}${content}${footer}</body></html>`);
  target.document.close();
  void target.document.fonts.load('11px Vazirmatn').catch(()=>[]).then(()=>target.document.fonts.ready).then(async()=>{
    await Promise.all(Array.from(target.document.images).map(image=>image.decode().catch(()=>undefined)));
    if(!target.closed)target.print();
  });
}
