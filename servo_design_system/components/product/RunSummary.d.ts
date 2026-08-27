/** @startingPoint section="Desk" subtitle="Folded agent run with tool trail and QA verdict" viewport="700x200" */
export interface RunDecision{approved:boolean;by?:string}
export interface RunSummaryProps{agentName:string;status?:"RUNNING"|"WAITING_APPROVAL"|"COMPLETED"|"FAILED";qaVerdict?:"PASS"|"FAIL";qaNotes?:string;/** Duration, e.g. "42s" */took?:string;when?:string;stepCount?:number;summary?:React.ReactNode;/** Tool names in call order, e.g. ["github_read_file ×2","github_open_pr"] */toolTrail?:string[];decisions?:RunDecision[];open?:boolean;children?:React.ReactNode}
export function RunSummary(props:RunSummaryProps):JSX.Element;
export interface RunStepProps{kind?:string;children?:React.ReactNode}
export function RunStep(props:RunStepProps):JSX.Element;
