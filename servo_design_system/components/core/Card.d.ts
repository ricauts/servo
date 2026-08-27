export interface CardProps extends React.HTMLAttributes<HTMLElement>{title?:React.ReactNode;description?:React.ReactNode;action?:React.ReactNode;footer?:React.ReactNode;/** false = no body padding (tables, charts bleed to the edge) */padded?:boolean;children?:React.ReactNode}
export function Card(props:CardProps):JSX.Element;
