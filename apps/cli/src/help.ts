/**
 * The command catalog: one record per command, and every help surface renders
 * from it. `mend help` is the index, `mend help <command>` (or `<command>
 * --help`) is one page, `usage:` lines in errors quote the same synopsis, and
 * `man mend` / `mend man <command>` are the same pages as roff. Copy lives
 * here once, so a flag added to a command shows up everywhere or nowhere.
 */

export type Section = "start" | "sessions" | "services" | "project setup" | "this machine";

export const SECTIONS: ReadonlyArray<Section> = [
  "start",
  "sessions",
  "services",
  "project setup",
  "this machine",
];

export interface OptionDoc {
  readonly flag: string;
  readonly text: string;
}

export interface ExampleDoc {
  readonly command: string;
  readonly text: string;
}

export interface CommandDoc {
  /** The words after `mend`, e.g. "service run". */
  readonly name: string;
  /** Other first words that reach the same code, e.g. claude for codex. */
  readonly aliases?: ReadonlyArray<string>;
  readonly section: Section;
  /** One line for the index. Under 60 characters, lowercase, no period. */
  readonly summary: string;
  /** One or more usage shapes; each is printed after `mend <name> `. */
  readonly synopsis: ReadonlyArray<string>;
  /** Paragraphs. Plain sentences; the renderer wraps them. */
  readonly description: ReadonlyArray<string>;
  readonly options?: ReadonlyArray<OptionDoc>;
  readonly examples?: ReadonlyArray<ExampleDoc>;
  /** Other commands worth reading next, by name. */
  readonly see?: ReadonlyArray<string>;
  /** Kept out of the index and man index (the installer's renderer). */
  readonly hidden?: boolean;
}

const project = (what = "the project"): OptionDoc => ({
  flag: "--project <p>",
  text: `${what} by name, when the current directory is not inside it`,
});

const sessionArg =
  "With no id, the one live session is taken; with several, a picker opens. A prefix of the id is enough.";

