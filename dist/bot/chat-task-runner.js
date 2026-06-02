import { getPiSessionContextKey } from "../pi-session.js";
export function createChatTaskRunner(deps) {
    const runningContexts = new Set();
    const pendingTasks = new Set();
    return {
        tryStartPrompt(target, promptText, task) {
            const contextKey = getPiSessionContextKey(target);
            if (runningContexts.has(contextKey)) {
                return "busy";
            }
            runningContexts.add(contextKey);
            deps.beginProcessing(target, promptText);
            let taskPromise;
            taskPromise = (async () => {
                try {
                    await task();
                }
                catch (error) {
                    deps.onTaskError(error, target, promptText);
                }
                finally {
                    runningContexts.delete(contextKey);
                    deps.endProcessing(target);
                    pendingTasks.delete(taskPromise);
                }
            })();
            pendingTasks.add(taskPromise);
            return "started";
        },
    };
}
