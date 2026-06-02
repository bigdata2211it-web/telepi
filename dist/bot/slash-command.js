import { readFileSync } from "node:fs";
import { parseFrontmatter, } from "@mariozechner/pi-coding-agent";
import { trimLine } from "./message-rendering.js";
export const TELEPI_BOT_COMMANDS = [
    { command: "start", description: "Welcome and session info" },
    { command: "help", description: "Show commands and usage tips" },
    { command: "commands", description: "Browse TelePi and Pi commands" },
    { command: "new", description: "Start a new session" },
    { command: "retry", description: "Retry the last prompt in this chat/topic" },
    { command: "handback", description: "Hand session back to Pi CLI" },
    { command: "abort", description: "Cancel current operation" },
    { command: "session", description: "Current session details" },
    { command: "sessions", description: "List and switch sessions (or /sessions <path|id>)" },
    { command: "context", description: "Show context usage and session stats" },
    { command: "model", description: "Switch AI model" },
    { command: "mirror", description: "Create a mirror bot instance" },
    { command: "tree", description: "View and navigate the session tree" },
    { command: "branch", description: "Navigate to a tree entry (/branch <id>)" },
    { command: "label", description: "Label an entry (/label [name] or /label <id> <name>)" },
];
export const TELEPI_LOCAL_COMMAND_NAMES = new Set([
    ...TELEPI_BOT_COMMANDS.map((command) => command.command),
    "switch",
]);
export function normalizeSlashCommand(text, botUsername) {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) {
        return undefined;
    }
    const spaceIndex = trimmed.indexOf(" ");
    const rawCommand = (spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)).slice(1);
    const args = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim();
    const atIndex = rawCommand.indexOf("@");
    const rawName = atIndex === -1 ? rawCommand : rawCommand.slice(0, atIndex);
    const addressedBot = atIndex === -1 ? undefined : rawCommand.slice(atIndex + 1);
    if (!rawName) {
        return undefined;
    }
    if (addressedBot && botUsername && addressedBot.toLowerCase() !== botUsername.toLowerCase()) {
        return undefined;
    }
    return {
        name: rawName,
        text: args ? `/${rawName} ${args}` : `/${rawName}`,
    };
}
function normalizeArgumentHint(argumentHint) {
    if (typeof argumentHint !== "string") {
        return undefined;
    }
    const trimmed = argumentHint.trim();
    return trimmed ? trimmed : undefined;
}
function readPromptArgumentHint(sourcePath) {
    try {
        const { frontmatter } = parseFrontmatter(readFileSync(sourcePath, "utf8"));
        return normalizeArgumentHint(frontmatter["argument-hint"]);
    }
    catch {
        return undefined;
    }
}
function createSlashCommandArgumentHintResolver() {
    const hintBySourcePath = new Map();
    return (command) => {
        const commandWithMetadata = command;
        const directHint = normalizeArgumentHint(commandWithMetadata.argumentHint);
        if (directHint) {
            return directHint;
        }
        if (command.source !== "prompt") {
            return undefined;
        }
        const sourcePath = typeof command.sourceInfo?.path === "string" ? command.sourceInfo.path.trim() : "";
        if (!sourcePath) {
            return undefined;
        }
        if (hintBySourcePath.has(sourcePath)) {
            return hintBySourcePath.get(sourcePath);
        }
        const argumentHint = readPromptArgumentHint(sourcePath);
        hintBySourcePath.set(sourcePath, argumentHint);
        return argumentHint;
    };
}
function getPiSlashCommandDisplayText(command, getSlashCommandArgumentHint) {
    const argumentHint = getSlashCommandArgumentHint(command);
    return argumentHint ? `/${command.name} ${argumentHint}` : `/${command.name}`;
}
function getPiSlashCommandLabel(command, getSlashCommandArgumentHint) {
    const displayText = getPiSlashCommandDisplayText(command, getSlashCommandArgumentHint);
    switch (command.source) {
        case "prompt":
            return `📝 ${displayText}`;
        case "skill":
            return `🧰 ${displayText}`;
        case "extension":
            return `🧩 ${displayText}`;
        default:
            return `⚡ ${displayText}`;
    }
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function normalizeTelepiNativeCommandMenuEntry(entry) {
    if (!entry || typeof entry !== "object") {
        return undefined;
    }
    const candidate = entry;
    if (!isNonEmptyString(candidate.id) || !isNonEmptyString(candidate.label) || !isNonEmptyString(candidate.commandText)) {
        return undefined;
    }
    return {
        id: candidate.id.trim(),
        label: candidate.label.trim(),
        commandText: candidate.commandText.trim(),
    };
}
function getTelepiNativeCommandMenuEntries(command) {
    const bareIntegration = command.integrations?.telepi?.bare;
    if (!bareIntegration || bareIntegration.kind !== "native-menu" || !Array.isArray(bareIntegration.entries)) {
        return undefined;
    }
    const entries = bareIntegration.entries
        .map((entry) => normalizeTelepiNativeCommandMenuEntry(entry))
        .filter((entry) => entry !== undefined);
    return entries.length === bareIntegration.entries.length && entries.length > 0 ? entries : undefined;
}
function getOnlyMatchingCommand(slashCommands, predicate) {
    const matches = slashCommands.filter(predicate);
    return matches.length === 1 ? matches[0] : undefined;
}
export function getTelepiNativeCommandMenu(command, slashCommands) {
    if (command.text !== `/${command.name}`) {
        return undefined;
    }
    const matchingCommand = getOnlyMatchingCommand(slashCommands, (slashCommand) => slashCommand.name === command.name);
    if (!matchingCommand) {
        return undefined;
    }
    const entries = getTelepiNativeCommandMenuEntries(matchingCommand);
    if (!entries) {
        return undefined;
    }
    return {
        name: matchingCommand.name,
        bareCommandText: `/${matchingCommand.name}`,
        title: `/${matchingCommand.name}`,
        entries,
    };
}
export function rewriteSlashCommandForTelegram(command, _slashCommands) {
    return command.text;
}
export function getCommandPickerFilterName(filter) {
    switch (filter) {
        case "telepi":
            return "TelePi";
        case "pi":
            return "Pi";
        case "all":
        default:
            return "All";
    }
}
export function getCommandPickerCounts(entries) {
    return {
        all: entries.length,
        telepi: entries.filter((entry) => entry.kind === "telepi").length,
        pi: entries.filter((entry) => entry.kind === "pi").length,
    };
}
export function filterCommandPickerEntries(entries, filter) {
    if (filter === "all") {
        return entries;
    }
    return entries.filter((entry) => entry.kind === filter);
}
export function buildCommandPickerEntries(slashCommands) {
    const getSlashCommandArgumentHint = createSlashCommandArgumentHintResolver();
    const telepiEntries = TELEPI_BOT_COMMANDS
        .filter((command) => command.command !== "commands")
        .map((command, index) => ({
        id: index,
        kind: "telepi",
        command: command.command,
        description: command.description,
        label: `📱 /${command.command}`,
        commandText: `/${command.command}`,
    }));
    const piEntries = slashCommands.map((command, index) => ({
        id: telepiEntries.length + index,
        kind: "pi",
        name: command.name,
        description: command.description ?? command.source,
        label: getPiSlashCommandLabel(command, getSlashCommandArgumentHint),
        commandText: `/${command.name}`,
        source: command.source,
    }));
    return [...telepiEntries, ...piEntries];
}
function isTelegramNativeCommandName(name) {
    return /^[a-z0-9_]{1,32}$/.test(name);
}
export function buildChatScopedCommands(slashCommands) {
    const commands = TELEPI_BOT_COMMANDS.map((command) => ({
        command: command.command,
        description: command.description,
    }));
    const seen = new Set(TELEPI_LOCAL_COMMAND_NAMES);
    for (const slashCommand of slashCommands) {
        const name = slashCommand.name.replace(/^\/+/, "").trim().toLowerCase();
        if (!isTelegramNativeCommandName(name) || seen.has(name)) {
            continue;
        }
        seen.add(name);
        commands.push({
            command: name,
            description: trimLine(`Pi: ${slashCommand.description ?? slashCommand.source}`, 256),
        });
    }
    if (commands.length > 100) {
        console.warn(`Telegram supports at most 100 commands per scope; truncating ${commands.length} commands to 100.`);
    }
    return commands.slice(0, 100);
}
export function buildChatScopedCommandSignature(commands) {
    return JSON.stringify(commands);
}
