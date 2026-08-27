# Badge

Status atom — mono, uppercase, pill. Deep tinted chip by default; `quiet` drops the chip and leaves the tone as text.

```jsx
<Badge tone="warn">Waiting approval</Badge>
<Badge tone="brand">AI</Badge>
<Badge tone="good" quiet>Resolved</Badge>
```
neutral=closed/low, brand=triaged/AI, good=resolved/low-risk, warn=waiting/medium-risk, serious=open/high-priority, critical=urgent/high-risk/failed, info=in progress.
