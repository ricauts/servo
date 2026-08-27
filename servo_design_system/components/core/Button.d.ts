export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>{variant?:"primary"|"outline"|"ghost"|"subtle"|"danger"|"link";size?:"xs"|"sm"|"md"|"lg"|"xl";/** Render as a square icon-only button */icon?:boolean|React.ReactNode;iconStart?:React.ReactNode;iconEnd?:React.ReactNode}
export function Button(props:ButtonProps):JSX.Element;
