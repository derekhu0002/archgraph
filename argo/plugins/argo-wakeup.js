// Argo wakeup gate plugin for opencode.
//
// Injects an unconditional "wakeup gate" as the FIRST system instruction of
// every session, so the agent identifies its Business Actor and restores its
// long-term memory before responding to anything (including greetings and
// casual questions). The rule also lives in argo/rules/archgraph.instructions.md,
// but that file is long and can be skimmed; this hook guarantees a short,
// high-salience gate sits at the top of the system prompt on session start.

const ACTOR_ELEMENT_TYPE = process.env.ARGO_ACTOR_ELEMENT_TYPE || 'Business Actor';

const WAKEUP_GATE = [
  "WAKEUP GATE (unconditional; applies to the very first message of every session, including greetings, casual chat, and questions; never skip or defer).",
  `1. Your very FIRST tool call must be an ARGO MCP query listing all Actor elements (getSystemArchitecture, purpose "audit", subject "${ACTOR_ELEMENT_TYPE}"). Resolve the workspace's own schema first: queryNeo4jGraph with {schema:true} reports actorElementType (a .argo/schema bundle may rename it; null means no Actor concept, then skip), bundleValidation, and the type enums.`,
  "2. Restore that Actor's long-term memory (the SUBVIEW hierarchy mounted under it) before responding.",
  "3. If the ARGO MCP is unavailable or errors, say so explicitly first. Only after this gate may you respond or act.",
].join("\n");

export default async function argoWakeupPlugin() {
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const system = Array.isArray(output.system) ? output.system : [];
      if (system.some((entry) => entry.includes("WAKEUP GATE"))) {
        return;
      }
      output.system = [WAKEUP_GATE, ...system];
    },
  };
}