export const COMMANDS: ReadonlyArray<CommandDoc> = [
  // ── start ──────────────────────────────────────────────────────────────
  {
    name: "login",
    section: "start",
    summary: "sign this terminal in through the browser",
    synopsis: ["[--url <server>]"],
    description: [
      "Opens <server>/authorize in your browser. You press Authorize there. The CLI saves a device token to ~/.config/mend/cli.json with mode 0600. No password is typed in the terminal, and the token can be revoked from the server at any time.",
    ],
    options: [
      {
        flag: "--url <server>",
        text: "the Mend server. Default: MEND_URL, then http://localhost:3105",
      },
    ],
    examples: [
      { command: "mend login --url http://10.0.0.216:3105", text: "sign in to a LAN server" },
    ],
    see: ["logout", "pair", "doctor"],
  },
  {
    name: "connect",
    section: "start",
    summary: "send this machine's provider credential to the platform",
    synopsis: ["<claude|codex|github> [--from-stdin] [--remove]"],
    description: [
      "Sessions run on the platform, so the platform needs your provider login. This reads the file the provider's own CLI wrote when you logged in (claude, codex) or asks gh for its token (github) and stores it under your own user. Nothing is shared with other users.",
    ],
    options: [
      { flag: "--from-stdin", text: "paste a credential instead of reading the provider's file" },
      { flag: "--remove", text: "disconnect the provider" },
    ],
    examples: [
      { command: "mend connect claude", text: "after `claude login` on this machine" },
      { command: "mend connect github --remove", text: "" },
    ],
    see: ["accounts"],
  },
  {
    name: "adopt",
    section: "start",
    summary: "adopt a repository into the store",
    synopsis: ["[source] [--name <name>] [--auth ambient|mend-key|bridge]"],
    description: [
      "Clones the repository into Mend's store. Every session then gets its own worktree of it. The default source is the current directory; any git URL works, GitHub, GitLab, self-hosted, ssh://, or a local path.",
      "--auth says how the store fetches from the remote. ambient uses the server's own credentials. mend-key uses this machine's deploy key (see mend keys). bridge relays this machine's ssh-agent while mend keys share runs, so hardware keys stay here.",
    ],
    options: [
      { flag: "--name <name>", text: "the project's name in Mend. Default: the repository's" },
      { flag: "--auth <mode>", text: "ambient, mend-key, or bridge. Default: ambient" },
    ],
    examples: [
      { command: "mend adopt", text: "the repository you are standing in" },
      { command: "mend adopt git@github.com:acme/api.git --auth mend-key", text: "" },
    ],
    see: ["keys init", "keys share", "refresh"],
  },
  {
    name: "codex",
    aliases: ["claude", "opencode"],
    section: "start",
    summary: "launch codex, claude, or opencode in a recorded worktree",
    synopsis: [
      '["prompt"] [--name <worktree>] [--worktree <existing>] [--model <id>] [--effort <level>] [--base <ref>] [--ask] [--fast] [--detach|-d] [--foreground] [--project <p>]',
    ],
    description: [
      "mend codex, mend claude, and mend opencode are the same command with a different harness. The session runs in a workspace on the platform, in its own git worktree, and everything it does is recorded. This terminal attaches to it.",
      "The worktree's name is asked first. --name skips the ask; an existing name joins that worktree as a new session. --worktree joins only and fails if the name is unknown. A quoted prompt becomes the first message.",
      "Detach with Ctrl+] and the session keeps running. Reattach from any terminal with mend attach, or from the phone.",
      "Ctrl+V with an image on this machine's clipboard sends the image to the session and pastes its path; codex and claude read it. Needs wl-paste on Wayland, xclip on X11, nothing extra on macOS.",
    ],
    options: [
      { flag: "--name <worktree>", text: "name the worktree; an existing name joins it" },
      { flag: "--worktree <existing>", text: "join an existing worktree only" },
      { flag: "--model <id>", text: "the harness's model id" },
      { flag: "--effort <level>", text: "low, medium, high, xhigh, or max" },
      { flag: "--base <ref>", text: "the branch or sha the worktree starts from" },
      { flag: "--ask", text: "keep the harness's permission prompts" },
      { flag: "--fast", text: "priority processing where the harness offers it (codex)" },
      { flag: "--detach, -d", text: "launch without attaching" },
      { flag: "--foreground", text: "stop the session when this CLI exits" },
      project(),
    ],
    examples: [
      {
        command: 'mend claude "add a health endpoint"',
        text: "asks for a worktree name, then runs",
      },
      { command: "mend codex --name auth-rework -d", text: "start in the background" },
      {
        command: "mend codex --worktree auth-rework",
        text: "a second session in the same worktree",
      },
    ],
    see: ["attach", "stop", "run", "sessions"],
  },
  {
    name: "pair",
    section: "start",
    summary: "pair a phone or a second machine",
    synopsis: ["[--url <base url>]"],
    description: [
      "Prints a QR code, the code itself, and the URL this server is reached at. The pairing is for one device, once, and expires after 10 minutes.",
    ],
    options: [
      { flag: "--url <base url>", text: "the address the other device should use for this server" },
    ],
    see: ["login"],
  },
  {
    name: "doctor",
    section: "start",
    summary: "check this machine's setup",
    synopsis: [],
    description: [
      "Read-only. One line per fact: the server, the sign-in, the platform connection, the provider accounts, the git key. Each unfinished line ends with the command that fixes it.",
    ],
    see: ["login", "connect", "keys init"],
  },

  // ── sessions ───────────────────────────────────────────────────────────
  {
    name: "ui",
    section: "sessions",
    summary: "the dashboard: every project and session, live",
    synopsis: [],
    description: [
      "A full-screen view of every project and session, updating live. Pick a session to attach, stop, or take over. Bare mend with no command opens the same thing.",
      "The dashboard needs Node 26 or newer for its terminal. Every other command works on Node 22.",
    ],
    see: ["sessions", "attach"],
  },
  {
    name: "attach",
    section: "sessions",
    summary: "reattach this terminal to a running session",
    synopsis: ["[session-id-prefix]"],
    description: [
      sessionArg,
      "A session that was picked up on the phone is taken back into this terminal: the phone's agent ends and the same conversation continues here.",
      "Ctrl+V with an image on this machine's clipboard sends the image to the session and pastes its path; codex and claude read it. Needs wl-paste on Wayland, xclip on X11, nothing extra on macOS.",
    ],
    see: ["stop", "rejoin", "shell"],
  },
  {
    name: "stop",
    section: "sessions",
    summary: "stop the agent; the record and the review remain",
    synopsis: ["[session-id-prefix]", "--all [--project <p>]"],
    description: [
      "Ends the agent process. The workspace harvests the harness state and closes. The worktree, the record, and the review stay, and mend resume brings the conversation back.",
      sessionArg,
    ],
    options: [{ flag: "--all", text: "every live session" }, project("limit --all to one project")],
    see: ["resume", "attach"],
  },
  {
    name: "shell",
    section: "sessions",
    summary: "open a shell in a live session's workspace",
    synopsis: ["[session-id-prefix]"],
    description: [
      "A second terminal into the same workspace the agent works in, beside it. Useful for running the tests yourself or looking at a file.",
      sessionArg,
    ],
    see: ["attach", "service run"],
  },
  {
    name: "run",
    section: "sessions",
    summary: "run any command as a session",
    synopsis: ["[--project <p>] -- <command...>"],
    description: [
      "The same worktree, record, and review as mend codex, with a command of your own in place of a harness. Everything after -- is the command.",
    ],
    options: [project()],
    examples: [{ command: "mend run -- aider --model gpt-5", text: "" }],
    see: ["codex"],
  },
  {
    name: "continue",
    section: "sessions",
    summary: "resume a session with its pending review follow-up",
    synopsis: ["[session-id]"],
    description: [
      "The review comments you sent to the session become its first message. With no id, the newest session with a pending follow-up is taken.",
    ],
    see: ["resume", "sessions"],
  },
  {
    name: "resume",
    section: "sessions",
    summary: "rejoin a settled session with its state restored",
    synopsis: ["[session-id] [--with <harness>]"],
    description: [
      "Starts a new agent process from the saved harness state, so the conversation continues where it stopped. --with switches the harness; the conversation carries over between claude and codex.",
    ],
    options: [
      { flag: "--with <harness>", text: "claude or codex; default: the one the session used" },
    ],
    see: ["stop", "rejoin"],
  },
  {
    name: "rejoin",
    section: "sessions",
    summary: "attach if live, otherwise resume",
    synopsis: ["[session-id] [--harness <h>]"],
    description: [
      "With no id, the newest live session wins; failing that, the newest settled one.",
    ],
    options: [{ flag: "--harness <h>", text: "the harness to resume with, when resuming" }],
    see: ["attach", "resume"],
  },
  {
    name: "sessions",
    aliases: ["status"],
    section: "sessions",
    summary: "sessions with their review facts",
    synopsis: ["[--all] [--project <p>] [--json | --json=v2]"],
    description: [
      "One line per session: harness, worktree, status, and what the review found. Live sessions by default.",
      "The JSON is stable for integrations. --json is the v1 flat list; --json=v2 groups sessions by worktree, the same shape mend worktrees prints.",
    ],
    options: [
      { flag: "--all", text: "settled sessions too" },
      project(),
      { flag: "--json", text: "the v1 flat list" },
      { flag: "--json=v2", text: "grouped by worktree" },
    ],
    see: ["worktrees", "projects"],
  },
  {
    name: "worktrees",
    section: "sessions",
    summary: "every worktree and the sessions inside it",
    synopsis: ["[--project <p>] [--json]"],
    description: ["A worktree can hold several sessions over time; this shows them together."],
    options: [project(), { flag: "--json", text: "the v2 grouped shape" }],
    see: ["sessions"],
  },
  {
    name: "projects",
    section: "sessions",
    summary: "adopted projects and their live sessions",
    synopsis: [],
    description: ["One line per project, with the sessions running in it."],
    see: ["adopt", "sessions"],
  },
  {
    name: "refresh",
    section: "sessions",
    summary: "fetch origin's branches into the store",
    synopsis: ["[project]"],
    description: [
      "New sessions base on the tips the store holds; this brings them up to date with origin. Default: the project the current directory belongs to.",
    ],
    see: ["adopt"],
  },

  // ── services ───────────────────────────────────────────────────────────
  {
    name: "service run",
    section: "services",
    summary: "start and supervise a server in the session's workspace",
    synopsis: [
      "[session] --port <port> [--name <n>] [--udp] [--http|--https] [--no-connect] -- <command...>",
      "[session] <name> [--no-connect]",
    ],
    description: [
      "With --, the command after it is started in the workspace and supervised: its output is recorded, and mend service restart re-runs it. Without --, the name is a Service declared in the worktree's mend.toml. mend service <name> is the shorthand for that.",
      "The port is tunnelled to this machine's loopback as soon as it listens, unless --no-connect.",
    ],
    options: [
      { flag: "--port <port>", text: "the port the command listens on inside the workspace" },
      { flag: "--name <n>", text: "the service's name. Default: the command" },
      { flag: "--udp", text: "a UDP port" },
      { flag: "--http, --https", text: "how a browser should open it" },
      { flag: "--no-connect", text: "do not tunnel the port to this machine" },
    ],
    examples: [
      { command: "mend service run --port 3000 -- pnpm dev", text: "" },
      { command: "mend service web", text: "the Service named web in mend.toml" },
    ],
    see: ["service init", "service connect", "service logs"],
  },
  {
    name: "service add",
    section: "services",
    summary: "adopt a port something in the workspace already listens on",
    synopsis: ["[session] <port> [--name <n>] [--udp] [--http|--https]"],
    description: [
      "For a server the agent started itself. The port becomes a Service, reachable on this machine like one mend service run started.",
    ],
    options: [
      { flag: "--name <n>", text: "the service's name. Default: the port" },
      { flag: "--udp", text: "a UDP port" },
      { flag: "--http, --https", text: "how a browser should open it" },
    ],
    see: ["service run", "service list"],
  },
  {
    name: "service connect",
    section: "services",
    summary: "bring live Services to this machine's loopback",
    synopsis: ["[name...] [--port <p>]"],
    description: [
      "Each connection tunnels through the server, authenticated as you. With no names, every live Service. Ctrl-C closes them.",
    ],
    options: [{ flag: "--port <p>", text: "the local port, when connecting one Service" }],
    see: ["service list"],
  },
  {
    name: "service list",
    section: "services",
    summary: "every live service and its observed state",
    synopsis: [],
    description: ["Name, session, port, whether it listens, and where it is reachable from here."],
    see: ["service run", "service connect"],
  },
  {
    name: "service logs",
    section: "services",
    summary: "follow a supervised service's output",
    synopsis: ["<name-or-id> [--from <sequence>]"],
    description: ["Replays the recorded output, then follows it live. Ctrl-C stops following."],
    options: [{ flag: "--from <sequence>", text: "start the replay at a record sequence" }],
    see: ["service run"],
  },
  {
    name: "service restart",
    section: "services",
    summary: "re-run a service's recorded command, same URL",
    synopsis: ["<name-or-id>"],
    description: ["The port and the local address stay the same, so open tabs keep working."],
    see: ["service stop"],
  },
  {
    name: "service stop",
    section: "services",
    summary: "stop a service and close its host port",
    synopsis: ["<name-or-id>"],
    description: ["Ends the process and the tunnel. The record of its output remains."],
    see: ["service restart"],
  },
  {
    name: "service init",
    section: "services",
    summary: "scaffold mend.toml from package.json and compose ports",
    synopsis: ["[--yes]"],
    description: [
      "Writes a mend.toml in the current repository with one Service per script and exposed port it can find. Edit it afterwards; sessions read it from their worktree.",
    ],
    options: [{ flag: "--yes", text: "write without asking" }],
    see: ["service run"],
  },

  // ── project setup ──────────────────────────────────────────────────────
  {
    name: "env show",
    section: "project setup",
    summary: "what the project store holds: names only, never values",
    synopsis: ["[--project <p>]"],
    description: ["Configuration names and secret names for the project. Values never print."],
    options: [project()],
    see: ["env load"],
  },
  {
    name: "env load",
    section: "project setup",
    summary: "load a .env into the project",
    synopsis: ["[file] [--project <p>] [--secret [A,B]]"],
    description: [
      "Ordinary names become configuration. Secret-shaped names (KEY, TOKEN, PASSWORD, and the like) become secrets, which Mend stores encrypted and never shows again. Sessions receive both at launch. Default file: .env in the current directory.",
    ],
    options: [
      project(),
      {
        flag: "--secret [A,B]",
        text: "send every name to secrets, or only the named ones, e.g. DATABASE_URL",
      },
    ],
    examples: [
      { command: "mend env load .env.production --secret DATABASE_URL,STRIPE_KEY", text: "" },
    ],
    see: ["env show", "env cluster"],
  },
  {
    name: "env cluster",
    section: "project setup",
    summary: "bind Kubernetes secrets and configmaps to the workspaces",
    synopsis: [
      "add secret|configmap <name>",
      "remove <kind>/<name>",
      "sa <name> | sa --clear",
      "[--project <p>]",
    ],
    description: [
      "For a Mend server running in Kubernetes. The platform mounts the named objects into the project's workspaces at launch; Mend never reads their contents. sa sets the service account the workspaces run as. Changes apply from the next launch; running workspaces keep what they started with.",
    ],
    options: [project()],
    examples: [
      { command: "mend env cluster add secret app-env", text: "" },
      { command: "mend env cluster remove secret/app-env", text: "" },
    ],
    see: ["env load"],
  },
  {
    name: "skills",
    section: "project setup",
    summary: "your skill library on the server, or a project's",
    synopsis: ["[list] [--project [p]]"],
    description: [
      "Skills are instruction bundles the harness loads at launch. Yours apply to every session; a project's apply to sessions in that project.",
    ],
    options: [{ flag: "--project [p]", text: "the project's library instead of yours" }],
    see: ["skills push"],
  },
  {
    name: "skills push",
    section: "project setup",
    summary: "upload ~/.agents/skills into the library",
    synopsis: ["[--project [p]] [--prune] [--dir <path>]"],
    description: [
      "Scans the directory codex and claude read skills from and uploads every bundle. Sessions receive the library at launch. Unchanged bundles are skipped.",
    ],
    options: [
      { flag: "--project [p]", text: "push into the project's library instead of yours" },
      { flag: "--prune", text: "remove server-side skills the directory no longer has" },
      { flag: "--dir <path>", text: "scan another directory. Default: ~/.agents/skills" },
    ],
    see: ["skills"],
  },
  {
    name: "dotfiles",
    section: "project setup",
    summary: "your dotfiles on the server: repo and synced files",
    synopsis: ["[show]"],
    description: [
      "Workspaces apply your dotfiles at launch, from a repository you point the server at or from files mend dotfiles sync captured. This shows what is set.",
    ],
    see: ["dotfiles sync"],
  },
  {
    name: "dotfiles sync",
    section: "project setup",
    summary: "capture config files from this machine into your store",
    synopsis: ["[--all | paths...]"],
    description: [
      "Copies the named files from your home directory into your store on the server. --all takes the known shell, git, and editor files. Setups that rely on ZDOTDIR do not transfer.",
    ],
    options: [{ flag: "--all", text: "every known config file" }],
    see: ["dotfiles"],
  },
  {
    name: "keys init",
    section: "project setup",
    summary: "generate this machine's Mend deploy key (ed25519)",
    synopsis: [],
    description: [
      "Creates a key under ~/.config/mend/keys for projects adopted with --auth mend-key. Add the public key on your git host as a deploy key.",
    ],
    see: ["keys show", "adopt"],
  },
  {
    name: "keys show",
    section: "project setup",
    summary: "print the public key",
    synopsis: [],
    description: ["The key to add as a deploy key on your git host."],
    see: ["keys init"],
  },
  {
    name: "keys share",
    section: "project setup",
    summary: "relay this machine's ssh-agent to the server",
    synopsis: [],
    description: [
      "Bridge mode for projects adopted with --auth bridge: the server's git operations sign with the keys in this machine's ssh-agent, so hardware keys never leave here. Runs until Ctrl-C.",
    ],
    see: ["adopt"],
  },

  // ── this machine ───────────────────────────────────────────────────────
  {
    name: "ssh",
    section: "this machine",
    summary: "workspace SSH status: gateway, registered keys, ssh config",
    synopsis: ["[status]"],
    description: ["Whether this machine can ssh into workspaces, and what is missing if not."],
    see: ["ssh setup"],
  },
  {
    name: "ssh setup",
    section: "this machine",
    summary: "make this machine ready to ssh into workspaces, once",
    synopsis: ["[--key <path>]"],
    description: [
      "Registers a public key with the gateway (a key already in your ssh-agent is preferred; nothing new is created unless there is none) and writes a Host mend-ws block to ~/.ssh/config.",
    ],
    options: [{ flag: "--key <path>", text: "the public key to register" }],
    see: ["ssh", "shell"],
  },
  {
    name: "accounts",
    section: "this machine",
    summary: "your connected accounts on the platform",
    synopsis: [],
    description: [
      "claude, codex, and github: connected, invalid, or archived, and when each was last used.",
    ],
    see: ["connect"],
  },
  {
    name: "logout",
    section: "this machine",
    summary: "revoke this terminal's device token and forget it",
    synopsis: [],
    description: ["Other terminals and devices keep their own tokens."],
    see: ["login"],
  },
  {
    name: "completions",
    section: "this machine",
    summary: "print the TAB-completion hook",
    synopsis: ["zsh|bash"],
    description: [
      "Commands complete, and live session ids complete under TAB by asking the server.",
    ],
    examples: [{ command: 'mend completions zsh > "$fpath[1]/_mend"', text: "" }],
  },
  {
    name: "version",
    section: "this machine",
    summary: "this CLI's version, and the server's when it answers",
    synopsis: [],
    description: [
      "Two lines: the version of this CLI, then the server's from its health route. A server that does not answer within two seconds prints as unreachable. --version and -v do the same.",
    ],
    see: ["doctor"],
  },
  {
    name: "help",
    section: "this machine",
    summary: "this index, or one command's page",
    synopsis: ["[command...]"],
    description: [
      "mend help alone lists every command by section. mend help <command> prints that command's page: usage, description, options, examples. mend <command> --help is the same page.",
    ],
    see: ["man"],
  },
  {
    name: "man",
    section: "this machine",
    summary: "one command's page, or the whole manual, in man",
    synopsis: ["[command...]"],
    description: [
      "Renders the same pages as roff and opens them in man. Without man on the PATH, the text page prints instead. The npm package also installs mend(1) and mend-<command>(1), so man mend works after a global install.",
    ],
    see: ["help"],
  },
  {
    name: "qr",
    section: "this machine",
    summary: "render a QR code for the installer",
    synopsis: ["<text>"],
    description: ["The installer renders its pairing QR through this."],
    hidden: true,
  },
];

