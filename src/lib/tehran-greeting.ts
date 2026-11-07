export function tehranGreeting(date:Date|number=new Date()){
 const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tehran',hour:'2-digit',hourCycle:'h23'}).format(date));
 if(hour<5||hour>=20)return 'شب بخیر';if(hour<12)return 'صبح بخیر';if(hour<17)return 'بعدازظهر بخیر';return 'عصر بخیر';
}
