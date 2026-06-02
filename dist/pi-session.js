import { existsSync } from "node:fs";
import path from "node:path";
import { AuthStorage, createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices, createCodingTools, getAgentDir, ModelRegistry, SessionManager, SettingsManager, } from "@mariozechner/pi-coding-agent";
import { createProviderResponseNoticeExtension } from "./provider-response-notices.js";
import { resolveInitialScopedModelSelection, resolveScopedModels, } from "./model-scope.js";
import { readSessionHeader, resolveSessionPathForRuntime, resolveWorkspacePathForRuntime, } from "./pi-session-paths.js";
import { describeEntry } from "./tree.js";
/**
 * Default timeout (seconds) for bash commands in TelePi sessions.
 *
 * TelePi runs headless — interactive commands (e.g. `pi models`, `vim`)
 * or long-running scans (e.g. `find ~`) would hang forever without a timeout.
 * The LLM can still pass an explicit `timeout` to override this per-call.
 */
const DEFAULT_BASH_TIMEOUT_SECONDS = 120;
const TELEPI_LAUNCHD_LABEL = "com.telepi";
const TELEPI_SELF_MANAGEMENT_ERROR = `Blocked TelePi self-management command. launchctl commands targeting ${TELEPI_LAUNCHD_LABEL} cannot run from inside a TelePi session. Manage the launchd service from a separate shell instead.`;
class SessionReferenceResolutionError extends Error {
    code = "SESSION_REFERENCE_RESOLUTION_ERROR";
    constructor(message) {
        super(message);
        this.name = "SessionReferenceResolutionError";
    }
}
function splitShellCommandSegments(command) {
    const segments = [];
    let current = "";
    let quote;
    let escaped = false;
    const pushSegment = () => {
        const trimmed = current.trim();
        if (trimmed) {
            segments.push(trimmed);
        }
        current = "";
    };
    for (let index = 0; index < command.length; index += 1) {
        const character = command[index];
        if (escaped) {
            current += character;
            escaped = false;
            continue;
        }
        if (character === "\\" && quote !== "'") {
            current += character;
            escaped = true;
            continue;
        }
        if (quote) {
            current += character;
            if (character === quote) {
                quote = undefined;
            }
            continue;
        }
        if (character === "\"" || character === "'") {
            current += character;
            quote = character;
            continue;
        }
        if (character === ";" || character === "\n") {
            pushSegment();
            continue;
        }
        if (character === "&") {
            pushSegment();
            if (command[index + 1] === "&") {
                index += 1;
            }
            continue;
        }
        if (character === "|") {
            pushSegment();
            if (command[index + 1] === "|") {
                index += 1;
            }
            continue;
        }
        current += character;
    }
    pushSegment();
    return segments;
}
function tokenizeShellCommand(command) {
    const tokens = [];
    let current = "";
    let quote;
    let escaped = false;
    const pushToken = () => {
        if (current) {
            tokens.push(current);
            current = "";
        }
    };
    for (let index = 0; index < command.length; index += 1) {
        const character = command[index];
        if (escaped) {
            current += character;
            escaped = false;
            continue;
        }
        if (character === "\\" && quote !== "'") {
            escaped = true;
            continue;
        }
        if (quote) {
            if (character === quote) {
                quote = undefined;
                continue;
            }
            current += character;
            continue;
        }
        if (character === "\"" || character === "'") {
            quote = character;
            continue;
        }
        if (/\s/.test(character)) {
            pushToken();
            continue;
        }
        current += character;
    }
    pushToken();
    return tokens;
}
function getExecutableName(token) {
    return path.posix.basename(token.replace(/^[()]+|[()]+$/g, "")).toLowerCase();
}
function isEnvironmentAssignment(token) {
    return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}