// ── lookup ────────────────────────────────────────────────────────────────

const firstWord = (doc: CommandDoc) => doc.name.split(" ")[0] ?? doc.name;

/**
 * The longest catalog entry the leading words name. `help service run` finds
 * "service run"; `help service` finds the group (every "service …" page);
 * `help claude` finds the codex page through its alias.
 */
export const findCommand = (words: ReadonlyArray<string>): CommandDoc | null => {
  const [first, ...rest] = words;
  if (first === undefined) return null;
  const candidates = COMMANDS.filter(
    (doc) => firstWord(doc) === first || doc.aliases?.includes(first),
  );
  let best: CommandDoc | null = null;
  for (const doc of candidates) {
    const tail = doc.name.split(" ").slice(1);
    if (tail.every((word, index) => rest[index] === word)) {
      if (best === null || doc.name.length > best.name.length) best = doc;
    }
  }
  return best;
};

/** Every page whose name starts with the word: the "service …" family. */
export const commandGroup = (first: string): ReadonlyArray<CommandDoc> =>
  COMMANDS.filter((doc) => !doc.hidden && firstWord(doc) === first && doc.name.includes(" "));

/** `usage: mend <name> <synopsis>` for an error line; one line per shape. */
export const usageOf = (name: string): string => {
  const doc = findCommand(name.split(" "));
  if (doc === null) return `usage: mend ${name}`;
  const shapes = doc.synopsis.length === 0 ? [""] : doc.synopsis;
  return shapes
    .map(
      (shape, index) =>
        `${index === 0 ? "usage: " : "       "}mend ${doc.name}${shape === "" ? "" : ` ${shape}`}`,
    )
    .join("\n");
};

