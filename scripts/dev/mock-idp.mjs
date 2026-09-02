// Local OIDC identity provider for developing/testing Servo's SSO without a
// real tenant. Point Servo at it with:
//   OIDC_ISSUER=http://localhost:4747  OIDC_CLIENT_ID=servo-test
//   OIDC_CLIENT_SECRET=test-secret
// Every sign-in is auto-approved as the email given on the command line.
// Usage: node scripts/dev/mock-idp.mjs [email] [name]
import { OAuth2Server } from "oauth2-mock-server";

const email = process.argv[2] ?? "sso.user@acme.dev";
const name = process.argv[3] ?? "SSO User";

const server = new OAuth2Server();
await server.issuer.keys.generate("RS256");

server.service.on("beforeTokenSigning", (token) => {
  token.payload.email = email;
  token.payload.name = name;
});
server.service.on("beforeUserinfo", (userInfoResponse) => {
  userInfoResponse.body = { sub: `mock-${email}`, email, name };
});

await server.start(4747, "localhost");
console.log(`mock idp on http://localhost:4747 — signs everyone in as ${email}`);
