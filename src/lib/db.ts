import { PrismaClient } from "@prisma/client";
import { open, seal, SENSITIVE_SETTING_KEYS } from "@/lib/secret-store";

// Secrets are encrypted at the write boundary (Setting values for sensitive
// keys; AiCredential.apiKey, CustomTool.secret, Webhook.secret always) and
// Setting reads are decrypted here because settings are read all over the
// codebase. The other three models are decrypted at their single use site
// (settingsForProfile, custom-tool execution, webhook signing) — a Prisma
// query extension never sees them arrive through nested `include` reads,
// so decrypting there would be unreliable.

type SettingRow = { key: string; value: string } | null;

function sealSetting<T extends { key?: string; value?: string }>(
  data: T | undefined,
  key?: string,
): void {
  if (!data || typeof data.value !== "string") return;
  const settingKey = data.key ?? key;
  if (settingKey && SENSITIVE_SETTING_KEYS.has(settingKey)) {
    data.value = seal(data.value);
  }
}

function openSetting<T extends SettingRow>(row: T): T {
  if (row && SENSITIVE_SETTING_KEYS.has(row.key)) row.value = open(row.value);
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
      // External MCP servers (cnp-02): same shape as CustomTool.secret — the
      // bearer token is sealed here and opened only inside src/lib/mcp-client.ts
      // at header-substitution time, never on a nested read.
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
    },
  });
}

type ServoClient = ReturnType<typeof makeClient>;

const globalForPrisma = globalThis as unknown as { prisma?: ServoClient };

export const db = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
