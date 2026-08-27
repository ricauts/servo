export interface SidebarNavItem{href?:string;label:string;/** Lucide icon name */icon:string;count?:number;/** Green solid count — something is waiting on a human */attention?:boolean}
export interface SidebarNavProps{items:SidebarNavItem[];active?:string;onNavigate?:(href:string)=>void}
export function SidebarNav(props:SidebarNavProps):JSX.Element;
