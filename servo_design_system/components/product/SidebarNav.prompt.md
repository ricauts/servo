# SidebarNav

The desk's primary navigation. Approvals carries a solid green count when a human is blocking a run.

```jsx
<SidebarNav active="/tickets" items={[{href:"/tickets",label:"Tickets",icon:"inbox",count:15},{href:"/approvals",label:"Approvals",icon:"shield-check",count:2,attention:true}]} />
```
