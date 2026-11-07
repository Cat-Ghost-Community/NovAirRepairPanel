import type { AssignTicketCard } from "./assign-shared";

export function reconcileAssignmentSelection(selected:ReadonlyMap<number,AssignTicketCard>, current:readonly AssignTicketCard[]) {
  const result=new Map<number,AssignTicketCard>();
  for(const card of current){const previous=selected.get(card.id);if(previous&&previous.branch_id===card.branch_id&&previous.assignment_version===card.assignment_version&&previous.workflow_revision===card.workflow_revision&&previous.technician_id===card.technician_id&&previous.technician2_id===card.technician2_id)result.set(card.id,card);}
  return result;
}

export function selectAssignmentRange(selected:ReadonlyMap<number,AssignTicketCard>,cards:readonly AssignTicketCard[],id:number,anchor:number|null,shift:boolean){
  const next=new Map(selected),target=cards.findIndex(card=>card.id===id),start=cards.findIndex(card=>card.id===anchor);
  if(target<0)return next;
  const checked=!next.has(id),range=shift&&start>=0?cards.slice(Math.min(start,target),Math.max(start,target)+1):[cards[target]];
  for(const card of range){if(checked)next.set(card.id,card);else next.delete(card.id);}
  return next;
}
