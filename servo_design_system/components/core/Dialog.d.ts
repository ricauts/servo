export interface DialogProps{title?:React.ReactNode;description?:React.ReactNode;children?:React.ReactNode;confirmLabel?:string;cancelLabel?:string;onConfirm?:()=>void;onCancel?:()=>void;tone?:"primary"|"danger";/** Render the panel only, without scrim */inline?:boolean}
export function Dialog(props:DialogProps):JSX.Element;