// ── text rendering ────────────────────────────────────────────────────────

/**
 * Wrap at `width`, keeping `indent` spaces on every line; `hang` adds that
 * many more on continuation lines, so a usage line reads as one shape.
 */
export const wrap = (text: string, width: number, indent = 0, hang = 0): ReadonlyArray<string> => {
  const lines: Array<string> = [];
  let line = "";
  const room = () => Math.max(16, width - indent - (lines.length === 0 ? 0 : hang));
  for (const word of text.split(/\s+/).filter((w) => w !== "")) {
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= room()) line += ` ${word}`;
    else {
      lines.push(" ".repeat(indent + (lines.length === 0 ? 0 : hang)) + line);
      line = word;
    }
  }
  if (line !== "") lines.push(" ".repeat(indent + (lines.length === 0 ? 0 : hang)) + line);
  return lines;
};

/** Two columns: a label, then text wrapped beside it (or under it when the label is long). */
const twoColumns = (
  rows: ReadonlyArray<readonly [string, string]>,
  width: number,
  indent = 2,
  gap = 2,
): ReadonlyArray<string> => {
  const longest = Math.max(0, ...rows.map(([label]) => label.length));
  const column = Math.min(longest, 28) + gap;
  const out: Array<string> = [];
  for (const [label, text] of rows) {
    const body = wrap(text, width, indent + column);
    if (label.length + gap > column || body.length === 0) {
      out.push(" ".repeat(indent) + label);
      out.push(...body);
      continue;
    }
    const [first, ...more] = body;
    out.push(" ".repeat(indent) + label.padEnd(column) + (first ?? "").trimStart());
    out.push(...more);
  }
  return out;
};

