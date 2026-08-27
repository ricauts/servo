export interface ReplyDraftCardProps{draftedBy:string;when?:string;value?:string;recipient?:string;onChange?:(next:string)=>void;onApprove?:()=>void;onRegenerate?:()=>void;onDiscard?:()=>void}
export function ReplyDraftCard(props:ReplyDraftCardProps):JSX.Element;
