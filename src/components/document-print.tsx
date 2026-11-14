import {documentPrintCss,type PrintPaper,type PrintSettings} from '@/lib/print-settings';

export function DocumentPrintStyles({settings,paper}:{settings:PrintSettings;paper?:PrintPaper}){
  return <><style data-document-print>{documentPrintCss(settings,paper)}</style><span hidden data-print-settings data-footer={settings.print_footer} data-phone={settings.business_phone} data-address={settings.business_address}/></>;
}
export function DocumentBrand({name,settings}:{name:string;settings:PrintSettings}){
  return <div className="document-brand"><div className="document-brand-name">{name}</div>
    {settings.business_phone&&<div className="document-contact"><bdi dir="ltr">{settings.business_phone}</bdi></div>}
    {settings.business_address&&<div className="document-contact">{settings.business_address}</div>}
  </div>;
}
export function DocumentFooter({settings}:{settings:PrintSettings}){
  return settings.print_footer?<footer className="document-footer">{settings.print_footer}</footer>:null;
}
