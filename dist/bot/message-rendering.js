import { toFriendlyError } from "../errors.js";
import { escapeHTML, formatTelegramHTML } from "../format.js";
export const TELEGRAM_MESSAGE_LIMIT = 4000;
export const TOOL_OUTPUT_PREVIEW_LIMIT = 500;
const STREAMING_PREVIEW_LIMIT = 3800;
const FORMATTED_CHUNK_TARGET = 3000;
export function renderHelpPlain(info) {
    return [
        "TelePi commands:",
        "/start — welcome message and session info",
        "/help — show this help",
        "/commands — browse TelePi and Pi commands",
        "/new — start a new session",
        "/retry — resend the last prompt in this chat/topic",
        "/handback — hand the current session back to Pi CLI",
        "/abort — cancel the current Pi operation",
        "/session — show current session details",
        "/sessions — list and switch saved sessions",
        "/sessions <path|id> — switch directly to a session file or session ID",
        "/context — show context usage and session stats",
        "/model — switch AI model",
        "/tree — view the session tree",
        "/branch <id> — navigate to a tree entry",
        "/label [args] — add, clear, or list labels",
        "",
        "Notes:",
        "- Each Telegram chat/topic has its own Pi session and retry history.",
        "- Voice messages are transcribed and then sent as prompts.",
        "",
        renderSessionInfoPlain(info),
    ].join("\n");
}
export function renderHelpHTML(info) {
    return [
        "<b>TelePi commands</b>",
        "<code>/start</code> — welcome message and session info",
        "<code>/help</code> — show this help",
        "<code>/commands</code> — browse TelePi and Pi commands",
        "<code>/new</code> — start a new session",
        "<code>/retry</code> — resend the last prompt in this chat/topic",
        "<code>/handback</code> — hand the current session back to Pi CLI",
        "<code>/abort</code> — cancel the current Pi operation",
        "<code>/session</code> — show current session details",
        "<code>/sessions</code> — list and switch saved sessions",
        "<code>/sessions &lt;path|id&gt;</code> — switch directly to a session file or session ID",
        "<code>/context</code> — show context usage and session stats",
        "<code>/model</code> — switch AI model",
        "<code>/tree</code> — view the session tree",
        "<code>/branch &lt;id&gt;</code> — navigate to a tree entry",
        "<code>/label [args]</code> — add, clear, or list labels",
        "",
        "<b>Notes</b>",
        "- Each Telegram chat/topic has its own Pi session and retry history.",
        "- Voice messages are transcribed and then sent as prompts.",
        "",
        renderSessionInfoHTML(info),
    ].join("\n");
}
export function renderSessionInfoPlain(info) {
    const diagnostics = renderSessionDiagnosticsPlain(info.diagnostics);
    return [
        `Session ID: ${info.sessionId}`,
        `Session file: ${info.sessionFile ?? "(in-memory)"}`,
        `Workspace: ${info.workspace}`,
        info.sessionName ? `Session name: ${info.sessionName}` : undefined,
        info.model ? `Model: ${info.model}` : undefined,
        info.modelFallbackMessage ? `Model note: ${info.modelFallbackMessage}` : undefined,
        diagnostics ? "" : undefined,
        diagnostics,
    ]
        .filter((line) => line !== undefined)
        .join("\n");
}
export function renderSessionInfoHTML(info) {
    const diagnostics = renderSessionDiagnosticsHTML(info.diagnostics);
    return [
        `<b>Session ID:</b> <code>${escapeHTML(info.sessionId)}</code>`,
        `<b>Session file:</b> <code>${escapeHTML(info.sessionFile ?? "(in-memory)")}</code>`,
        `<b>Workspace:</b> <code>${escapeHTML(info.workspace)}</code>`,
        info.sessionName ? `<b>Session name:</b> <code>${escapeHTML(info.sessionName)}</code>` : undefined,
        info.model ? `<b>Model:</b> <code>${escapeHTML(info.model)}</code>` : undefined,
        info.modelFallbackMessage
            ? `<b>Model note:</b> ${escapeHTML(info.modelFallbackMessage)}`
            : undefined,
        diagnostics ? "" : undefined,
        diagnostics,
    ]
        .filter((line) => line !== undefined)
        .join("\n");
}
function renderSessionDiagnosticsPlain(diagnostics) {
    return renderSessionDiagnostics(diagnostics, {
        errorLabel: "Errors:",
        warningLabel: "Warnings:",
        infoLabel: "Notes:",
        renderItem: (message) => `- ${message}`,
    });
}
function renderSessionDiagnosticsHTML(diagnostics) {
    return renderSessionDiagnostics(diagnostics, {
        errorLabel: "<b>Errors:</b>",
        warningLabel: "<b>Warnings:</b>",
        infoLabel: "<b>Notes:</b>",
        renderItem: (message) => `• ${escapeHTML(message)}`,
    });
}
function renderSessionDiagnostics(diagnostics, options) {
    if (!diagnostics || diagnostics.length === 0) {
        return undefined;
    }
    const groups = [
        { type: "error", label: options.errorLabel },
        { type: "warning", label: options.warningLabel },
        { type: "info", label: options.infoLabel },
    ];
    const lines = [];
    for (const group of groups) {
        const matching = diagnostics.filter((diagnostic) => diagnostic.type === group.type);
        if (matching.length === 0) {
            continue;
        }
        if (lines.length > 0) {
            lines.push("");
        }
        lines.push(group.label);
        lines.push(...matching.map((diagnostic) => options.renderItem(diagnostic.message)));
    }
    return lines.join("\n");
}
function formatNumber(n) {
    return n.toLocaleString("en-US");
}
export function renderContextUsagePlain(usage) {
    const tokenLine = usage.tokens !== null
        ? `Tokens in context: ${formatNumber(usage.tokens)}`
        : "Tokens in context: unknown (not yet estimated)";
    const windowLine = `Context window: ${formatNumber(usage.contextWindow)}`;
    const percentLine = usage.percent !== null
        ? `Usage: ${usage.percent.toFixed(2)}%`
        : "Usage: unknown";
    return [tokenLine, windowLine, percentLine].join("\n");
}
export function renderContextUsageHTML(usage) {
    const tokenLine = usage.tokens !== null
        ? `<b>Tokens in context:</b> <code>${formatNumber(usage.tokens)}</code>`
        : `<b>Tokens in context:</b> <i>unknown (not yet estimated)</i>`;
    const windowLine = `<b>Context window:</b> <code>${formatNumber(usage.contextWindow)}</code>`;
    const percentLine = usage.percent !== null
        ? `<b>Usage:</b> <code>${usage.percent.toFixed(2)}%</code>`
        : `<b>Usage:</b> <i>unknown</i>`;
    return [tokenLine, windowLine, percentLine].join("\n");
}
export function renderSessionStatsPlain(stats) {
    return [
        `Messages: ${stats.userMessages} user, ${stats.assistantMessages} assistant (${stats.totalMessages} total)`,
        `Tool calls: ${stats.toolCalls}`,
        `Tokens: ${formatNumber(stats.tokens.input)} input, ${formatNumber(stats.tokens.output)} output (${formatNumber(stats.tokens.total)} total)`,
        stats.tokens.cacheRead > 0 || stats.tokens.cacheWrite > 0
            ? `Cache: ${formatNumber(stats.tokens.cacheRead)} read, ${formatNumber(stats.tokens.cacheWrite)} write`
            : undefined,
        stats.cost > 0 ? `Estimated cost: $${stats.cost.toFixed(4)}` : undefined,
    ].filter((line) => line !== undefined).join("\n");
}
export function renderSessionStatsHTML(stats) {
    const cacheLine = stats.tokens.cacheRead > 0 || stats.tokens.cacheWrite > 0
        ? `<b>Cache:</b> <code>${formatNumber(stats.tokens.cacheRead)}</code> read, <code>${formatNumber(stats.tokens.cacheWrite)}</code> write`
        : undefined;
    const costLine = stats.cost > 0
        ? `<b>Estimated cost:</b> <code>$${stats.cost.toFixed(4)}</code>`
        : undefined;
    return [
        `<b>Messages:</b> <code>${stats.userMessages}</code> user, <code>${stats.assistantMessages}</code> assistant (<code>${stats.totalMessages}</code> total)`,
        `<b>Tool calls:</b> <code>${stats.toolCalls}</code>`,
        `<b>Tokens:</b> <code>${formatNumber(stats.tokens.input)}</code> input, <code>${formatNumber(stats.tokens.output)}</code> output (<code>${formatNumber(stats.tokens.total)}</code> total)`,
        cacheLine,
        costLine,
    ].filter((line) => line !== undefined).join("\n");
}
export function renderVoiceSupportPlain(backends, warning) {
    const status = backends.length === 0
        ? "Voice transcription: unavailable (install parakeet-coreml + ffmpeg, or on Intel Macs install sherpa-onnx-node + SHERPA_ONNX_MODEL_DIR, or set OPENAI_API_KEY)."
        : `Voice transcription: ${backends.join(", ")}.`;
    return warning ? `${status}\nWarning: ${warning}` : status;
}
export function renderVoiceSupportHTML(backends, warning) {
    const status = backends.length === 0
        ? "<i>Voice transcription unavailable.</i> Install <code>parakeet-coreml</code>, or on Intel Macs install <code>sherpa-onnx-node</code> with <code>SHERPA_ONNX_MODEL_DIR</code>, or set <code>OPENAI_API_KEY</code>."
        : `<i>Voice transcription available via:</i> <code>${escapeHTML(backends.join(", "))}</code>`;
    return warning ? `${status}\n⚠️ ${escapeHTML(warning)}` : status;
}
const DIALOG_PANEL_MIN_WIDTH = 22;
const DIALOG_PANEL_MAX_WIDTH = 36;
export function renderDialogPanel(title, bodyLines, titleIcon) {
    const panelText = buildDialogPanelText(titleIcon ? `${titleIcon} ${title}` : title, bodyLines);
    return {
        text: `<pre>${escapeHTML(panelText)}</pre>`,
        fallbackText: panelText,
        parseMode: "HTML",
    };
}
export function renderToolStartMessage(toolName) {
    return {
        text: `<b>🔧 Running:</b> <code>${escapeHTML(toolName)}</code>`,
        fallbackText: `🔧 Running: ${toolName}`,
        parseMode: "HTML",
    };
}
export function renderToolEndMessage(toolName, partialResult, isError) {
    const preview = summarizeToolOutput(partialResult);
    const icon = isError ? "❌" : "✅";
    const htmlLines = [`<b>${icon}</b> <code>${escapeHTML(toolName)}</code>`];
    const plainLines = [`${icon} ${toolName}`];
    if (preview) {
        htmlLines.push(`<pre>${escapeHTML(preview)}</pre>`);
        plainLines.push(preview);
    }
    return {
        text: htmlLines.join("\n"),
        fallbackText: plainLines.join("\n"),
        parseMode: "HTML",
    };
}
export function formatToolSummaryLine(toolCounts) {
    if (toolCounts.size === 0) {
        return "";
    }
    const entries = [...toolCounts.entries()].sort((left, right) => {
        const countDelta = right[1] - left[1];
        return countDelta !== 0 ? countDelta : left[0].localeCompare(right[0]);
    });
    const totalCount = entries.reduce((sum, [, n]) => sum + n, 0);
    const label = totalCount === 1 ? "tool used" : "tools used";
    const tools = entries
        .map(([name, n]) => (n === 1 ? name : `${name} ×${n}`))
        .join(", ");
    return `🔧 ${totalCount} ${label}: ${tools}`;
}
export function splitTelegramText(text) {
    if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
        return [text];
    }
    const chunks = [];
    let remaining = text;
    while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
        let cut = remaining.lastIndexOf("\n", TELEGRAM_MESSAGE_LIMIT);
        if (cut < TELEGRAM_MESSAGE_LIMIT * 0.5) {
            cut = remaining.lastIndexOf(" ", TELEGRAM_MESSAGE_LIMIT);
        }
        if (cut < TELEGRAM_MESSAGE_LIMIT * 0.5) {
            cut = TELEGRAM_MESSAGE_LIMIT;
        }
        chunks.push(remaining.slice(0, cut).trimEnd());
        remaining = remaining.slice(cut).trimStart();
    }
    if (remaining) {
        chunks.push(remaining);
    }
    return chunks.length > 0 ? chunks : [""];
}
export function splitMarkdownForTelegram(markdown) {
    if (!markdown) {
        return [];
    }
    const chunks = [];
    let remaining = markdown;
    while (remaining) {
        const maxLength = Math.min(remaining.length, FORMATTED_CHUNK_TARGET);
        const initialCut = findPreferredSplitIndex(remaining, maxLength);
        const candidate = remaining.slice(0, initialCut) || remaining.slice(0, 1);
        const rendered = renderMarkdownChunkWithinLimit(candidate);
        chunks.push(rendered);
        remaining = remaining.slice(rendered.sourceText.length).trimStart();
    }
    return chunks;
}
export function renderMarkdownChunkWithinLimit(markdown) {
    if (!markdown) {
        return {
            text: "",
            fallbackText: "",
            parseMode: "HTML",
            sourceText: "",
        };
    }
    let sourceText = markdown;
    let rendered = formatMarkdownMessage(sourceText);
    while (rendered.text.length > TELEGRAM_MESSAGE_LIMIT && sourceText.length > 1) {
        const nextLength = Math.max(1, sourceText.length - Math.max(100, Math.ceil(sourceText.length * 0.1)));
        sourceText = sourceText.slice(0, nextLength).trimEnd() || sourceText.slice(0, nextLength);
        rendered = formatMarkdownMessage(sourceText);
    }
    return {
        ...rendered,
        sourceText,
    };
}
function stripMarkdownFast(text) {
    return text
        .replace(/\*\*/g, "")        // remove all ** (open or close)
        .replace(/\*(?!\s)([^*]*?)\*(?!\*)/g, "$1") // *italic* → italic
        .replace(/^#{1,6}\s+/gm, "")   // ### heading → text
        .replace(/^>\s*/gm, "")         // > quote → text
        .replace(/```[\s\S]*?```/g, "") // code blocks
        .replace(/`([^`]*)`/g, "$1")     // inline code
        .replace(/~~([^~]*)~~/g, "$1")   // strikethrough
        .replace(/\[(.+?)\]\(.+?\)/g, "$1"); // [text](url) → text
}

function stripMarkdownForFallback(markdown) {
    try {
        const html = formatTelegramHTML(markdown);
        const clean = html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
        return stripMarkdownFast(clean);
    } catch {
        return stripMarkdownFast(markdown);
    }
}

export function formatMarkdownMessage(markdown) {
    try {
        return {
            text: formatTelegramHTML(markdown),
            fallbackText: stripMarkdownForFallback(markdown),
            parseMode: "HTML",
        };
    }
    catch (error) {
        console.error("Failed to format Telegram HTML, falling back to plain text", error);
        return {
            text: markdown,
            fallbackText: stripMarkdownFast(markdown),
            parseMode: undefined,
        };
    }
}
export function findPreferredSplitIndex(text, maxLength) {
    if (text.length <= maxLength) {
        return Math.max(1, text.length);
    }
    const newlineIndex = text.lastIndexOf("\n", maxLength);
    if (newlineIndex >= maxLength * 0.5) {
        return Math.max(1, newlineIndex);
    }
    const spaceIndex = text.lastIndexOf(" ", maxLength);
    if (spaceIndex >= maxLength * 0.5) {
        return Math.max(1, spaceIndex);
    }
    return Math.max(1, maxLength);
}
export function buildStreamingPreview(text) {
    if (text.length <= STREAMING_PREVIEW_LIMIT) {
        return text;
    }
    return `${text.slice(0, STREAMING_PREVIEW_LIMIT)}\n\n… streaming (preview truncated)`;
}
export function appendWithCap(base, addition, cap) {
    const combined = `${base}${addition}`;
    return combined.length <= cap ? combined : combined.slice(-cap);
}
export function summarizeToolOutput(text) {
    const trimmed = text.trim();
    if (!trimmed) {
        return "";
    }
    return trimmed.length <= TOOL_OUTPUT_PREVIEW_LIMIT
        ? trimmed
        : `${trimmed.slice(-TOOL_OUTPUT_PREVIEW_LIMIT)}\n…`;
}
export function trimLine(text, maxLength) {
    const singleLine = text.replace(/\s+/g, " ").trim();
    if (singleLine.length <= maxLength) {
        return singleLine;
    }
    return `${singleLine.slice(0, maxLength - 1)}…`;
}
export function stripHtml(text) {
    return text.replace(/<[^>]+>/g, "");
}
export function getWorkspaceShortName(workspace) {
    return workspace.split(/[\\/]/).filter(Boolean).pop() ?? workspace;
}
export function isMessageNotModifiedError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("message is not modified");
}
export function isTelegramParseError(error) {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return (message.includes("can't parse entities") ||
        message.includes("unsupported start tag") ||
        message.includes("unexpected end tag") ||
        message.includes("entity name") ||
        message.includes("parse entities"));
}
export function renderPromptFailure(accumulatedText, error) {
    const message = toFriendlyError(error);
    const statusLine = isAbortError(message) ? "⏹ Aborted" : `⚠️ ${message}`;
    return accumulatedText.trim() ? `${accumulatedText.trim()}\n\n${statusLine}` : statusLine;
}
export function renderFailedText(error) {
    return renderPrefixedError("Failed", error);
}
export function renderExtensionNotice(message, type = "info") {
    const prefix = type === "error" ? "❌" : type === "warning" ? "⚠️" : "ℹ️";
    return {
        text: `<b>${prefix}</b> ${escapeHTML(message)}`,
        fallbackText: `${prefix} ${message}`,
        parseMode: "HTML",
    };
}
export function renderExtensionError(extensionPath, event, error) {
    if (event === "command" && extensionPath.startsWith("command:")) {
        const commandName = extensionPath.slice("command:".length);
        return {
            text: `<b>❌ /${escapeHTML(commandName)} failed:</b> ${escapeHTML(error)}`,
            fallbackText: `❌ /${commandName} failed: ${error}`,
            parseMode: "HTML",
        };
    }
    return {
        text: `<b>❌ Extension error:</b> ${escapeHTML(error)}`,
        fallbackText: `❌ Extension error: ${error}`,
        parseMode: "HTML",
    };
}
export function renderPrefixedError(prefix, error, multiline = false) {
    const message = toFriendlyError(error);
    return {
        text: multiline
            ? `<b>${escapeHTML(prefix)}:</b>\n${escapeHTML(message)}`
            : `<b>${escapeHTML(prefix)}:</b> ${escapeHTML(message)}`,
        fallbackText: multiline ? `${prefix}:\n${message}` : `${prefix}: ${message}`,
        parseMode: "HTML",
    };
}
function buildDialogPanelText(title, bodyLines) {
    const titleLines = wrapDialogPanelLine(title, DIALOG_PANEL_MAX_WIDTH);
    const wrappedBodyLines = bodyLines.flatMap((line) => {
        if (!line.trim()) {
            return [""];
        }
        return wrapDialogPanelLine(line, DIALOG_PANEL_MAX_WIDTH);
    });
    const contentWidth = Math.max(DIALOG_PANEL_MIN_WIDTH, ...titleLines.map((line) => line.length), ...wrappedBodyLines.map((line) => line.length));
    const horizontal = "─".repeat(contentWidth + 2);
    const lines = [
        `┌${horizontal}┐`,
        ...titleLines.map((line) => frameDialogPanelLine(line, contentWidth)),
    ];
    if (wrappedBodyLines.length > 0) {
        lines.push(`├${horizontal}┤`, ...wrappedBodyLines.map((line) => frameDialogPanelLine(line, contentWidth)));
    }
    lines.push(`└${horizontal}┘`);
    return lines.join("\n");
}
function frameDialogPanelLine(text, width) {
    return `│ ${text.padEnd(width, " ")} │`;
}
function wrapDialogPanelLine(text, maxWidth) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return [""];
    }
    const words = normalized.split(" ");
    const lines = [];
    let current = "";
    for (const word of words) {
        let remaining = word;
        while (remaining.length > maxWidth) {
            if (current) {
                lines.push(current);
                current = "";
            }
            lines.push(remaining.slice(0, maxWidth));
            remaining = remaining.slice(maxWidth);
        }
        if (!remaining) {
            continue;
        }
        if (!current) {
            current = remaining;
            continue;
        }
        if (current.length + 1 + remaining.length <= maxWidth) {
            current += ` ${remaining}`;
            continue;
        }
        lines.push(current);
        current = remaining;
    }
    if (current) {
        lines.push(current);
    }
    return lines.length > 0 ? lines : [""];
}
function isAbortError(message) {
    return message.toLowerCase().includes("abort");
}