const ENVIRONMENT: ReadonlyArray<readonly [string, string]> = [
  ["MEND_URL", "the server. Default http://localhost:3105"],
  ["MEND_TOKEN", "a token in place of the saved login"],
  [
    "MEND_DETACH_KEY",
    "the detach chord; default Ctrl+]. none when an outer multiplexer owns detaching",
  ],
];

const FILES: ReadonlyArray<readonly [string, string]> = [
  ["~/.config/mend/cli.json", "url, token, and device id from mend login"],
  ["~/.config/mend/keys/", "the deploy key from mend keys init"],
];

export const terminalWidth = (): number => Math.min(process.stdout.columns ?? 80, 100);

/** `mend help`: every command by section, one line each. */
export const renderIndex = (width = terminalWidth()): string => {
  const out: Array<string> = ["mend · the agent workbench", ""];
  const visible = COMMANDS.filter((doc) => !doc.hidden);
  const longest = Math.max(...visible.map((doc) => doc.name.length));
  const column = longest + 2;
  for (const section of SECTIONS) {
    out.push(section);
    for (const doc of visible.filter((d) => d.section === section)) {
      const body = wrap(doc.summary, width, 2 + column);
      out.push(`  ${doc.name.padEnd(column)}${(body[0] ?? "").trimStart()}`);
      out.push(...body.slice(1));
    }
    out.push("");
  }
  out.push(
    ...wrap(
      "mend help <command> for usage, options, and examples; mend <command> --help is the same page. man mend after a global install, or mend man <command>.",
      width,
    ),
  );
  out.push("");
  out.push("environment");
  out.push(...twoColumns(ENVIRONMENT, width));
  out.push("");
  out.push("files");
  out.push(...twoColumns(FILES, width));
  return out.join("\n");
};

