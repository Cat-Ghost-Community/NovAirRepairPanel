import {documentNumber} from './document-number';

export function trackingExample(settings:Record<string,string>){
 const configured=settings.tracking_ticket_example?.trim();
 return configured||'مثلاً '+documentNumber('ticket','R',1,4,settings);
}
