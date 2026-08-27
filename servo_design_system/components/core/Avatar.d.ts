export interface AvatarProps{name?:string;/** Overrides the name-derived palette colour */color?:string;size?:number;/** AI agents get a squared avatar reading "AI" */isAi?:boolean}
export function Avatar(props:AvatarProps):JSX.Element;
