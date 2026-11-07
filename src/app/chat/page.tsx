import { requirePageAccess } from "@/lib/page-access";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { canUser, effectivePermissions, getSessionByToken } from "@/lib/auth";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresShellState} from '@/lib/db/pg-shell';
import {hasPerm} from '@/lib/perms-shared';
import { ChatClient } from "./chat-client";

export const dynamic = "force-dynamic";

function num(v: string | undefined): number | null {
  return v && /^\d+$/.test(v) ? Number(v) : null;
}

export default async function ChatPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAccess("/chat");
  const cookieStore = await cookies();
  const {session,perms}=await(async()=>{
    if(postgresIntegration()){
      const state=await postgresShellState(cookieStore.get('repaid_session')?.value,cookieStore.get('repaid_branch')?.value);
      if(!state.session)redirect('/login');
      if(!hasPerm(state.permissions,'chat.view'))redirect('/');
      return {session:state.session,perms:state.permissions};
    }
    const session=getSessionByToken(cookieStore.get('repaid_session')?.value);
    if(!session)redirect('/login');
    if(!canUser(session,'chat.view'))redirect('/');
    return {session,perms:effectivePermissions(session.user.role,session.user.id)};
  })();
  const sp = await searchParams;
  return (
    <div className="h-full">
      <ChatClient
        me={{ id: session.user.id, name: session.user.name, avatar_color: session.user.avatar_color }}
        perms={perms}
        initialConversationId={num(sp.c)}
        initialMessageId={num(sp.m)}
      />
    </div>
  );
}