const invocations = (doc: CommandDoc): ReadonlyArray<string> => {
  const shapes = doc.synopsis.length === 0 ? [""] : doc.synopsis;
  return shapes.map((shape) => `mend ${doc.name}${shape === "" ? "" : ` ${shape}`}`);
};

/** "also mend claude, mend opencode" for a page that several first words reach. */
const aliasNote = (doc: CommandDoc): string | null =>
  doc.aliases === undefined || doc.aliases.length === 0
    ? null
    : `also ${doc.aliases.map((alias) => `mend ${alias}`).join(", ")}, with the same options`;

/** `mend help <command>`: one page. */
export const renderCommand = (doc: CommandDoc, width = terminalWidth()): string => {
  const out: Array<string> = [`mend ${doc.name} · ${doc.summary}`, "", "usage"];
  for (const line of invocations(doc)) out.push(...wrap(line, width, 2, 4));
  const alias = aliasNote(doc);
  if (alias !== null) out.push(`  ${alias}`);
  out.push("", "description");
  for (const paragraph of doc.description) {
    out.push(...wrap(paragraph, width, 2));
    out.push("");
  }
  if (doc.options !== undefined && doc.options.length > 0) {
    out.push("options");
    out.push(
      ...twoColumns(
        doc.options.map((o) => [o.flag, o.text] as const),
        width,
      ),
    );
    out.push("");
  }
  if (doc.examples !== undefined && doc.examples.length > 0) {
    out.push("examples");
    for (const example of doc.examples) {
      out.push(`  ${example.command}`);
      if (example.text !== "") out.push(...wrap(example.text, width, 6));
    }
    out.push("");
  }
  const group = commandGroup(firstWord(doc)).filter((other) => other !== doc);
  if (!doc.name.includes(" ") && group.length > 0) {
    out.push("subcommands");
    out.push(
      ...twoColumns(
        group.map((g) => [g.name, g.summary] as const),
        width,
      ),
    );
    out.push("");
  }
  if (doc.see !== undefined && doc.see.length > 0) {
    out.push("see also");
    out.push(...wrap(doc.see.map((name) => `mend ${name}`).join(" · "), width, 2));
    out.push("");
  }
  return out.join("\n").trimEnd();
};

