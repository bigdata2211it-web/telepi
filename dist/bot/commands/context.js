import { escapeHTML } from "../../format.js";
import { renderContextUsageHTML, renderContextUsagePlain, renderSessionStatsHTML, renderSessionStatsPlain, renderFailedText } from "../message-rendering.js";
export function createContextCommandHandlers(deps) {
    const { getExistingSession, safeReply } = deps;
    const handleContextCommand = async (ctx, target) => {
        const piSession = getExistingSession(target);
        if (!piSession?.hasActiveSession()) {
            await safeReply(ctx, escapeHTML("No active session. Context usage is not available."), {
                fallbackText: "No active session. Context usage is not available.",
            }, target);
            return;
        }
        const usage = piSession.getContextUsage();
        const stats = piSession.getSessionStats();
        if (!usage) {
            await safeReply(ctx, escapeHTML("Context usage is not yet available. Send a prompt first."), {
                fallbackText: "Context usage is not yet available. Send a prompt first.",
            }, target);
            return;
        }
        const usagePlain = renderContextUsagePlain(usage);
        const usageHTML = renderContextUsageHTML(usage);
        let statsPlain = "";
        let statsHTML = "";
        if (stats) {
            statsPlain = `\n\n${renderSessionStatsPlain(stats)}`;
            statsHTML = `\n\n${renderSessionStatsHTML(stats)}`;
        }
        const plainText = `Context Usage${statsPlain ? "\n\nSession Stats" : ""}\n\n${usagePlain}${statsPlain}`;
        const html = `<b>Context Usage</b>${statsHTML ? "\n\n<b>Session Stats</b>" : ""}\n\n${usageHTML}${statsHTML}`;
        await safeReply(ctx, html, { fallbackText: plainText }, target);
    };
    return {
        handleContextCommand,
    };
}
