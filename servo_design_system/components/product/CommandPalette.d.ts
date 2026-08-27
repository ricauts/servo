export interface CommandItem{label:string;icon?:string;number?:number}
export interface CommandPaletteProps{query?:string;onQueryChange?:(q:string)=>void;groups?:Array<{label:string;items:CommandItem[]}>;activeIndex?:number;onSelect?:(item:CommandItem)=>void}
export function CommandPalette(props:CommandPaletteProps):JSX.Element;
