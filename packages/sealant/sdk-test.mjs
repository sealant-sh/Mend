import { Sealant } from "@sealant/sdk";
const sealant = new Sealant({ baseUrl: "http://localhost:4000" });
process.env.SEALANT_OWNER_USER_ID = "nqUCnAln2wJ6p8uAn9crwu93twTQ4SnY";
try {
  const ws = await sealant.workspaces.get("839d01fb-cd77-4466-af70-fae8324a38c0");
  console.log("workspace:", ws.id, ws.status);
  const pty = await ws.sessions.open(["sh", "-c", "echo supervised-hello && pwd && ls | head -3"]);
  console.log("session:", pty.id, "run:", pty.runId);
  let out = "";
  for await (const chunk of pty.output({ from: 0n })) {
    out += Buffer.from(chunk.data).toString();
    if (out.length > 400) break;
  }
  console.log("--- output ---");
  console.log(out.slice(0, 400));
  const status = await pty.status();
  console.log(
    "status:",
    JSON.stringify(status, (k, v) => (typeof v === "bigint" ? String(v) : v)),
  );
} catch (error) {
  console.log("ERR:", error.message);
}
await sealant.close();
