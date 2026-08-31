import { PrismaClient } from "@prisma/client";
import { open, seal, isSensitiveSettingKey } from "@/lib/secret-store";

// Secrets are encrypted at the write boundary (Setting values for sensitive
// keys; AiCredential.apiKey, CustomTool.secret, Webhook.secret, and
// McpServer.secret always) and Setting reads are decrypted here because
// settings are read all over the codebase. The other four models are
// decrypted at their single use site (settingsForProfile, custom-tool
// execution, webhook signing, the MCP client's header fill) — a Prisma
// query extension never sees them arrive through nested `include` reads,
// so decrypting there would be unreliable.

type SettingRow = { key: string; value: string } | null;

function sealSetting<T extends { key?: string; value?: string }>(
  data: T | undefined,
  key?: string,
): void {
  if (!data || typeof data.value !== "string") return;
  const settingKey = data.key ?? key;
  if (settingKey && isSensitiveSettingKey(settingKey)) {
    data.value = seal(data.value);
  }
}

function openSetting<T extends SettingRow>(row: T): T {
  // BOTH fields are guarded, because either can be absent: a caller that projects
  // `select: { key: true }` has no `value` for open() to read, and one that
  // projects `select: { value: true }` has no `key` for the predicate. Either
  // way the old code read .startsWith of undefined and 500'd the request. A
  // projection is a perfectly ordinary thing for a caller to do —
  // src/app/api/kb/sources/route.ts does it to learn whether a credential
  // EXISTS without ever reading it — so this boundary has to be total.
  if (row && typeof row.key === "string" && typeof row.value === "string" && isSensitiveSettingKey(row.key)) {
    row.value = open(row.value);
  }
  return row;
}

function sealField<T extends Record<string, unknown> | undefined>(
  data: T,
  field: string,
): void {
  if (data && typeof data[field] === "string") {
    (data as Record<string, unknown>)[field] = seal(data[field] as string);
  }
}

function makeClient() {
  return new PrismaClient().$extends({
    query: {
      setting: {
        async create({ args, query }) {
          sealSetting(args.data);
          return query(args);
        },
        async update({ args, query }) {
          sealSetting(args.data as { value?: string }, args.where.key);
          return query(args);
        },
        async upsert({ args, query }) {
          sealSetting(args.create);
          sealSetting(args.update as { value?: string }, args.where.key);
          return query(args);
        },
        async createMany({ args, query }) {
          const rows = Array.isArray(args.data) ? args.data : [args.data];
          for (const row of rows) sealSetting(row);
          return query(args);
        },
        async findUnique({ args, query }) {
          return openSetting((await query(args)) as SettingRow);
        },
        async findUniqueOrThrow({ args, query }) {
          return openSetting((await query(args)) as SettingRow);
        },
        async findFirst({ args, query }) {
          return openSetting((await query(args)) as SettingRow);
        },
        async findMany({ args, query }) {
          const rows = (await query(args)) as { key: string; value: string }[];
          for (const row of rows) openSetting(row);
          return rows;
        },
      },
      aiCredential: {
        async create({ args, query }) {
          sealField(args.data, "apiKey");
          return query(args);
        },
        async update({ args, query }) {
          sealField(args.data as Record<string, unknown>, "apiKey");
          return query(args);
        },
        async upsert({ args, query }) {
          sealField(args.create, "apiKey");
          sealField(args.update as Record<string, unknown>, "apiKey");
          return query(args);
        },
      },
      customTool: {
        async create({ args, query }) {
          sealField(args.data, "secret");
          return query(args);
        },
        async update({ args, query }) {
          sealField(args.data as Record<string, unknown>, "secret");
          return query(args);
        },
        async upsert({ args, query }) {
          sealField(args.create, "secret");
          sealField(args.update as Record<string, unknown>, "secret");
          return query(args);
        },
      },
      webhook: {
        async create({ args, query }) {
          sealField(args.data, "secret");
          return query(args);
        },
        async update({ args, query }) {
          sealField(args.data as Record<string, unknown>, "secret");
          return query(args);
        },
      },
      mcpServer: {
        async create({ args, query }) {
          sealField(args.data, "secret");
          return query(args);
        },
        async update({ args, query }) {
          sealField(args.data as Record<string, unknown>, "secret");
          return query(args);
        },
        async upsert({ args, query }) {
          sealField(args.create, "secret");
          sealField(args.update as Record<string, unknown>, "secret");
          return query(args);
        },
      },
    },
  });
}

type ServoClient = ReturnType<typeof makeClient>;

const globalForPrisma = globalThis as unknown as { prisma?: ServoClient };

export const db = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
