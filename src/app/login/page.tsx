import { redirect } from "next/navigation";
import { AlertTriangle, LogIn } from "lucide-react";
import { auth, getAuthConfig, needsSetup, signIn } from "@/lib/authjs";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "This account is not allowed on this Servo instance. Ask an administrator to add your email domain.",
  Configuration: "The identity provider rejected the request — check the SSO settings.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await needsSetup()) redirect("/setup");
  const config = await getAuthConfig();
  if (config.mode !== "oidc") redirect("/dashboard");
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  const { error } = await searchParams;
  const errorMessage = error
    ? (ERROR_MESSAGES[error] ?? "Sign-in failed — please try again.")
    : null;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-sidebar p-6">
      <div className="w-full max-w-sm text-center">
        <div className="font-heading text-[34px] font-black leading-none tracking-tight text-sidebar-foreground">
          Servo<span className="text-primary">.</span>
        </div>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/60">
          AI desk for the team
        </p>
        <Card className="mt-6">
          <CardContent className="flex flex-col gap-3 pt-2">
            <p className="font-sans text-sm text-muted-foreground">
              Sign in with your company account to continue.
            </p>
            {errorMessage && (
              <Alert variant="destructive" className="text-left">
                <AlertTriangle />
                <AlertTitle className="whitespace-normal leading-snug">
                  {errorMessage}
                </AlertTitle>
              </Alert>
            )}
            <form
              action={async () => {
                "use server";
                await signIn("oidc", { redirectTo: "/dashboard" });
              }}
            >
              <Button type="submit" className="w-full font-heading">
                <LogIn size={15} />
                Continue with {config.providerName}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
