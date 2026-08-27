# RunSummary

An agent run as one folded timeline entry — headline, tool trail, QA verdict; steps inside.

```jsx
<RunSummary agentName="Frontend Agent" status="COMPLETED" qaVerdict="PASS" took="42s" when="2h ago" stepCount={9} toolTrail={["github_read_file ×2","github_edit_file"]} decisions={[{approved:true,by:"Ana"}]}>
  <RunStep kind="tool">github_edit_file</RunStep>
</RunSummary>
```
Runs that are RUNNING or WAITING_APPROVAL open by default; finished history folds.
