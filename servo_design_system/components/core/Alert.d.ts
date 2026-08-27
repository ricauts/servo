export interface AlertProps{tone?:"brand"|"good"|"warn"|"critical";title?:React.ReactNode;children?:React.ReactNode}
export function Alert(props:AlertProps):JSX.Element;
