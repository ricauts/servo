export interface TableColumn{key:string;label?:React.ReactNode;width?:string|number;align?:"left"|"right"|"center";/** Render the cell in mono, muted — ids and counts */mono?:boolean;render?:(row:any)=>React.ReactNode}
export interface TableProps{columns:TableColumn[];rows:any[];onRowClick?:(row:any)=>void}
export function Table(props:TableProps):JSX.Element;
