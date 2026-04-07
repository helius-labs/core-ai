import type { Command } from "commander";

interface CommandInfo {
  name: string;
  subcommands: string[];
  options: string[];
}

/** Walk the Commander tree and collect command names, subcommands, and options. */
function collectCommands(program: Command): { topLevel: string[]; groups: CommandInfo[] } {
  const topLevel: string[] = [];
  const groups: CommandInfo[] = [];

  for (const cmd of program.commands) {
    const name = cmd.name();
    topLevel.push(name);

    const subs = cmd.commands.map((c: Command) => c.name());
    const opts = cmd.options.map((o: { long?: string; short?: string }) => o.long || o.short || "").filter(Boolean);

    if (subs.length > 0) {
      groups.push({ name, subcommands: subs, options: opts });
    }
  }

  return { topLevel, groups };
}

function generateBash(program: Command): string {
  const { topLevel, groups } = collectCommands(program);

  const cases = groups.map((g) =>
    `    ${g.name})\n      COMPREPLY=($(compgen -W "${g.subcommands.join(" ")}" -- "$cur"))\n      return\n      ;;`
  ).join("\n");

  return `# helius CLI bash completion
# Install: helius completions bash >> ~/.bashrc && source ~/.bashrc

_helius_completions() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  # Complete flags
  if [[ "$cur" == -* ]]; then
    COMPREPLY=($(compgen -W "--api-key --network --json --help --version" -- "$cur"))
    return
  fi

  # Complete subcommands for command groups
  case "$prev" in
${cases}
  esac

  # Complete top-level commands
  if [[ "\${COMP_CWORD}" -eq 1 ]]; then
    COMPREPLY=($(compgen -W "${topLevel.join(" ")}" -- "$cur"))
    return
  fi
}

complete -o default -F _helius_completions helius
`;
}

function generateZsh(program: Command): string {
  const { topLevel, groups } = collectCommands(program);

  const subcmdCases = groups.map((g) => {
    const items = g.subcommands.map((s) => `'${s}'`).join(" ");
    return `    ${g.name})\n      cmds=(${items})\n      ;;`;
  }).join("\n");

  return `#compdef helius
# helius CLI zsh completion
# Install: helius completions zsh >> ~/.zshrc && source ~/.zshrc

_helius() {
  local -a cmds
  local curcontext="\$curcontext" state

  _arguments -C \\
    '--api-key[Helius API key]:key:' \\
    '--network[Network: mainnet or devnet]:net:(mainnet devnet)' \\
    '--json[Output in JSON format]' \\
    '--help[Show help]' \\
    '--version[Show version]' \\
    '1:command:->cmd' \\
    '*:subcommand:->subcmd'

  case "\$state" in
    cmd)
      cmds=(${topLevel.map((c) => `'${c}'`).join(" ")})
      _describe 'command' cmds
      ;;
    subcmd)
      case "\${words[2]}" in
${subcmdCases}
        *)
          return
          ;;
      esac
      _describe 'subcommand' cmds
      ;;
  esac
}

_helius "\$@"
`;
}

function generateFish(program: Command): string {
  const { topLevel, groups } = collectCommands(program);

  const lines: string[] = [
    "# helius CLI fish completion",
    "# Install: helius completions fish > ~/.config/fish/completions/helius.fish",
    "",
    "# Disable file completions",
    "complete -c helius -f",
    "",
    "# Top-level commands",
  ];

  for (const cmd of topLevel) {
    lines.push(`complete -c helius -n '__fish_use_subcommand' -a '${cmd}'`);
  }

  lines.push("");

  for (const g of groups) {
    lines.push(`# ${g.name} subcommands`);
    for (const sub of g.subcommands) {
      lines.push(`complete -c helius -n '__fish_seen_subcommand_from ${g.name}' -a '${sub}'`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function completionsCommand(shell: string, program: Command): void {
  switch (shell) {
    case "bash":
      console.log(generateBash(program));
      break;
    case "zsh":
      console.log(generateZsh(program));
      break;
    case "fish":
      console.log(generateFish(program));
      break;
    default:
      console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish`);
      process.exit(1);
  }
}
