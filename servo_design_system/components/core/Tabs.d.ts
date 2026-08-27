export interface TabsProps{tabs:Array<string|{value:string;label:string;count?:number}>;value?:string;onChange?:(value:string)=>void}
export function Tabs(props:TabsProps):JSX.Element;
