import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {requirePageAccess} from '@/lib/page-access';
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresShellState} from '@/lib/db/pg-shell';
import {hasPerm} from '@/lib/perms-shared';
import {RepairWorkflowSettings} from '../repair-workflow-settings';
import {SettingsSection} from '../section';

export const dynamic='force-dynamic';

/** The other settings panels remain unavailable in the isolated PostgreSQL
 * profile until their own persistence boundaries are migrated. */
export default async function RepairWorkflowPage(){
 if(!postgresIntegration())redirect('/settings#repair-routing');
 await requirePageAccess('/settings/repair-workflow');
 const store=await cookies(),state=await postgresShellState(store.get('repaid_session')?.value,store.get('repaid_branch')?.value);
 if(!state.session)redirect('/login');
 const canEdit=['owner','admin'].includes(state.session.user.role)&&hasPerm(state.permissions,'settings.edit');
 return <div className="space-y-6 min-w-0">
  <div><h1 className="page-title">تنظیمات مسیر پذیرش و ارجاع</h1><p className="page-sub">روش ارجاع و سرپرستان هر شعبه را مستقل تنظیم کنید؛ سابقهٔ ارجاع‌ها و اسناد قبلی حفظ می‌شود.</p></div>
  <SettingsSection id="repair-routing" index={1} icon="clipboard" title="مسیر پذیرش و ارجاع" desc="شرح هر روش را ببینید و گردش کار مناسب شعبه را انتخاب کنید.">
   <RepairWorkflowSettings canEdit={canEdit} branches={state.branches}/>
  </SettingsSection>
 </div>;
}
