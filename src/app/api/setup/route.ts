import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { USER_COOKIE } from "@/lib/auth";
import { AUTH_SETTING_KEYS, needsSetup } from "@/lib/authjs";
import { ensureToolPolicies } from "@/lib/ai/custom-tools";
import { ensureSlaPolicies } from "@/lib/sla";
import { ensureOpsSchema, syncAgentProfiles, syncPlugins, syncSkills } from "@/lib/bootstrap";
import { AI_AGENT_COLORS, SETUP_ADMIN_COLOR } from "@/lib/avatar";

export const dynamic = "force-dynamic";

const setupSchema = z.object({
  adminName: z.string().trim().min(1, "Your name is required").max(80),
  adminEmail: z.string().email("A valid email is required"),
  // Optional SSO tenant, configurable later from Integrations as well.
  oidcIssuer: z.string().trim().max(500).optional(),
  oidcClientId: z.string().trim().max(300).optional(),
  oidcClientSecret: z.string().trim().max(500).optional(),
  oidcProviderName: z.string().trim().max(60).optional(),
});

/**
 * POST /api/setup — bootstrap a fresh self-hosted install: the first ADMIN,
 * the three system AI agents, default tool/SLA policies, and (optionally)
 * the company's OIDC tenant. Refuses to run once any human user exists, so
 * it can never hijack a live install.
 */
export async function POST(req: NextRequest) {
  if (!(await needsSetup())) {
    return Response.json(
      { error: "This install is already set up." },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const email = data.adminEmail.toLowerCase();

  const admin = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name: data.adminName, email, role: "ADMIN", color: SETUP_ADMIN_COLOR },
    });
    // System AI agents: the engine looks these up by aiKind.
    const agents = [
      { name: "Servo Triage", email: "triage@servo.ai", aiKind: "TRIAGE", color: AI_AGENT_COLORS.TRIAGE },
      { name: "Servo Resolver", email: "resolver@servo.ai", aiKind: "RESOLVER", color: AI_AGENT_COLORS.RESOLVER },
      { name: "Servo QA", email: "qa@servo.ai", aiKind: "QA", color: AI_AGENT_COLORS.QA },
    ];
    for (const agent of agents) {
      await tx.user.upsert({
        where: { email: agent.email },
        create: { ...agent, role: "AI_AGENT" },
        update: {},
      });
    }
    const settings: { key: string; value: string }[] = [
      // The bootstrap admin keeps ADMIN across OIDC sign-ins.
      { key: AUTH_SETTING_KEYS.adminEmails, value: email },
    ];
    if (data.oidcIssuer && data.oidcClientId && data.oidcClientSecret) {
      settings.push(
        { key: AUTH_SETTING_KEYS.issuer, value: data.oidcIssuer },
        { key: AUTH_SETTING_KEYS.clientId, value: data.oidcClientId },
        { key: AUTH_SETTING_KEYS.clientSecret, value: data.oidcClientSecret },
        {
          key: AUTH_SETTING_KEYS.providerName,
          value: data.oidcProviderName || "SSO",
        },
      );
    }
    for (const s of settings) {
      await tx.setting.upsert({
        where: { key: s.key },
        create: s,
        update: { value: s.value },
      });
    }
    return created;
  });

  await ensureToolPolicies();
  await ensureSlaPolicies();
  await syncAgentProfiles();
  await syncSkills();
  // cnp-06: plugins install beside the bundled skills — everything they
  // ship arrives disabled.
  await syncPlugins();
  await ensureOpsSchema();

  // Demo-mode installs act as the new admin immediately; OIDC installs go
  // through /login next.
  const store = await cookies();
  store.set(USER_COOKIE, admin.id, { httpOnly: true, sameSite: "lax" });

  return Response.json({ ok: true, adminId: admin.id }, { status: 201 });
}
