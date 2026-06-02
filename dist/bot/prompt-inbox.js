import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
export function startPromptInboxPolling(options) {
    let inFlight = false;
    const poll = () => {
        if (inFlight) {
            return;
        }
        inFlight = true;
        void pollPromptInboxOnce(options)
            .catch((error) => {
            if (options.onError) {
                options.onError(error);
                return;
            }
            console.error("Prompt inbox polling failed", error);
        })
            .finally(() => {
            inFlight = false;
        });
    };
    const timer = setInterval(poll, options.intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
}
export async function pollPromptInboxOnce(options) {
    if (options.isBusy(options.target)) {
        return "busy";
    }
    const claimed = await claimNextPromptInboxFile(options.inboxDir);
    if (!claimed) {
        return "empty";
    }
    const accepted = await options.handlePrompt(options.target, claimed.prompt);
    if (!accepted) {
        return "busy";
    }
    await claimed.ack();
    return "queued";
}
export async function claimNextPromptInboxFile(inboxDir) {
    const candidates = await listPromptInboxCandidates(inboxDir);
    for (const candidate of candidates) {
        const contents = await readFile(candidate.path, "utf8");
        const prompt = contents.trim();
        if (!prompt) {
            await rm(candidate.path, { force: true });
            continue;
        }
        return {
            path: candidate.path,
            prompt,
            ack: async () => {
                await rm(candidate.path, { force: true });
            },
        };
    }
    return undefined;
}
async function listPromptInboxCandidates(inboxDir) {
    let entries;
    try {
        entries = await readdir(inboxDir, { withFileTypes: true });
    }
    catch (error) {
        if (isMissingDirectoryError(error)) {
            return [];
        }
        throw error;
    }
    const candidates = [];
    for (const entry of entries) {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".txt") {
            continue;
        }
        const filePath = path.join(inboxDir, entry.name);
        const fileStat = await stat(filePath);
        candidates.push({
            path: filePath,
            name: entry.name,
            modifiedMs: fileStat.mtimeMs,
        });
    }
    return candidates.sort((left, right) => left.modifiedMs - right.modifiedMs || left.name.localeCompare(right.name));
}
function isMissingDirectoryError(error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
