export interface SlaBadgeProps{state?:"met"|"ok"|"at_risk"|"breached"|"none";/** Human deadline text, e.g. "2h left" */label?:string;kind?:"response"|"resolution"}
export function SlaBadge(props:SlaBadgeProps):JSX.Element;
