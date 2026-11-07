import {notFound} from 'next/navigation';
import Link from 'next/link';
import {requirePageAccess} from '@/lib/page-access';
import {DeviceTypesManager} from './device-types-manager';
export const dynamic='force-dynamic';
export default async function DeviceTypesPage(){
 const session=await requirePageAccess('/settings/device-types');if(session.user.role!=='owner')notFound();
 return <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-4"><div className="page-head"><h1 className="page-title">انواع دستگاه و فرم پذیرش</h1><p className="page-sub">نوع، عنوان، ترتیب و الزام فیلدها را برای تمام شعبه‌ها مدیریت کنید.</p><Link className="btn-ghost mt-2" href="/devices">بازگشت به دستگاه‌ها</Link></div><DeviceTypesManager/></div>;
}