/** `mend help service`: the family's pages in one. */
export const renderGroup = (first: string, width = terminalWidth()): string | null => {
  const group = commandGroup(first);
  if (group.length === 0) return null;
  const out: Array<string> = [`mend ${first} · ${group.length} commands`, ""];
  out.push(
    ...twoColumns(
      group.map((g) => [g.name, g.summary] as const),
      width,
    ),
  );
  out.push("", `mend help ${first} <subcommand> for one page`);
  return out.join("\n");
};

// ── roff rendering (man pages) ────────────────────────────────────────────

/** Escape for roff: backslashes, leading control characters, and dashes that must stay ASCII. */
export const roff = (text: string): string => {
  const escaped = text.replace(/\\/g, "\\e").replace(/-/g, "\\-");
  return /^[.']/.test(escaped) ? `\\&${escaped}` : escaped;
};

const manHeader = (title: string, version: string, summary: string): ReadonlyArray<string> => [
  `.TH ${title.toUpperCase()} 1 "" "mend ${roff(version)}" "mend manual"`,
  ".SH NAME",
  `${roff(title)} \\- ${roff(summary)}`,
];

/** mend-<command>(1). */
export const renderManPage = (doc: CommandDoc, version: string): string => {
  const title = `mend-${doc.name.replace(/ /g, "-")}`;
  const out: Array<string> = [...manHeader(title, version, doc.summary), ".SH SYNOPSIS"];
  for (const line of invocations(doc)) out.push(`.B ${roff(line)}`, ".br");
  const alias = aliasNote(doc);
  if (alias !== null) out.push(roff(alias));
  out.push(".SH DESCRIPTION");
  for (const paragraph of doc.description) out.push(".PP", roff(paragraph));
  if (doc.options !== undefined && doc.options.length > 0) {
    out.push(".SH OPTIONS");
    for (const option of doc.options) out.push(".TP", `.B ${roff(option.flag)}`, roff(option.text));
  }
  if (doc.examples !== undefined && doc.examples.length > 0) {
    out.push(".SH EXAMPLES");
    for (const example of doc.examples) {
      out.push(".PP", `.B ${roff(example.command)}`);
      if (example.text !== "") out.push(".br", roff(example.text));
    }
  }
  const see = ["mend(1)", ...(doc.see ?? []).map((name) => `mend-${name.replace(/ /g, "-")}(1)`)];
  out.push(".SH SEE ALSO", roff(see.join(", ")));
  return `${out.join("\n")}\n`;
};

/** mend(1): the index plus every page as a section. */
export const renderManIndex = (version: string): string => {
  const out: Array<string> = [
    ...manHeader("mend", version, "the agent workbench"),
    ".SH SYNOPSIS",
    ".B mend",
    "[\\fIcommand\\fR] [\\fIoptions\\fR]",
    ".SH DESCRIPTION",
    ".PP",
    roff(
      "Mend adopts a repository into a central store, runs your coding agent (codex, claude, opencode, or any command) in a recorded git worktree on the platform, and lets you attach, review, and steer from any terminal or device. Each command has its own page: mend-<command>(1).",
    ),
  ];
  for (const section of SECTIONS) {
    out.push(`.SH ${section.toUpperCase()}`);
    for (const doc of COMMANDS.filter((d) => !d.hidden && d.section === section)) {
      out.push(".TP", `.B mend ${roff(doc.name)}`, roff(doc.summary));
    }
  }
  out.push(".SH ENVIRONMENT");
  for (const [name, text] of ENVIRONMENT) out.push(".TP", `.B ${roff(name)}`, roff(text));
  out.push(".SH FILES");
  for (const [name, text] of FILES) out.push(".TP", `.B ${roff(name)}`, roff(text));
  out.push(".SH SEE ALSO");
  out.push(
    roff(
      COMMANDS.filter((d) => !d.hidden)
        .map((d) => `mend-${d.name.replace(/ /g, "-")}(1)`)
        .join(", "),
    ),
  );
  return `${out.join("\n")}\n`;
};

/** The file name each page installs as. */
export const manFileName = (doc: CommandDoc | null): string =>
  doc === null ? "mend.1" : `mend-${doc.name.replace(/ /g, "-")}.1`;
