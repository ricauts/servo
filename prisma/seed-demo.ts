/* eslint-disable no-console */
// OPTIONAL showcase dataset (`npm run demo`): fictional users, ~2 dozen
// tickets, runs, approvals and a populated ops sandbox so the dashboard is
// meaningful instantly. WIPES the database first — never run it on a live
// install. Fresh production installs use seed-core.ts + the /setup wizard.
//
// Seeds Servo's demo data: users, settings, tool policies, a sandbox "ops"
// database the AI agents operate on, and ~2 dozen tickets spread over the last
// 30 days (including AI-resolved runs and two pending approvals) so the KPI
// dashboard and the approvals inbox are meaningful from the first render.

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_TOOL_POLICIES } from "../src/lib/ai/tool-policies";
import { DEFAULT_SLA_POLICIES } from "../src/lib/sla-rules";
// The ops sandbox is its own PostgreSQL database behind the servo_ops_rw role
// (db-05); this seed writes through the same adapter the tools use, so the
// showcase data and the runtime agree on dialect and endpoint.
import { OPS_SCHEMA_QUERY as SCHEMA_QUERY, opsDisconnect, opsExecute } from "../src/lib/opsdb";

const db = new PrismaClient();

function daysAgo(days: number, hour = 10, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

async function main() {
  console.log("Seeding Servo…");

  // Before the wipe, never after: this seed populates the ops sandbox too, and
  // an install whose OPS_DATABASE_URL is missing or still a file: path would
  // otherwise lose its desk data to the wipe and then die on the first
  // sandbox statement, hundreds of rows later.
  await opsExecute("SELECT 1");

  // -- wipe (FK-safe order) -------------------------------------------------
  await db.approval.deleteMany();
  await db.agentStep.deleteMany();
  await db.agentRun.deleteMany();
  await db.agentProfile.deleteMany();
  await db.aiCredential.deleteMany();
  await db.aiUsage.deleteMany();
  await db.customTool.deleteMany();
  await db.comment.deleteMany();
  await db.ticket.deleteMany();
  await db.groupMember.deleteMany();
  await db.group.deleteMany();
  await db.webhookDelivery.deleteMany();
  await db.webhook.deleteMany();
  await db.toolPolicy.deleteMany();
  await db.slaPolicy.deleteMany();
  await db.setting.deleteMany();
  await db.user.deleteMany();

  // -- users ---------------------------------------------------------------
  const ana = await db.user.create({
    data: {
      name: "Ana Rodríguez",
      email: "ana@acme.dev",
      role: "ADMIN",
      color: "#4A3AA7",
    },
  });
  const bruno = await db.user.create({
    data: {
      name: "Bruno Chen",
      email: "bruno@acme.dev",
      role: "AGENT",
      color: "#1C5CAB",
    },
  });
  const elena = await db.user.create({
    data: {
      name: "Elena Duarte",
      email: "elena@acme.dev",
      role: "AGENT",
      color: "#7A2E8D",
    },
  });
  const farid = await db.user.create({
    data: {
      name: "Farid Khan",
      email: "farid@acme.dev",
      role: "AGENT",
      color: "#0F6E3F",
    },
  });
  const gabriela = await db.user.create({
    data: {
      name: "Gabriela Torres",
      email: "gabriela@acme.dev",
      role: "AGENT",
      color: "#A33B4F",
    },
  });
  const hiro = await db.user.create({
    data: {
      name: "Hiro Tanaka",
      email: "hiro@acme.dev",
      role: "AGENT",
      color: "#31567F",
    },
  });
  const iris = await db.user.create({
    data: {
      name: "Iris Volkov",
      email: "iris@acme.dev",
      role: "AGENT",
      color: "#5B4A17",
    },
  });
  const carla = await db.user.create({
    data: {
      name: "Carla Méndez",
      email: "carla@acme.dev",
      role: "REQUESTER",
      color: "#B4491F",
    },
  });
  const diego = await db.user.create({
    data: {
      name: "Diego Fontaine",
      email: "diego@acme.dev",
      role: "REQUESTER",
      color: "#8F6400",
    },
  });
  const aiTriage = await db.user.create({
    data: {
      name: "Servo Triage",
      email: "triage@servo.ai",
      role: "AI_AGENT",
      aiKind: "TRIAGE",
      color: "#0A6E66",
    },
  });
  const aiResolver = await db.user.create({
    data: {
      name: "Servo Resolver",
      email: "resolver@servo.ai",
      role: "AI_AGENT",
      aiKind: "RESOLVER",
      color: "#14625D",
    },
  });
  await db.user.create({
    data: {
      name: "Servo QA",
      email: "qa@servo.ai",
      role: "AI_AGENT",
      aiKind: "QA",
      color: "#52514E",
    },
  });

  // -- groups (assignment + escalation hierarchy) ---------------------------
  const devGroup = await db.group.create({
    data: {
      name: "Development",
      description: "Application software, internal tooling and deployments.",
      categories: JSON.stringify(["SOFTWARE", "DEVOPS"]),
      members: {
        create: [
          { userId: elena.id, seniority: "SENIOR" },
          { userId: farid.id, seniority: "MID" },
          { userId: gabriela.id, seniority: "JUNIOR" },
        ],
      },
    },
  });
  const analyticsGroup = await db.group.create({
    data: {
      name: "Analytics",
      description: "Databases, BI dashboards and data quality.",
      categories: JSON.stringify(["DATABASE"]),
      members: {
        create: [
          { userId: hiro.id, seniority: "SENIOR" },
          { userId: farid.id, seniority: "JUNIOR" },
        ],
      },
    },
  });
  const engGroup = await db.group.create({
    data: {
      name: "Engineering",
      description: "Devices, network, access and physical infrastructure.",
      categories: JSON.stringify(["HARDWARE", "NETWORK", "ACCESS"]),
      members: {
        create: [
          { userId: bruno.id, seniority: "SENIOR" },
          { userId: elena.id, seniority: "MID" },
          { userId: gabriela.id, seniority: "JUNIOR" },
          // Security specialist outside the ladder: takes any tier by load.
          { userId: iris.id, seniority: "STANDALONE" },
        ],
      },
    },
  });

  // -- specialized agent profiles (agents/*.md) ------------------------------
  const agentsDir = path.join(process.cwd(), "agents");
  if (fs.existsSync(agentsDir)) {
    for (const file of fs
      .readdirSync(agentsDir)
      .filter((f) => f.endsWith(".md"))
      .sort()) {
      const markdown = fs.readFileSync(path.join(agentsDir, file), "utf8");
      const { data, content } = matter(markdown);
      const name = String(data.name ?? "").trim();
      if (!name || !content.trim()) continue;
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      await db.agentProfile.create({
        data: {
          slug,
          name,
          description: String(data.description ?? "").trim(),
          categories: JSON.stringify(
            Array.isArray(data.categories) ? data.categories.map(String) : [],
          ),
          tools: JSON.stringify(
            Array.isArray(data.tools) ? data.tools.map(String) : [],
          ),
          systemPrompt: content.trim(),
          markdown,
        },
      });
    }
  }

  // -- settings ------------------------------------------------------------
  await db.setting.createMany({
    data: [
      { key: "ai.provider", value: "mock" }, // "anthropic" once a key is set
      { key: "ai.apiKey", value: "" },
      { key: "ai.baseUrl", value: "" },
      { key: "ai.model", value: "claude-opus-5" },
      { key: "ai.autoTriage", value: "true" },
      { key: "ai.qaEnabled", value: "true" },
    ],
  });

  // -- tool policies ---------------------------------------------------------
  // Shared with ensureToolPolicies() so seeded and upgraded installs agree.
  await db.toolPolicy.createMany({ data: DEFAULT_TOOL_POLICIES });

  // -- SLA policies ----------------------------------------------------------
  await db.slaPolicy.createMany({ data: DEFAULT_SLA_POLICIES });

  // -- sandbox ops database --------------------------------------------------
  for (const table of [
    "devices",
    "employees",
    "employees_backup",
    "software_licenses",
    "campaign_tracking",
  ]) {
    await opsExecute(`DROP TABLE IF EXISTS ${table};`);
  }

  await opsExecute(`
    CREATE TABLE devices (
      asset_tag TEXT PRIMARY KEY, model TEXT NOT NULL, type TEXT NOT NULL,
      assigned_to TEXT, status TEXT NOT NULL, os TEXT,
      purchased_at TEXT, warranty_until TEXT
    );`);
  await opsExecute(`
    CREATE TABLE employees (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name TEXT NOT NULL,
      email TEXT NOT NULL, department TEXT NOT NULL, title TEXT NOT NULL
    );`);
  await opsExecute(`
    CREATE TABLE employees_backup (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name TEXT NOT NULL,
      email TEXT NOT NULL, department TEXT NOT NULL, title TEXT NOT NULL
    );`);
  await opsExecute(`
    CREATE TABLE software_licenses (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, product TEXT NOT NULL,
      seats INTEGER NOT NULL, seats_used INTEGER NOT NULL,
      renewal_date TEXT NOT NULL, owner_email TEXT
    );`);
  await opsExecute(`
    CREATE TABLE campaign_tracking (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, campaign TEXT NOT NULL,
      channel TEXT NOT NULL, spend_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      leads INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );`);

  const devices = [
    ["LT-2043", "ThinkPad X1 Carbon G11", "laptop", "carla@acme.dev", "assigned", "Windows 11 Pro", "2023-04-12", "2026-04-12"],
    ["LT-2044", "MacBook Pro 14 M3", "laptop", "diego@acme.dev", "assigned", "macOS 15", "2024-01-20", "2027-01-20"],
    ["LT-2051", "Dell Latitude 7440", "laptop", "bruno@acme.dev", "assigned", "Windows 11 Pro", "2023-09-02", "2026-09-02"],
    ["LT-2052", "ThinkPad T14s G4", "laptop", null, "in stock", "Windows 11 Pro", "2024-03-15", "2027-03-15"],
    ["MN-0310", "Dell U2723QE 27\"", "monitor", "carla@acme.dev", "assigned", null, "2023-04-12", "2026-04-12"],
    ["MN-0311", "LG 32UN880", "monitor", "ana@acme.dev", "assigned", null, "2022-11-30", "2025-11-30"],
    ["DK-0107", "OptiPlex 7010 SFF", "desktop", null, "repair", "Windows 11 Pro", "2022-06-08", "2025-06-08"],
    ["PR-0021", "HP LaserJet Pro M404", "printer", null, "shared", null, "2021-02-17", "2024-02-17"],
    ["PH-0455", "iPhone 15", "phone", "ana@acme.dev", "assigned", "iOS 18", "2023-10-05", "2025-10-05"],
    ["PH-0456", "Pixel 8", "phone", "diego@acme.dev", "assigned", "Android 15", "2023-11-11", "2025-11-11"],
    ["SV-0009", "PowerEdge R760 (staging)", "server", null, "active", "Ubuntu 24.04 LTS", "2023-07-19", "2028-07-19"],
    ["SV-0010", "PowerEdge R760 (prod)", "server", null, "active", "Ubuntu 24.04 LTS", "2023-07-19", "2028-07-19"],
  ];
  for (const d of devices) {
    await opsExecute(
      `INSERT INTO devices (asset_tag, model, type, assigned_to, status, os, purchased_at, warranty_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      d,
    );
  }

  const employees = [
    [1, "Ana Rodríguez", "ana@acme.dev", "IT", "IT Director"],
    [2, "Bruno Chen", "bruno@acme.dev", "IT", "Support Engineer"],
    [3, "Carla Méndez", "carla@acme.dev", "Marketing", "Growth Manager"],
    [4, "Diego Fontaine", "diego@acme.dev", "Finance", "Financial Analyst"],
    [5, "Elena Vidal", "elena@acme.dev", "Marketing", "Content Lead"],
    [6, "Farid Osman", "farid@acme.dev", "Engineering", "Backend Engineer"],
    [7, "Grace Liu", "grace@acme.dev", "Engineering", "Frontend Engineer"],
    [8, "Hugo Prat", "hugo@acme.dev", "Sales", "Account Executive"],
    [9, "Inés Duarte", "ines@acme.dev", "HR", "People Ops"],
    [10, "Jonas Weber", "jonas@acme.dev", "Finance", "Controller"],
  ];
  for (const e of employees) {
    await opsExecute(
      `INSERT INTO employees (id, name, email, department, title) VALUES ($1, $2, $3, $4, $5)`,
      e,
    );
    await opsExecute(
      `INSERT INTO employees_backup (id, name, email, department, title) VALUES ($1, $2, $3, $4, $5)`,
      e,
    );
  }

  const licenses = [
    [1, "Figma Organization", 25, 23, "2026-11-01", "ana@acme.dev"],
    [2, "Slack Business+", 60, 57, "2027-01-15", "ana@acme.dev"],
    [3, "Adobe Creative Cloud", 10, 10, "2026-09-30", "elena@acme.dev"],
    [4, "GitHub Enterprise", 30, 22, "2027-03-01", "farid@acme.dev"],
    [5, "Notion Plus", 60, 41, "2026-12-12", "ines@acme.dev"],
    [6, "Zoom Workplace", 60, 35, "2026-10-20", "ana@acme.dev"],
    [7, "Datadog Pro", 15, 15, "2026-09-05", "farid@acme.dev"],
    [8, "1Password Business", 60, 58, "2027-02-28", "ana@acme.dev"],
  ];
  for (const l of licenses) {
    await opsExecute(
      `INSERT INTO software_licenses (id, product, seats, seats_used, renewal_date, owner_email)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      l,
    );
  }

  await opsExecute(`INSERT INTO campaign_tracking (campaign, channel, spend_usd, leads, created_at)
     VALUES ('Q3 Launch', 'linkedin', 4200, 137, '2026-07-18'), ('Q3 Launch', 'search', 2650, 96, '2026-07-18')`);

  // The identity columns above were fed explicit ids, which does not advance
  // their sequences — the same trap ticket_number_seq has. Without this the
  // next default-valued insert collides on the primary key.
  for (const table of ["employees", "employees_backup", "software_licenses"]) {
    await opsExecute(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${table}))`,
    );
  }

  // -- tickets ---------------------------------------------------------------
  let nextNumber = 1001;

  interface SimpleTicketSpec {
    title: string;
    description: string;
    status: string;
    priority: string;
    category: string;
    requesterId: string;
    assigneeId?: string | null;
    createdDaysAgo: number;
    firstResponseMin?: number; // minutes after createdAt
    resolvedAfterMin?: number; // minutes after createdAt
    resolvedByAi?: boolean;
    comments?: { authorId: string; body: string; afterMin: number; kind?: string }[];
  }

  async function createTicket(spec: SimpleTicketSpec) {
    const createdAt = daysAgo(spec.createdDaysAgo, 9 + (nextNumber % 7), (nextNumber * 13) % 60);
    const ticket = await db.ticket.create({
      data: {
        number: nextNumber++,
        title: spec.title,
        description: spec.description,
        status: spec.status,
        priority: spec.priority,
        category: spec.category,
        requesterId: spec.requesterId,
        assigneeId: spec.assigneeId ?? null,
        createdAt,
        updatedAt: createdAt,
        firstResponseAt:
          spec.firstResponseMin !== undefined
            ? minutesAfter(createdAt, spec.firstResponseMin)
            : null,
        resolvedAt:
          spec.resolvedAfterMin !== undefined
            ? minutesAfter(createdAt, spec.resolvedAfterMin)
            : null,
      },
    });
    for (const c of spec.comments ?? []) {
      await db.comment.create({
        data: {
          ticketId: ticket.id,
          authorId: c.authorId,
          body: c.body,
          kind: c.kind ?? "COMMENT",
          createdAt: minutesAfter(createdAt, c.afterMin),
        },
      });
    }
    return ticket;
  }

  // ---- AI-resolved showcase tickets (with full run traces) ----

  // 1) Password reset, resolved end-to-end by the AI resolver.
  const tPassword = await createTicket({
    title: "Locked out of my account after password expiry",
    description:
      "My Windows password expired while I was traveling and now I'm locked out of email and Slack. I need a reset as soon as possible — I have a client call at 15:00.",
    status: "RESOLVED",
    priority: "HIGH",
    category: "ACCESS",
    requesterId: carla.id,
    assigneeId: aiResolver.id,
    createdDaysAgo: 6,
    firstResponseMin: 2,
    resolvedAfterMin: 9,
    comments: [
      {
        authorId: aiResolver.id,
        afterMin: 8,
        body: "I've reset your password and sent a recovery link to your personal email on file. The link expires in 60 minutes. After signing in you'll be asked to set a new password — Slack and email will pick it up automatically.",
      },
      {
        authorId: carla.id,
        afterMin: 25,
        body: "Got it, I'm back in. Thanks for the quick turnaround!",
      },
    ],
  });
  {
    const run = await db.agentRun.create({
      data: {
        ticketId: tPassword.id,
        agentUserId: aiResolver.id,
        kind: "RESOLVE",
        status: "COMPLETED",
        summary:
          "Reset the requester's expired password via the identity provider and confirmed recovery flow on the ticket.",
        createdAt: minutesAfter(tPassword.createdAt, 2),
        completedAt: minutesAfter(tPassword.createdAt, 9),
        conversation: "[]",
      },
    });
    const steps = [
      { type: "TEXT", content: "The requester is locked out after password expiry. Safest path: trigger an identity-provider reset with a recovery link, then confirm on the ticket." },
      { type: "TOOL_CALL", toolName: "reset_password", riskLevel: "MEDIUM", content: JSON.stringify({ email: "carla@acme.dev" }) },
      { type: "TOOL_RESULT", toolName: "reset_password", content: "Password reset for carla@acme.dev. Recovery link sent (expires in 60 min)." },
      { type: "TOOL_CALL", toolName: "post_comment", riskLevel: "LOW", content: JSON.stringify({ body: "I've reset your password and sent a recovery link…" }) },
      { type: "TOOL_RESULT", toolName: "post_comment", content: "Comment posted." },
      { type: "TOOL_CALL", toolName: "resolve_ticket", riskLevel: "LOW", content: JSON.stringify({ resolution: "Password reset completed; recovery link delivered." }) },
      { type: "TOOL_RESULT", toolName: "resolve_ticket", content: "Ticket marked as resolved." },
    ];
    let i = 0;
    for (const s of steps) {
      await db.agentStep.create({
        data: {
          runId: run.id,
          index: i,
          type: s.type,
          toolName: s.toolName ?? null,
          riskLevel: s.riskLevel ?? null,
          content: s.content,
          createdAt: minutesAfter(tPassword.createdAt, 3 + i),
        },
      });
      i++;
    }
  }

  // 2) Device lookup resolved by AI.
  const tDevice = await createTicket({
    title: "Need warranty and specs for laptop LT-2043",
    description:
      "Procurement is asking whether asset LT-2043 is still under warranty and which model it is, to decide on a battery replacement vs. renewal.",
    status: "RESOLVED",
    priority: "LOW",
    category: "HARDWARE",
    requesterId: carla.id,
    assigneeId: aiResolver.id,
    createdDaysAgo: 12,
    firstResponseMin: 3,
    resolvedAfterMin: 7,
    comments: [
      {
        authorId: aiResolver.id,
        afterMin: 5,
        body: "Asset LT-2043 is a ThinkPad X1 Carbon G11 (Windows 11 Pro), assigned to carla@acme.dev, purchased 2023-04-12 and under warranty until 2026-04-12 — a battery replacement would still be covered.",
      },
    ],
  });
  {
    const run = await db.agentRun.create({
      data: {
        ticketId: tDevice.id,
        agentUserId: aiResolver.id,
        kind: "RESOLVE",
        status: "COMPLETED",
        summary: "Looked up LT-2043 in the asset inventory and posted model, assignment and warranty details.",
        createdAt: minutesAfter(tDevice.createdAt, 3),
        completedAt: minutesAfter(tDevice.createdAt, 7),
        conversation: "[]",
      },
    });
    const steps = [
      { type: "TOOL_CALL", toolName: "get_device_info", riskLevel: "LOW", content: JSON.stringify({ assetTag: "LT-2043" }) },
      { type: "TOOL_RESULT", toolName: "get_device_info", content: JSON.stringify({ asset_tag: "LT-2043", model: "ThinkPad X1 Carbon G11", type: "laptop", assigned_to: "carla@acme.dev", status: "assigned", os: "Windows 11 Pro", purchased_at: "2023-04-12", warranty_until: "2026-04-12" }) },
      { type: "TOOL_CALL", toolName: "post_comment", riskLevel: "LOW", content: JSON.stringify({ body: "Asset LT-2043 is a ThinkPad X1 Carbon G11…" }) },
      { type: "TOOL_RESULT", toolName: "post_comment", content: "Comment posted." },
      { type: "TOOL_CALL", toolName: "resolve_ticket", riskLevel: "LOW", content: JSON.stringify({ resolution: "Provided warranty and hardware details for LT-2043." }) },
      { type: "TOOL_RESULT", toolName: "resolve_ticket", content: "Ticket marked as resolved." },
    ];
    let i = 0;
    for (const s of steps) {
      await db.agentStep.create({
        data: {
          runId: run.id, index: i, type: s.type, toolName: s.toolName ?? null,
          riskLevel: s.riskLevel ?? null, content: s.content,
          createdAt: minutesAfter(tDevice.createdAt, 4 + i),
        },
      });
      i++;
    }
  }

  // 3) DB change resolved by AI after human approval, with QA review.
  const tCampaign = await createTicket({
    title: "Create a table to track Q3 campaign spend",
    description:
      "Marketing needs a campaign_tracking table in the analytics database with campaign, channel, spend and leads columns so we can start logging Q3 numbers this week.",
    status: "RESOLVED",
    priority: "MEDIUM",
    category: "DATABASE",
    requesterId: carla.id,
    assigneeId: aiResolver.id,
    createdDaysAgo: 17,
    firstResponseMin: 4,
    resolvedAfterMin: 260,
    comments: [
      {
        authorId: aiResolver.id,
        afterMin: 250,
        body: "Created campaign_tracking (campaign, channel, spend_usd, leads, created_at) in the analytics database and verified inserts work. You can start logging Q3 spend now.",
      },
    ],
  });
  {
    const run = await db.agentRun.create({
      data: {
        ticketId: tCampaign.id,
        agentUserId: aiResolver.id,
        kind: "RESOLVE",
        status: "COMPLETED",
        summary: "Designed and created the campaign_tracking table after admin approval; QA verified schema matches the request.",
        qaVerdict: "PASS",
        qaNotes:
          "Change matches the request: table name and columns align with the description, DDL is idempotent-safe, and no existing objects were modified. Approval was obtained before execution.",
        createdAt: minutesAfter(tCampaign.createdAt, 4),
        completedAt: minutesAfter(tCampaign.createdAt, 260),
        conversation: "[]",
      },
    });
    const ddl =
      "CREATE TABLE campaign_tracking (id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, campaign TEXT NOT NULL, channel TEXT NOT NULL, spend_usd DOUBLE PRECISION NOT NULL DEFAULT 0, leads INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);";
    const steps = [
      { type: "TEXT", content: "I'll inspect the existing schema first to avoid name collisions, then propose the DDL for approval since schema changes are high-risk." },
      { type: "TOOL_CALL", toolName: "query_ops_database", riskLevel: "LOW", content: JSON.stringify({ sql: SCHEMA_QUERY }) },
      { type: "TOOL_RESULT", toolName: "query_ops_database", content: JSON.stringify([{ table_name: "devices" }, { table_name: "employees" }, { table_name: "employees_backup" }, { table_name: "software_licenses" }]) },
      { type: "APPROVAL_REQUEST", toolName: "execute_ops_sql", riskLevel: "HIGH", content: JSON.stringify({ sql: ddl }) },
      { type: "TOOL_CALL", toolName: "execute_ops_sql", riskLevel: "HIGH", content: JSON.stringify({ sql: ddl }) },
      { type: "TOOL_RESULT", toolName: "execute_ops_sql", content: "Statement executed. 0 rows affected." },
      { type: "TOOL_CALL", toolName: "resolve_ticket", riskLevel: "LOW", content: JSON.stringify({ resolution: "campaign_tracking table created as requested." }) },
      { type: "TOOL_RESULT", toolName: "resolve_ticket", content: "Ticket marked as resolved." },
      { type: "QA_REVIEW", content: "PASS — Change matches the request; approval obtained before execution; no unrelated objects touched." },
    ];
    let i = 0;
    for (const s of steps) {
      await db.agentStep.create({
        data: {
          runId: run.id, index: i, type: s.type,
          toolName: (s as { toolName?: string }).toolName ?? null,
          riskLevel: (s as { riskLevel?: string }).riskLevel ?? null,
          content: s.content,
          createdAt: minutesAfter(tCampaign.createdAt, 5 + i * 2),
        },
      });
      i++;
    }
    await db.approval.create({
      data: {
        runId: run.id,
        ticketId: tCampaign.id,
        toolName: "execute_ops_sql",
        toolInput: JSON.stringify({ sql: ddl }),
        toolUseId: "toolu_seed_campaign",
        riskLevel: "HIGH",
        status: "APPROVED",
        reason: "Schema reviewed — matches marketing's request.",
        requestedAt: minutesAfter(tCampaign.createdAt, 11),
        decidedAt: minutesAfter(tCampaign.createdAt, 240),
        deciderId: ana.id,
      },
    });
  }

  // ---- pending approvals (demo the approvals inbox) ----

  // 4) Pending HIGH-risk SQL: drop obsolete table.
  const tDrop = await createTicket({
    title: "Drop the obsolete employees_backup table",
    description:
      "The employees_backup table in the analytics database was a one-off copy from the March migration. It's stale and confusing people in BI — please drop it.",
    status: "WAITING_APPROVAL",
    priority: "MEDIUM",
    category: "DATABASE",
    requesterId: diego.id,
    assigneeId: aiResolver.id,
    createdDaysAgo: 1,
    firstResponseMin: 5,
  });
  {
    const dropSql = "DROP TABLE employees_backup;";
    const conversation = JSON.stringify([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Ticket #${tDrop.number}: ${tDrop.title}\n\n${tDrop.description}`,
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "I verified employees_backup exists and mirrors employees (10 rows, identical schema, no recent writes). Dropping it is destructive, so this needs sign-off.",
          },
          {
            type: "tool_use",
            id: "toolu_seed_drop",
            name: "execute_ops_sql",
            input: { sql: dropSql },
          },
        ],
      },
    ]);
    const run = await db.agentRun.create({
      data: {
        ticketId: tDrop.id,
        agentUserId: aiResolver.id,
        kind: "RESOLVE",
        status: "WAITING_APPROVAL",
        conversation,
        createdAt: minutesAfter(tDrop.createdAt, 5),
      },
    });
    const steps = [
      { type: "TOOL_CALL", toolName: "query_ops_database", riskLevel: "LOW", content: JSON.stringify({ sql: "SELECT COUNT(*) AS rows FROM employees_backup;" }) },
      { type: "TOOL_RESULT", toolName: "query_ops_database", content: JSON.stringify([{ rows: 10 }]) },
      { type: "TEXT", content: "employees_backup mirrors employees and has had no writes since March. Dropping it is destructive, so I'm requesting approval before executing." },
      { type: "APPROVAL_REQUEST", toolName: "execute_ops_sql", riskLevel: "HIGH", content: JSON.stringify({ sql: dropSql }) },
    ];
    let i = 0;
    for (const s of steps) {
      await db.agentStep.create({
        data: {
          runId: run.id, index: i, type: s.type,
          toolName: (s as { toolName?: string }).toolName ?? null,
          riskLevel: (s as { riskLevel?: string }).riskLevel ?? null,
          content: s.content,
          createdAt: minutesAfter(tDrop.createdAt, 6 + i),
        },
      });
      i++;
    }
    await db.approval.create({
      data: {
        runId: run.id,
        ticketId: tDrop.id,
        toolName: "execute_ops_sql",
        toolInput: JSON.stringify({ sql: dropSql }),
        toolUseId: "toolu_seed_drop",
        riskLevel: "HIGH",
        status: "PENDING",
        requestedAt: minutesAfter(tDrop.createdAt, 10),
      },
    });
  }

  // 5) Pending HIGH-risk cloud deployment.
  const tDeploy = await createTicket({
    title: "Deploy the status-page hotfix to production",
    description:
      "The status-page service has a fix for the SSL renewal bug on the release branch. We need it deployed to the production environment (Azure, container apps) today.",
    status: "WAITING_APPROVAL",
    priority: "URGENT",
    category: "DEVOPS",
    requesterId: diego.id,
    assigneeId: aiResolver.id,
    createdDaysAgo: 0,
    firstResponseMin: 6,
  });
  {
    const plan =
      "Plan: statuspage-hotfix-20260803\n  provider: azure\n  service: container-apps/status-page\n  ~ update image: statuspage:1.14.2 -> statuspage:1.14.3\n  ~ roll 2 replicas, max_unavailable=1\n  no changes to secrets, networking or scaling rules";
    const conversation = JSON.stringify([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Ticket #${tDeploy.number}: ${tDeploy.title}\n\n${tDeploy.description}`,
          },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Plan generated and validated. Applying to production requires approval." },
          {
            type: "tool_use",
            id: "toolu_seed_deploy",
            name: "cloud_apply_deployment",
            input: { planId: "statuspage-hotfix-20260803", provider: "azure" },
          },
        ],
      },
    ]);
    const run = await db.agentRun.create({
      data: {
        ticketId: tDeploy.id,
        agentUserId: aiResolver.id,
        kind: "RESOLVE",
        status: "WAITING_APPROVAL",
        conversation,
        createdAt: minutesAfter(tDeploy.createdAt, 6),
      },
    });
    const steps = [
      { type: "TOOL_CALL", toolName: "cloud_plan_deployment", riskLevel: "LOW", content: JSON.stringify({ provider: "azure", service: "status-page", description: "Deploy statuspage:1.14.3 hotfix (SSL renewal bug)" }) },
      { type: "TOOL_RESULT", toolName: "cloud_plan_deployment", content: plan },
      { type: "TEXT", content: "The plan only bumps the container image and rolls replicas gradually. Applying to production is gated behind approval." },
      { type: "APPROVAL_REQUEST", toolName: "cloud_apply_deployment", riskLevel: "HIGH", content: JSON.stringify({ planId: "statuspage-hotfix-20260803", provider: "azure" }) },
    ];
    let i = 0;
    for (const s of steps) {
      await db.agentStep.create({
        data: {
          runId: run.id, index: i, type: s.type,
          toolName: (s as { toolName?: string }).toolName ?? null,
          riskLevel: (s as { riskLevel?: string }).riskLevel ?? null,
          content: s.content,
          createdAt: minutesAfter(tDeploy.createdAt, 7 + i),
        },
      });
      i++;
    }
    await db.approval.create({
      data: {
        runId: run.id,
        ticketId: tDeploy.id,
        toolName: "cloud_apply_deployment",
        toolInput: JSON.stringify({ planId: "statuspage-hotfix-20260803", provider: "azure" }),
        toolUseId: "toolu_seed_deploy",
        riskLevel: "HIGH",
        status: "PENDING",
        requestedAt: minutesAfter(tDeploy.createdAt, 12),
      },
    });
  }

  // ---- background tickets for realistic KPIs ----

  const background: SimpleTicketSpec[] = [
    { title: "VPN drops every ~20 minutes on hotel wifi", description: "Since Monday my VPN connection drops roughly every 20 minutes when I'm on hotel wifi. LAN at the office is fine.", status: "IN_PROGRESS", priority: "MEDIUM", category: "NETWORK", requesterId: diego.id, assigneeId: bruno.id, createdDaysAgo: 2, firstResponseMin: 45, comments: [{ authorId: bruno.id, afterMin: 45, body: "Looking into it — can you send me the client logs from Settings > Diagnostics?" }] },
    { title: "Figma seat for the new designer", description: "Marta joins the design team next Monday and needs a Figma seat in the org workspace.", status: "TRIAGED", priority: "MEDIUM", category: "ACCESS", requesterId: carla.id, createdDaysAgo: 1, firstResponseMin: 20 },
    { title: "Excel crashes when opening the forecast model", description: "The FY26 forecast workbook crashes Excel on open since the last Office update. Other files open fine.", status: "OPEN", priority: "HIGH", category: "SOFTWARE", requesterId: diego.id, createdDaysAgo: 0 },
    { title: "Second monitor flickers after dock firmware update", description: "After yesterday's dock firmware push my external monitor flickers every few seconds. Tried different cables already.", status: "OPEN", priority: "MEDIUM", category: "HARDWARE", requesterId: carla.id, createdDaysAgo: 0 },
    { title: "Access to the finance shared drive", description: "I need read access to the Finance/Closing folder for the month-end review.", status: "RESOLVED", priority: "MEDIUM", category: "ACCESS", requesterId: diego.id, assigneeId: bruno.id, createdDaysAgo: 4, firstResponseMin: 30, resolvedAfterMin: 95, comments: [{ authorId: bruno.id, afterMin: 90, body: "Granted read access to Finance/Closing. Let me know if you also need the archive folder." }] },
    { title: "Printer on floor 3 jams on duplex", description: "The HP on floor 3 jams every time you print double-sided. Simplex works.", status: "RESOLVED", priority: "LOW", category: "HARDWARE", requesterId: carla.id, assigneeId: bruno.id, createdDaysAgo: 9, firstResponseMin: 120, resolvedAfterMin: 480 },
    { title: "Can't join Zoom from the boardroom system", description: "The boardroom room system fails to join Zoom meetings with error 1132 since this morning.", status: "RESOLVED", priority: "URGENT", category: "SOFTWARE", requesterId: diego.id, assigneeId: bruno.id, createdDaysAgo: 8, firstResponseMin: 12, resolvedAfterMin: 60 },
    { title: "Slack notifications delayed on Android", description: "Slack pushes arrive 10-15 minutes late on my Pixel since the last app update.", status: "CLOSED", priority: "LOW", category: "SOFTWARE", requesterId: diego.id, assigneeId: bruno.id, createdDaysAgo: 21, firstResponseMin: 200, resolvedAfterMin: 2000 },
    { title: "Reset MFA after phone upgrade", description: "I switched phones over the weekend and lost my authenticator. Need MFA re-enrollment.", status: "RESOLVED", priority: "HIGH", category: "ACCESS", requesterId: carla.id, assigneeId: aiResolver.id, createdDaysAgo: 10, firstResponseMin: 4, resolvedAfterMin: 15, resolvedByAi: true },
    { title: "Wifi dead zone near the east meeting rooms", description: "No usable wifi signal near meeting rooms E1/E2. Multiple people affected.", status: "TRIAGED", priority: "MEDIUM", category: "NETWORK", requesterId: diego.id, assigneeId: bruno.id, createdDaysAgo: 3, firstResponseMin: 60 },
    { title: "License count for Adobe Creative Cloud", description: "How many Adobe CC seats do we have and how many are in use? Budgeting for two new hires.", status: "RESOLVED", priority: "LOW", category: "SOFTWARE", requesterId: carla.id, assigneeId: aiResolver.id, createdDaysAgo: 14, firstResponseMin: 3, resolvedAfterMin: 8, resolvedByAi: true, comments: [{ authorId: aiResolver.id, afterMin: 6, body: "Adobe Creative Cloud: 10 seats, 10 in use — fully allocated. Two new hires would require expanding the contract; renewal is 2026-09-30, owned by elena@acme.dev." }] },
    { title: "Laptop for the summer intern", description: "We need a loaner laptop prepared for the data intern starting on the 18th (standard dev image).", status: "IN_PROGRESS", priority: "MEDIUM", category: "HARDWARE", requesterId: carla.id, assigneeId: bruno.id, createdDaysAgo: 5, firstResponseMin: 90 },
    { title: "Deploy the docs site to staging", description: "Marketing wants the new docs site (docs-v2 branch) on staging for review before Friday.", status: "RESOLVED", priority: "MEDIUM", category: "DEVOPS", requesterId: carla.id, assigneeId: aiResolver.id, createdDaysAgo: 19, firstResponseMin: 5, resolvedAfterMin: 40, resolvedByAi: true },
    { title: "SSH access to the staging server", description: "I need SSH access to SV-0009 (staging) to debug the ETL job that fails at 02:00.", status: "RESOLVED", priority: "HIGH", category: "ACCESS", requesterId: diego.id, assigneeId: bruno.id, createdDaysAgo: 16, firstResponseMin: 25, resolvedAfterMin: 180 },
    { title: "Repository for the pricing experiments service", description: "Please create a new GitHub repo `pricing-experiments` with the standard Python template and CI enabled.", status: "RESOLVED", priority: "MEDIUM", category: "DEVOPS", requesterId: diego.id, assigneeId: aiResolver.id, createdDaysAgo: 23, firstResponseMin: 4, resolvedAfterMin: 22, resolvedByAi: true },
    { title: "Outlook rules disappeared after profile rebuild", description: "After IT rebuilt my Outlook profile my mail rules are gone. Can they be restored?", status: "RESOLVED", priority: "LOW", category: "SOFTWARE", requesterId: carla.id, assigneeId: bruno.id, createdDaysAgo: 26, firstResponseMin: 300, resolvedAfterMin: 1300 },
    { title: "Dashboard for weekly support KPIs", description: "Leadership wants a weekly email with ticket volume and resolution times. Can we automate it?", status: "OPEN", priority: "LOW", category: "OTHER", requesterId: diego.id, createdDaysAgo: 7 },
    { title: "Antivirus flags the payroll export tool", description: "Defender quarantines payroll_export.exe from the finance tools share. We need it whitelisted or replaced.", status: "TRIAGED", priority: "HIGH", category: "SOFTWARE", requesterId: diego.id, assigneeId: bruno.id, createdDaysAgo: 2, firstResponseMin: 35 },
    { title: "Guest wifi for the partner workshop", description: "We host 20 external guests next Thursday and need temporary guest wifi credentials.", status: "RESOLVED", priority: "MEDIUM", category: "NETWORK", requesterId: carla.id, assigneeId: bruno.id, createdDaysAgo: 13, firstResponseMin: 55, resolvedAfterMin: 240 },
    { title: "Phone screen cracked — PH-0456", description: "Dropped my work phone this morning; screen is cracked but functional. Repair or replace?", status: "OPEN", priority: "LOW", category: "HARDWARE", requesterId: diego.id, createdDaysAgo: 1 },
    { title: "Old employee data showing in BI dashboards", description: "The churn dashboard still shows employees who left in Q1. Probably reading from a stale table.", status: "OPEN", priority: "MEDIUM", category: "DATABASE", requesterId: carla.id, createdDaysAgo: 3 },
    { title: "Increase mailbox quota", description: "My mailbox is at 99% and bouncing external mail. Need a quota bump or archive policy.", status: "RESOLVED", priority: "HIGH", category: "SOFTWARE", requesterId: diego.id, assigneeId: bruno.id, createdDaysAgo: 28, firstResponseMin: 40, resolvedAfterMin: 130 },
    { title: "Access badge stopped working", description: "My badge doesn't open the garage entrance since yesterday; front door works.", status: "CLOSED", priority: "MEDIUM", category: "OTHER", requesterId: carla.id, assigneeId: bruno.id, createdDaysAgo: 24, firstResponseMin: 80, resolvedAfterMin: 300 },
  ];

  for (const spec of background) {
    const t = await createTicket(spec);
    // Give AI-resolved background tickets a lightweight completed run so the
    // dashboard's AI-vs-human split has data beyond the showcase tickets.
    if (spec.resolvedByAi) {
      await db.agentRun.create({
        data: {
          ticketId: t.id,
          agentUserId: aiResolver.id,
          kind: "RESOLVE",
          status: "COMPLETED",
          summary: "Resolved automatically by the AI resolver (seeded run).",
          createdAt: minutesAfter(t.createdAt, spec.firstResponseMin ?? 5),
          completedAt: t.resolvedAt ?? minutesAfter(t.createdAt, 30),
          conversation: "[]",
        },
      });
    }
  }

  // ---- group routing backfill (category → owning group; priority → tier) ----
  const groupByCategory: Record<string, string> = {
    SOFTWARE: devGroup.id,
    DEVOPS: devGroup.id,
    DATABASE: analyticsGroup.id,
    HARDWARE: engGroup.id,
    NETWORK: engGroup.id,
    ACCESS: engGroup.id,
  };
  const tierFor = (p: string) =>
    p === "URGENT" ? "SENIOR" : p === "HIGH" ? "MID" : "JUNIOR";
  const slaByPriority = new Map(DEFAULT_SLA_POLICIES.map((p) => [p.priority, p]));
  const allTickets = await db.ticket.findMany({
    select: { id: true, category: true, priority: true, createdAt: true },
  });
  for (const t of allTickets) {
    const groupId = groupByCategory[t.category];
    const sla = slaByPriority.get(t.priority as (typeof DEFAULT_SLA_POLICIES)[number]["priority"]);
    await db.ticket.update({
      where: { id: t.id },
      data: {
        ...(groupId ? { groupId } : {}),
        escalationLevel: tierFor(t.priority),
        ...(sla
          ? {
              responseDueAt: new Date(
                t.createdAt.getTime() + sla.responseMinutes * 60_000,
              ),
              resolutionDueAt: new Date(
                t.createdAt.getTime() + sla.resolutionMinutes * 60_000,
              ),
            }
          : {}),
      },
    });
  }

  const counts = {
    users: await db.user.count(),
    groups: await db.group.count(),
    agents: await db.agentProfile.count(),
    tickets: await db.ticket.count(),
    runs: await db.agentRun.count(),
    approvals: await db.approval.count(),
  };
  console.log("Seed complete:", counts);

  // db-03: the seed writes explicit ticket numbers (#1001..), so the
  // sequence must be pushed past them or the first real create collides.
  await db.$executeRawUnsafe(
    "SELECT setval('ticket_number_seq', (SELECT COALESCE(MAX(\"number\"), 1000) FROM \"Ticket\"))",
  );
  console.log("ticket_number_seq set past the seeded numbers");
}

main()
  .then(
    () => 0,
    (e) => {
      console.error(e);
      return 1;
    },
  )
  // Disconnect BEFORE exiting, not in a .finally() the process.exit() beat:
  // both pools are closed on the failure path as well as the success one.
  .then(async (code) => {
    await db.$disconnect();
    await opsDisconnect();
    if (code !== 0) process.exit(code);
  });
