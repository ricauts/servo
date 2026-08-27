export type BadgeTone="neutral"|"brand"|"good"|"warn"|"serious"|"critical"|"info";
export interface BadgeProps{tone?:BadgeTone;/** Tone as bare text, no chip — dense rows with several badges */quiet?:boolean;/** Solid green fill — counts and "AI" marks only */solid?:boolean;square?:boolean;icon?:React.ReactNode;children?:React.ReactNode;className?:string}
export function Badge(props:BadgeProps):JSX.Element;
