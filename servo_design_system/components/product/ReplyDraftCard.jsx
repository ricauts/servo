import React from "react";
import { Button } from "../core/Button.jsx";
import { Textarea } from "../core/Textarea.jsx";
import { Icon } from "../core/Icon.jsx";

export function ReplyDraftCard({ draftedBy, when, value, recipient, onChange, onApprove, onRegenerate, onDiscard }) {
  return (
    <section className="svo-draft">
      <div>
        <div className="svo-draft-title"><Icon name="pencil-line" size={15} color="var(--brand)" />AI reply draft — review before sending</div>
        <div className="svo-draft-by">Drafted by {draftedBy} {when}</div>
      </div>
      <Textarea rows={8} value={value} onChange={onChange ? (e) => onChange(e.target.value) : undefined} />
      <div className="svo-draft-note">Approving posts this as a public comment and emails it to {recipient}. Their reply threads back onto this ticket.</div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
        <Button variant="primary" size="sm" onClick={onApprove} iconStart={<Icon name="mail" size={14} />}>Approve &amp; send</Button>
        <Button variant="outline" size="sm" onClick={onRegenerate} iconStart={<Icon name="refresh-cw" size={14} />}>Regenerate</Button>
        <Button variant="ghost" size="sm" onClick={onDiscard}>Discard</Button>
      </div>
    </section>
  );
}
