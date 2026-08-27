export interface StatTileProps{label:string;value:React.ReactNode;unit?:string;/** Tint the tile when the number needs attention */highlight?:"warn"|"critical"|"brand"}
export function StatTile(props:StatTileProps):JSX.Element;