function stripCommandPrefixes(tokens) {
    let index = 0;
    while (index < tokens.length) {
        const token = tokens[index];
        const executableName = getExecutableName(token);
        if (isEnvironmentAssignment(token)) {
            index += 1;
            continue;
        }
        if (executableName === "env") {
            index += 1;
            while (index < tokens.length && (tokens[index].startsWith("-") || isEnvironmentAssignment(tokens[index]))) {
                index += 1;
            }
            continue;
        }
        if (executableName === "sudo" || executableName === "command" || executableName === "nohup") {
            index += 1;
            while (index < tokens.length && tokens[index].startsWith("-")) {
                index += 1;
            }
            continue;
        }
        break;
    }
    return tokens.slice(index);
}
function extractShellWrapperCommand(tokens) {
    for (let index = 1; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === "-c") {
            return tokens[index + 1];
        }
        if (/^-[A-Za-z]*c$/.test(token)) {
            return tokens[index + 1];
        }
        if (token.startsWith("-c") && token.length > 2) {
            return token.slice(2);
        }
    }
    return undefined;
}
function isBlockedTelepiSelfManagementCommand(command) {
    for (const segment of splitShellCommandSegments(command)) {
        const tokens = stripCommandPrefixes(tokenizeShellCommand(segment));
        const executable = tokens[0];
        if (!executable) {
            continue;
        }
        const executableName = getExecutableName(executable);
        if (executableName === "launchctl") {
            return tokens.some((token) => token.toLowerCase().includes(TELEPI_LAUNCHD_LABEL));
        }
        if (["bash", "sh", "zsh", "dash", "fish", "ksh"].includes(executableName)) {
            const nestedCommand = extractShellWrapperCommand(tokens);
            if (nestedCommand && isBlockedTelepiSelfManagementCommand(nestedCommand)) {
                return true;
            }
        }
    }
    return false;
}
function getBlockedBashCommandReason(command) {
    if (isBlockedTelepiSelfManagementCommand(command)) {
        return TELEPI_SELF_MANAGEMENT_ERROR;
    }
    return undefined;
}
function patchBashTimeout(session) {
    const tools = session.agent.state.tools;
    const patched = tools.map((tool) => {
        if (tool.name !== "bash")
            return tool;
        const originalExecute = tool.execute;
        const execute = (toolCallId, params, signal, onUpdate) => originalExecute(toolCallId, withDefaultBashTimeout(params), signal, onUpdate);
        return {
            ...tool,
            description: tool.description +
                ` Commands time out after ${DEFAULT_BASH_TIMEOUT_SECONDS} seconds by default. Pass a longer timeout for slow commands (e.g. npm install, test suites).`,
            execute,
        };
    });
    session.agent.state.tools = patched;
}
function withDefaultBashTimeout(params) {
    if (!isBashToolInput(params)) {
        return params;
    }
    const blockedReason = getBlockedBashCommandReason(params.command);
    if (blockedReason) {
        throw new Error(blockedReason);
    }
    return {
        ...params,
        timeout: params.timeout ?? DEFAULT_BASH_TIMEOUT_SECONDS,
    };
}
function isBashToolInput(value) {
    return typeof value === "object"
        && value !== null
        && "command" in value
        && typeof value.command === "string"
        && (!("timeout" in value) || value.timeout === undefined || typeof value.timeout === "number");
}
function getDesiredBuiltInToolNames(cwd) {
    return [...new Set(createCodingTools(cwd).map((tool) => tool.name))];
}
function ensureBuiltInToolActivation(session, builtInToolNames) {
    if (builtInToolNames.length === 0) {
        return;
    }
    const currentActiveToolNames = session.getActiveToolNames();
    const nextActiveToolNames = [...new Set([...currentActiveToolNames, ...builtInToolNames])];
    const changed = nextActiveToolNames.length !== currentActiveToolNames.length
        || nextActiveToolNames.some((toolName, index) => toolName !== currentActiveToolNames[index]);
    if (!changed) {
        return;
    }
    session.setActiveToolsByName(nextActiveToolNames);
}
export async function createPiSession(config, overrideSessionPath, overrideWorkspace) {
    const workspace = overrideWorkspace ?? config.workspace;
    return createPiSessionHandle(config, workspace, createSessionManager(config, workspace, overrideSessionPath, overrideWorkspace !== undefined));
}
async function createNewPiSession(config, workspace, options) {
    const sessionManager = SessionManager.create(workspace);
    if (options?.parentSession) {
        sessionManager.newSession({ parentSession: options.parentSession });
    }
    const handle = await createPiSessionHandle(config, workspace, sessionManager, { reason: "new" });
    try {
        await applySessionSetup(handle.runtime.session, options?.setup);
        return handle;
    }
    catch (error) {
        try {
            await handle.dispose();
        }
        catch (disposeError) {
            console.error("Failed to dispose session after setup error:", disposeError);
        }
        throw error;
    }
}
async function createPiSessionHandle(config, workspace, sessionManager, initialSessionStartEvent) {
    const authStorage = AuthStorage.create();
    let getSlashCommands = () => [];
    const createRuntime = async ({ cwd, agentDir, sessionManager: runtimeSessionManager, sessionStartEvent, }) => {
        const settingsManager = SettingsManager.create(cwd);
        const modelRegistry = ModelRegistry.create(authStorage);
        const services = await createAgentSessionServices({
            cwd,
            agentDir,
            authStorage,
            modelRegistry,
            settingsManager,
            resourceLoaderOptions: {
                extensionFactories: [createProviderResponseNoticeExtension()],
            },
        });
        const configuredModel = resolveModelOverride(services.modelRegistry, config.piModel);
        const scopedModels = await resolveScopedModels(services.settingsManager, services.modelRegistry);
        const hasExistingSession = sessionStartEvent?.reason !== "new"
            && Boolean(runtimeSessionManager.getSessionFile?.());
        const { model, thinkingLevel } = resolveInitialScopedModelSelection({
            configuredModel,
            scopedModels,
            settingsManager: services.settingsManager,
            modelRegistry: services.modelRegistry,
            hasExistingSession,
        });
        const desiredBuiltInToolNames = getDesiredBuiltInToolNames(cwd);
        const result = await createAgentSessionFromServices({
            services,
            sessionManager: runtimeSessionManager,
            sessionStartEvent,
            model,
            thinkingLevel,
            scopedModels,
        });
        ensureBuiltInToolActivation(result.session, desiredBuiltInToolNames);
        getSlashCommands = () => result.extensionsResult.runtime.getCommands?.() ?? [];
        patchBashTimeout(result.session);
        return {
            ...result,
            services,
            diagnostics: dedupeDiagnostics([
                ...services.diagnostics,
                ...collectSettingsDiagnostics(settingsManager),
                ...collectSessionResourceDiagnostics(services.resourceLoader, result.session),
            ]),
        };
    };
    const runtime = await createAgentSessionRuntime(createRuntime, {
        cwd: workspace,
        agentDir: getAgentDir(),
        sessionManager,
        ...(initialSessionStartEvent ? {
            sessionStartEvent: {
                type: "session_start",
                reason: initialSessionStartEvent.reason,
            },
        } : {}),
    });
    return {
        runtime,
        getSlashCommands: () => getSlashCommands(),
        dispose: async () => {
            await runtime.dispose();
        },
    };
}
export function subscribeToSession(session, callbacks) {
    return session.subscribe((event) => {
        switch (event.type) {
            case "message_update":
                if (event.assistantMessageEvent.type === "text_delta") {
                    callbacks.onTextDelta(event.assistantMessageEvent.delta);
                }
                break;
            case "tool_execution_start":
                callbacks.onToolStart(event.toolName, event.toolCallId);
                break;
            case "tool_execution_update":
                callbacks.onToolUpdate(event.toolCallId, stringifyToolData(event.partialResult));
                break;
            case "tool_execution_end":
                callbacks.onToolEnd(event.toolCallId, event.isError);
                break;
            case "agent_end":
                callbacks.onAgentEnd();
                break;
            default:
                break;
        }
    });
}
export async function promptSession(session, text, images) {
    try {
        if (images && images.length > 0) {
            await session.prompt(text, { images });
            return;
        }
        await session.prompt(text);
    }
    catch (error) {
        throw wrapError("Pi session prompt failed", error);
    }
}
export class PiSessionService {
    config;
    handle;
    currentWorkspace;
    sessionCallbacks;
    sessionUnsubscribe;
    extensionBindings;
    constructor(config) {
        this.config = config;
        this.currentWorkspace = config.workspace;
    }
    static async create(config) {
        const service = new PiSessionService(config);
        service.handle = await createPiSession(config);
        service.currentWorkspace = service.handle.runtime.cwd;
        return service;
    }
    getSession() {
        return this.getHandle().runtime.session;
    }
    isStreaming() {
        return this.handle?.runtime.session.isStreaming ?? false;
    }
    hasActiveSession() {
        return this.handle !== undefined;
    }
    getCurrentWorkspace() {
        return this.currentWorkspace;
    }
    getInfo() {
        if (!this.handle) {
            return {
                sessionId: "(no active session)",
                sessionFile: undefined,
                workspace: this.currentWorkspace,
                sessionName: undefined,
                modelFallbackMessage: undefined,
                model: undefined,
            };
        }
        const session = this.handle.runtime.session;
        const model = session.model;
        const diagnostics = this.handle.runtime.diagnostics.length > 0
            ? [...this.handle.runtime.diagnostics]
            : undefined;
        return {
            sessionId: session.sessionId,
            sessionFile: session.sessionFile,
            workspace: this.currentWorkspace,
            sessionName: session.sessionName,
            modelFallbackMessage: this.handle.runtime.modelFallbackMessage,
            model: model ? `${model.provider}/${model.id}` : undefined,
            ...(diagnostics ? { diagnostics } : {}),
        };
    }
    subscribe(callbacks) {
        this.sessionCallbacks = callbacks;
        this.rebindSessionSubscription();
        return () => {
            if (this.sessionCallbacks === callbacks) {
                this.sessionCallbacks = undefined;
                this.sessionUnsubscribe?.();
                this.sessionUnsubscribe = undefined;
            }
        };
    }
    async prompt(text, images) {
        this.reloadAuthStorage();
        await promptSession(this.getSession(), text, images);
    }
    async bindExtensions(bindings) {
        this.extensionBindings = bindings;
        await this.bindExtensionsToCurrentSession();
    }
    async listSlashCommands() {
        const commands = this.getHandle().getSlashCommands();
        const deduped = new Map();
        for (const command of commands) {
            const name = command.name.replace(/^\/+/, "").trim();
            if (!name || deduped.has(name)) {
                continue;
            }
            deduped.set(name, {
                ...command,
                name,
            });
        }
        return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name));
    }
    async abort() {
        if (!this.handle) {
            return;
        }
        await this.handle.runtime.session.abort();
    }
    getContextUsage() {
        return this.handle?.runtime.session.getContextUsage();
    }
    getSessionStats() {
        return this.handle?.runtime.session.getSessionStats();
    }
    async listAllSessions() {
        const sessions = await SessionManager.listAll();
        sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
        return sessions.map((s) => ({
            id: s.id,
            firstMessage: s.firstMessage,
            path: s.path,
            messageCount: s.messageCount,
            cwd: s.cwd,
            modified: s.modified,
            name: s.name,
        }));
    }
    async listWorkspaces() {
        const sessions = await SessionManager.listAll();
        const workspaces = new Set();
        for (const session of sessions) {
            if (session.cwd) {
                workspaces.add(session.cwd);
            }
        }
        return [...workspaces].sort();
    }
    async newSession(request) {
        const options = normalizeNewSessionOptions(request);
        const effectiveWorkspace = options.workspace ?? this.currentWorkspace;
        if ((!this.handle || effectiveWorkspace !== this.currentWorkspace) && options.withSession) {
            throw new Error("TelePi only supports withSession callbacks for runtime-backed new-session replacements.");
        }
        if (!this.handle || effectiveWorkspace !== this.currentWorkspace) {
            const nextHandle = await createNewPiSession(this.config, effectiveWorkspace, options);
            await this.replaceHandle(nextHandle);
            return { info: this.getInfo(), created: true };
        }
        const previousSession = this.getSession();
        const previousWorkspace = this.currentWorkspace;
        const result = await this.getHandle().runtime.newSession({
            parentSession: options.parentSession,
            setup: options.setup,
            withSession: options.withSession,
        });
        await this.rebindAfterRuntimeSessionReplacement(previousSession, previousWorkspace);
        return { info: this.getInfo(), created: !result.cancelled };
    }
    async listModels(showAll = false) {
        this.reloadAuthStorage();
        const session = this.getSession();
        const currentModel = session.model;
        const availableModels = this.getModelRegistry().getAvailable();
        const availableKeys = new Set(availableModels.map((model) => `${model.provider}/${model.id}`));
        const scopedThinkingLevels = new Map(session.scopedModels.map((scoped) => [
            `${scoped.model.provider}/${scoped.model.id}`,
            scoped.thinkingLevel,
        ]));
        const available = showAll || session.scopedModels.length === 0
            ? availableModels
            : session.scopedModels
                .map((scoped) => scoped.model)
                .filter((model) => availableKeys.has(`${model.provider}/${model.id}`));
        return available.map((model) => ({
            provider: model.provider,
            id: model.id,
            name: model.name,
            current: currentModel
                ? model.provider === currentModel.provider && model.id === currentModel.id
                : false,
            thinkingLevel: scopedThinkingLevels.get(`${model.provider}/${model.id}`),
        }));
    }
    async setModel(provider, modelId, thinkingLevel) {
        this.reloadAuthStorage();
        const session = this.getSession();
        const modelRegistry = this.getModelRegistry();
        const model = modelRegistry.find(provider, modelId);
        if (!model) {
            throw new Error(`Model not found: ${provider}/${modelId}`);
        }
        await session.setModel(model);
        if (thinkingLevel !== undefined) {
            session.setThinkingLevel(thinkingLevel);
        }
        return `${model.provider}/${model.id}`;
    }
    async resolveSessionReference(sessionReference) {
        const normalizedReference = sessionReference.trim();
        if (!normalizedReference) {
            throw new SessionReferenceResolutionError("Session reference cannot be empty.");
        }
        const remappedReferencePath = resolveSessionPathForRuntime(normalizedReference);
        const looksLikePath = normalizedReference.includes("/")
            || normalizedReference.includes("\\")
            || normalizedReference.endsWith(".jsonl")
            || normalizedReference.startsWith("~");
        if (looksLikePath) {
            if (!existsSync(remappedReferencePath)) {
                throw new SessionReferenceResolutionError(`Saved session not found: ${normalizedReference}`);
            }
            const header = readSessionHeader(remappedReferencePath);
            let indexedWorkspace;
            try {
                const indexedMatch = (await this.listAllSessions()).find((session) => session.path === normalizedReference
                    || session.path === remappedReferencePath
                    || resolveSessionPathForRuntime(session.path) === remappedReferencePath);
                indexedWorkspace = indexedMatch?.cwd;
            }
            catch {
                indexedWorkspace = undefined;
            }
            const workspaceResolution = this.resolveSessionWorkspace(indexedWorkspace ?? header?.cwd);
            return {
                id: header?.id ?? path.basename(remappedReferencePath),
                path: remappedReferencePath,
                cwd: workspaceResolution.cwd,
                ...(workspaceResolution.workspaceWarning
                    ? { workspaceWarning: workspaceResolution.workspaceWarning }
                    : {}),
                matchType: "path",
            };
        }
        const allSessions = await this.listAllSessions();
        const currentWorkspaceSessions = allSessions.filter((session) => session.cwd === this.currentWorkspace);
        const exactIdMatch = currentWorkspaceSessions.find((session) => session.id === normalizedReference)
            ?? allSessions.find((session) => session.id === normalizedReference);
        if (exactIdMatch) {
            const workspaceResolution = this.resolveSessionWorkspace(exactIdMatch.cwd);
            return {
                id: exactIdMatch.id,
                path: exactIdMatch.path,
                cwd: workspaceResolution.cwd,
                ...(workspaceResolution.workspaceWarning
                    ? { workspaceWarning: workspaceResolution.workspaceWarning }
                    : {}),
                matchType: "id",
            };
        }
        const localPrefixMatches = currentWorkspaceSessions.filter((session) => session.id.startsWith(normalizedReference));
        if (localPrefixMatches.length === 1) {
            const [prefixMatch] = localPrefixMatches;
            const workspaceResolution = this.resolveSessionWorkspace(prefixMatch.cwd);
            return {
                id: prefixMatch.id,
                path: prefixMatch.path,
                cwd: workspaceResolution.cwd,
                ...(workspaceResolution.workspaceWarning
                    ? { workspaceWarning: workspaceResolution.workspaceWarning }
                    : {}),
                matchType: "prefix",
            };
        }
        if (localPrefixMatches.length > 1) {
            throw new SessionReferenceResolutionError(`Session ID prefix "${normalizedReference}" matches ${localPrefixMatches.length} saved sessions in the current workspace. Use more characters or /sessions to pick one.`);
        }
        const prefixMatches = allSessions.filter((session) => session.id.startsWith(normalizedReference));
        if (prefixMatches.length === 1) {
            const [prefixMatch] = prefixMatches;
            const workspaceResolution = this.resolveSessionWorkspace(prefixMatch.cwd);
            return {
                id: prefixMatch.id,
                path: prefixMatch.path,
                cwd: workspaceResolution.cwd,
                ...(workspaceResolution.workspaceWarning
                    ? { workspaceWarning: workspaceResolution.workspaceWarning }
                    : {}),
                matchType: "prefix",
            };
        }
        if (prefixMatches.length > 1) {
            throw new SessionReferenceResolutionError(`Session ID prefix "${normalizedReference}" matches ${prefixMatches.length} saved sessions. Use more characters or /sessions to pick one.`);
        }
        throw new SessionReferenceResolutionError(`No saved session matches "${normalizedReference}". Use /sessions to browse, or pass a full session path or session ID.`);
    }
    /**
     * Best-effort helper for UI flows that want a workspace hint before switching.
     * Missing sessions and transient session-index failures should both surface as
     * "no workspace available" so callers can safely fall back.
     */
    async resolveWorkspaceForSession(sessionPath) {
        try {
            return (await this.tryResolveSessionReference(sessionPath))?.cwd;
        }
        catch {
            return undefined;
        }
    }
    async switchSession(sessionPath, request) {
        const options = normalizeSwitchSessionOptions(request);
        const resolvedReference = await this.tryResolveSessionReference(sessionPath);
        const runtimeSessionPath = resolvedReference?.path ?? resolveSessionPathForRuntime(sessionPath);
        const effectiveWorkspace = options.workspace
            ?? resolvedReference?.cwd
            ?? this.currentWorkspace;
        if (!this.handle && options.withSession) {
            throw new Error("TelePi only supports withSession callbacks for runtime-backed session switches.");
        }
        if (!this.handle) {
            const nextHandle = await createPiSession(this.config, runtimeSessionPath, effectiveWorkspace);
            await this.replaceHandle(nextHandle);
            return {
                ...this.getInfo(),
                cancelled: false,
            };
        }
        const previousSession = this.getSession();
        const previousWorkspace = this.currentWorkspace;
        const result = await this.getHandle().runtime.switchSession(runtimeSessionPath, {
            cwdOverride: effectiveWorkspace,
            withSession: options.withSession,
        });
        await this.rebindAfterRuntimeSessionReplacement(previousSession, previousWorkspace);
        return {
            ...this.getInfo(),
            cancelled: result.cancelled,
        };
    }
    async tryResolveSessionReference(sessionPath) {
        try {
            return await this.resolveSessionReference(sessionPath);
        }
        catch (error) {
            if (error instanceof SessionReferenceResolutionError) {
                return undefined;
            }
            throw error;
        }
    }
    resolveSessionWorkspace(workspace) {
        const resolvedWorkspace = resolveWorkspacePathForRuntime(workspace);
        if (resolvedWorkspace) {
            return { cwd: resolvedWorkspace };
        }
        if (!workspace) {
            return {};
        }
        return {
            cwd: undefined,
            workspaceWarning: `Saved workspace ${workspace} is unavailable in this TelePi runtime. Continuing in the current workspace instead.`,
        };
    }
    getUnavailableSavedWorkspace(sessionFile) {
        const header = readSessionHeader(sessionFile);
        if (!header?.cwd || header.cwd === this.currentWorkspace) {
            return undefined;
        }
        return resolveWorkspacePathForRuntime(header.cwd) ? undefined : header.cwd;
    }
    getTree() {
        return this.getSession().sessionManager.getTree();
    }
    getLeafId() {
        return this.getSession().sessionManager.getLeafId();
    }
    getEntry(id) {
        return this.getSession().sessionManager.getEntry(id);
    }
    getChildren(id) {
        return this.getSession().sessionManager.getChildren(id);
    }
    async navigateTree(targetId, options) {
        return this.getSession().navigateTree(targetId, options);
    }
    async fork(entryId, options) {
        const previousSession = this.getSession();
        const previousWorkspace = this.currentWorkspace;
        const result = await this.getHandle().runtime.fork(entryId, options);
        await this.rebindAfterRuntimeSessionReplacement(previousSession, previousWorkspace);
        return { cancelled: result.cancelled };
    }
    async reload() {
        await this.getSession().reload();
    }
    setLabel(targetId, label) {
        this.getSession().sessionManager.appendLabelChange(targetId, label);
    }
    getLabels() {
        const tree = this.getTree();
        const labels = [];
        const walk = (node) => {
            if (node.label) {
                labels.push({
                    id: node.entry.id,
                    label: node.label,
                    description: describeEntry(node.entry),
                });
            }
            for (const child of node.children) {
                walk(child);
            }
        };
        for (const root of tree) {
            walk(root);
        }
        return labels;
    }
    async handback() {
        const info = {
            sessionFile: this.handle?.runtime.session.sessionFile,
            workspace: this.currentWorkspace,
        };
        const unavailableWorkspace = info.sessionFile
            ? this.getUnavailableSavedWorkspace(info.sessionFile)
            : undefined;
        if (unavailableWorkspace) {
            throw new Error(`Cannot hand back this session while its saved workspace is unavailable (${unavailableWorkspace}). Reopen it from a valid workspace first.`);
        }
        const previousHandle = this.handle;
        this.sessionUnsubscribe?.();
        this.sessionUnsubscribe = undefined;
        this.handle = undefined;
        try {
            await previousHandle?.dispose();
        }
        catch (error) {
            console.error("Failed to dispose session during handback:", error);
        }
        return info;
    }
    dispose() {
        this.sessionUnsubscribe?.();
        this.sessionUnsubscribe = undefined;
        const handle = this.handle;
        this.handle = undefined;
        if (!handle) {
            return;
        }
        void handle.dispose().catch((error) => {
            console.error("Failed to dispose Pi session:", error);
        });
    }
    getHandle() {
        if (!this.handle) {
            throw new Error("Pi session is not initialized");
        }
        return this.handle;
    }
    reloadAuthStorage() {
        this.getHandle().runtime.services.authStorage.reload();
    }
    getModelRegistry() {
        return this.getHandle().runtime.services.modelRegistry;
    }
    async replaceHandle(nextHandle) {
        const previousHandle = this.handle;
        const previousSession = previousHandle?.runtime.session;
        const previousWorkspace = this.currentWorkspace;
        this.handle = nextHandle;
        try {
            await this.rebindAfterSessionReplacement(previousSession);
        }
        catch (error) {
            await this.disposeHandleAfterRebindFailure(nextHandle, previousWorkspace, error);
        }
        finally {
            try {
                await previousHandle?.dispose();
            }
            catch (error) {
                console.error("Failed to dispose previous session:", error);
            }
        }
    }
    async bindExtensionsToCurrentSession() {
        if (!this.extensionBindings || !this.handle) {
            return;
        }
        await this.getSession().bindExtensions(this.extensionBindings);
    }
    rebindSessionSubscription() {
        this.sessionUnsubscribe?.();
        this.sessionUnsubscribe = undefined;
        if (!this.sessionCallbacks || !this.handle) {
            return;
        }
        this.sessionUnsubscribe = subscribeToSession(this.getSession(), this.sessionCallbacks);
    }
    async disposeHandleAfterRebindFailure(handle, previousWorkspace, error) {
        this.sessionUnsubscribe?.();
        this.sessionUnsubscribe = undefined;
        this.handle = undefined;
        this.currentWorkspace = previousWorkspace;
        try {
            await handle?.dispose();
        }
        catch (disposeError) {
            console.error("Failed to dispose replacement session after rebinding error:", disposeError);
        }
        throw error;
    }
    async rebindAfterRuntimeSessionReplacement(previousSession, previousWorkspace) {
        try {
            await this.rebindAfterSessionReplacement(previousSession);
        }
        catch (error) {
            await this.disposeHandleAfterRebindFailure(this.handle, previousWorkspace, error);
        }
    }
    async rebindAfterSessionReplacement(previousSession) {
        if (!this.handle) {
            return;
        }
        const currentSession = this.getSession();
        // AgentSessionRuntime replacements track the effective workspace on runtime.cwd.
        // TelePi treats runtime.cwd as the source of truth after every runtime-driven
        // session replacement while keeping these flows serialized through the service instance.
        this.currentWorkspace = this.handle.runtime.cwd;
        if (previousSession === currentSession) {
            return;
        }
        await this.bindExtensionsToCurrentSession();
        this.rebindSessionSubscription();
    }
}
export function getPiSessionContextKey(context) {
    return `${String(context.chatId)}::${context.messageThreadId ?? "root"}`;
}
export class PiSessionRegistry {
    config;
    services = new Map();
    inflight = new Map();
    generations = new Map();
    bootstrapSessionPath;
    constructor(config) {
        this.config = config;
        this.bootstrapSessionPath = config.piSessionPath;
    }
    static async create(config) {
        return new PiSessionRegistry(config);
    }
    has(context) {
        return this.services.has(getPiSessionContextKey(context));
    }
    get(context) {
        return this.services.get(getPiSessionContextKey(context));
    }
    getInfo(context) {
        return this.get(context)?.getInfo() ?? {
            sessionId: "(no active session)",
            sessionFile: undefined,
            workspace: this.config.workspace,
            sessionName: undefined,
            modelFallbackMessage: undefined,
            model: undefined,
        };
    }
    async getOrCreate(context) {
        const key = getPiSessionContextKey(context);
        const existing = this.services.get(key);
        if (existing) {
            return existing;
        }
        const inflight = this.inflight.get(key);
        if (inflight) {
            return inflight;
        }
        const generation = this.bumpGeneration(key);
        const createPromise = PiSessionService.create(this.createServiceConfig())
            .then((service) => {
            this.inflight.delete(key);
            if (this.generations.get(key) !== generation) {
                service.dispose();
                const replacement = this.services.get(key);
                if (replacement) {
                    return replacement;
                }
                throw new Error("Session removed during initialization");
            }
            this.services.set(key, service);
            return service;
        })
            .catch((error) => {
            this.inflight.delete(key);
            throw error;
        });
        this.inflight.set(key, createPromise);
        return createPromise;
    }
    remove(context) {
        const key = getPiSessionContextKey(context);
        this.bumpGeneration(key);
        const service = this.services.get(key);
        service?.dispose();
        this.services.delete(key);
        this.inflight.delete(key);
    }
    dispose() {
        const allKeys = new Set([...this.services.keys(), ...this.inflight.keys()]);
        for (const key of allKeys) {
            this.bumpGeneration(key);
        }
        for (const service of this.services.values()) {
            service.dispose();
        }
        this.services.clear();
        this.inflight.clear();
    }
    createServiceConfig() {
        const initialSessionPath = this.consumeBootstrapSessionPath();
        return {
            ...this.config,
            telegramAllowedUserIdSet: new Set(this.config.telegramAllowedUserIds),
            piSessionPath: initialSessionPath,
        };
    }
    consumeBootstrapSessionPath() {
        const sessionPath = this.bootstrapSessionPath;
        this.bootstrapSessionPath = undefined;
        return sessionPath;
    }
    bumpGeneration(key) {
        const nextGeneration = (this.generations.get(key) ?? 0) + 1;
        this.generations.set(key, nextGeneration);
        return nextGeneration;
    }
}
function normalizeNewSessionOptions(request) {
    if (typeof request === "string") {
        return { workspace: request };
    }
    return request ?? {};
}
function normalizeSwitchSessionOptions(request) {
    if (typeof request === "string") {
        return { workspace: request };
    }
    return request ?? {};
}
async function applySessionSetup(session, setup) {
    if (!setup) {
        return;
    }
    await setup(session.sessionManager);
    session.agent.state.messages = session.sessionManager.buildSessionContext().messages;
}
function collectSettingsDiagnostics(settingsManager) {
    return (settingsManager.drainErrors?.() ?? []).map(({ scope, error }) => ({
        type: "warning",
        message: `${humanizeDiagnosticScope(scope)} settings: ${error.message}`,
    }));
}
function collectSessionResourceDiagnostics(resourceLoader, session) {
    return [
        ...(resourceLoader.getExtensions?.().errors ?? []).map(({ path, error }) => ({
            type: "error",
            message: `Failed to load extension "${path}": ${error}`,
        })),
        ...normalizeResourceDiagnostics("Skill", resourceLoader.getSkills?.().diagnostics ?? []),
        ...normalizeResourceDiagnostics("Prompt", resourceLoader.getPrompts?.().diagnostics ?? []),
        ...normalizeResourceDiagnostics("Theme", resourceLoader.getThemes?.().diagnostics ?? []),
        ...normalizeResourceDiagnostics("Extension", session.extensionRunner?.getCommandDiagnostics?.() ?? []),
        ...normalizeResourceDiagnostics("Extension", session.extensionRunner?.getShortcutDiagnostics?.() ?? []),
    ];
}
function normalizeResourceDiagnostics(label, diagnostics) {
    return diagnostics.map((diagnostic) => {
        if (diagnostic.type === "collision" && diagnostic.collision) {
            return {
                type: "warning",
                message: `${label} collision (${diagnostic.collision.name}): using ${diagnostic.collision.winnerPath}, skipped ${diagnostic.collision.loserPath}`,
            };
        }
        const location = diagnostic.path ? ` (${diagnostic.path})` : "";
        return {
            type: diagnostic.type === "error" ? "error" : "warning",
            message: `${label} issue${location}: ${diagnostic.message}`,
        };
    });
}
function dedupeDiagnostics(diagnostics) {
    const seen = new Set();
    const deduped = [];
    for (const diagnostic of diagnostics) {
        const key = `${diagnostic.type}:${diagnostic.message}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(diagnostic);
    }
    return deduped;
}
function humanizeDiagnosticScope(scope) {
    if (!scope) {
        return "Unknown";
    }
    return scope.charAt(0).toUpperCase() + scope.slice(1);
}
function createSessionManager(config, workspace, overrideSessionPath, hasWorkspaceOverride = false) {
    const sessionPath = overrideSessionPath ?? config.piSessionPath;
    if (sessionPath) {
        const runtimeSessionPath = resolveSessionPathForRuntime(sessionPath);
        const headerWorkspace = resolveWorkspacePathForRuntime(readSessionHeader(runtimeSessionPath)?.cwd);
        return SessionManager.open(runtimeSessionPath, undefined, hasWorkspaceOverride ? workspace : (headerWorkspace ?? workspace));
    }
    return SessionManager.create(workspace);
}
function resolveModelOverride(modelRegistry, modelRef) {
    if (!modelRef) {
        return undefined;
    }
    const normalized = modelRef.trim();
    const slashIndex = normalized.indexOf("/");
    if (slashIndex >= 0) {
        const provider = normalized.slice(0, slashIndex).trim();
        const rawModelId = normalized.slice(slashIndex + 1).trim();
        const modelId = rawModelId.split(":")[0]?.trim();
        if (!provider || !modelId) {
            throw new Error(`Invalid PI_MODEL value: ${modelRef}`);
        }
        const model = modelRegistry.find(provider, modelId);
        if (!model) {
            throw new Error(`Could not resolve PI_MODEL: ${modelRef}`);
        }
        return model;
    }
    const matches = modelRegistry.getAll().filter((model) => model.id === normalized);
    if (matches.length === 0) {
        throw new Error(`Could not resolve PI_MODEL: ${modelRef}`);
    }
    if (matches.length > 1) {
        const providers = matches.map((model) => model.provider).join(", ");
        throw new Error(`PI_MODEL is ambiguous. Use provider/modelId instead. Matches: ${providers}`);
    }
    return matches[0];
}
function stringifyToolData(value) {
    if (typeof value === "string") {
        return value;
    }
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return String(value);
    }
}
function wrapError(message, error) {
    if (error instanceof Error) {
        return new Error(`${message}: ${error.message}`, { cause: error });
    }
    return new Error(`${message}: ${String(error)}`);
}
