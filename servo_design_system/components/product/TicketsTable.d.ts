/** @startingPoint section="Desk" subtitle="The ticket queue" viewport="1100x300" */
export interface TicketRow{number:number;title:string;requester:string;status:"OPEN"|"TRIAGED"|"IN_PROGRESS"|"WAITING_APPROVAL"|"RESOLVED"|"CLOSED";priority:"LOW"|"MEDIUM"|"HIGH"|"URGENT";category:string;assignee?:string|null;assigneeIsAi?:boolean;slaState?:"met"|"ok"|"at_risk"|"breached"|"none";slaLabel?:string;updated?:string}
export interface TicketsTableProps{rows:TicketRow[];onRowClick?:(row:TicketRow)=>void}
export function TicketsTable(props:TicketsTableProps):JSX.Element;
