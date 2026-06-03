import { getPiSessionContextKey } from "../pi-session.js";

export function createChatTaskRunner(deps) {
  const runningContexts = new Set();
  const pendingTasks = new Set();
  const queues = new Map(); // contextKey → [{target, promptText, task}]

  function getQueue(contextKey) {
    if (!queues.has(contextKey)) queues.set(contextKey, []);
    return queues.get(contextKey);
  }

  function dequeueNext(contextKey) {
    const q = getQueue(contextKey);
    return q.shift() || null;
  }

  async function runTask(target, promptText, task, contextKey) {
    runningContexts.add(contextKey);
    deps.beginProcessing(target, promptText);
    try { deps.updateQueueButtons?.(target); } catch {}
    let taskPromise;
    taskPromise = (async () => {
      try {
        await task();
      } catch (error) {
        deps.onTaskError(error, target, promptText);
      } finally {
        runningContexts.delete(contextKey);
        pendingTasks.delete(taskPromise);
        deps.endProcessing(target);
        // Обновляем кнопки после ответа
        try { deps.updateQueueButtons?.(target); } catch {}
        // Запускаем следующий из очереди
        const next = dequeueNext(contextKey);
        if (next) {
          runTask(next.target, next.promptText, next.task, contextKey);
        }
      }
    })();
    pendingTasks.add(taskPromise);
  }

  return {
    tryStartPrompt(target, promptText, task) {
      const contextKey = getPiSessionContextKey(target);
      if (runningContexts.has(contextKey)) {
        const q = getQueue(contextKey);
        q.push({ target, promptText, task });
        return { status: "queued", queueLength: q.length };
      }
      runTask(target, promptText, task, contextKey);
      return { status: "started", queueLength: 0 };
    },

    /** Отменить последнее: abort текущего или pop из очереди */
    cancelLast(target) {
      const contextKey = getPiSessionContextKey(target);
      // Приоритет: сначала abort если бот сейчас стримит
      if (runningContexts.has(contextKey)) {
        deps.abortSession?.(target);
        return { action: "abort", remaining: getQueue(contextKey).length };
      }
      // Не стримит — pop из очереди если есть
      const q = getQueue(contextKey);
      if (q.length > 0) {
        q.pop();
        try { deps.updateQueueButtons?.(target); } catch {}
        return { action: "pop", remaining: q.length };
      }
      return { action: "nothing", remaining: 0 };
    },

    /** Очистить всю очередь */
    clearAll(target) {
      const contextKey = getPiSessionContextKey(target);
      const q = getQueue(contextKey);
      const count = q.length;
      q.length = 0;
      try { deps.updateQueueButtons?.(target); } catch {}
      return count;
    },

    queueLength(target) {
      const contextKey = getPiSessionContextKey(target);
      return getQueue(contextKey).length;
    },

    isBusy(target) {
      return runningContexts.has(getPiSessionContextKey(target));
    },
  };
}
