export interface AIChatAction {
  id: string;
  type: 'create_task' | 'update_task' | 'delete_task' | 'create_section' | 'update_section' | 'delete_section' | 'manage_plan';
  params: any;
  requiresConfirmation?: boolean;
  status?: 'pending' | 'executed' | 'failed' | 'cancelled';
  savedTask?: any;
  confirmation?: string;
  error?: string;
}

/**
 * Robust extractor for AI-generated actions from LLM output (handles raw json, code fences, etc.)
 * and strips the ACTIONS block from visible user chat text.
 */
export function extractActionsAndCleanText(rawText: string): { cleanText: string; actions: AIChatAction[] } {
  if (!rawText) return { cleanText: '', actions: [] };

  const actions: AIChatAction[] = [];
  let cleanText = rawText;

  // Patterns for ACTIONS block:
  // 1. ACTIONS: ```json [...] ```
  const codeBlockRegex = /ACTIONS:\s*```(?:json)?\s*([\s\S]*?)```/i;
  // 2. ```(?:json)? ACTIONS: [...] ```
  const wrappedCodeBlockRegex = /```(?:json)?\s*ACTIONS:\s*([\s\S]*?)```/i;
  // 3. ACTIONS:\s*(\[\s*\{[\s\S]*?\}\s*\])
  const plainArrayRegex = /ACTIONS:\s*(\[\s*\{[\s\S]*?\}\s*\])/i;
  // 4. Fallback trailing ACTIONS:
  const generalActionsRegex = /ACTIONS:\s*([\s\S]*)$/i;

  let jsonStr = '';

  const matchA = rawText.match(codeBlockRegex);
  if (matchA) {
    jsonStr = matchA[1].trim();
    cleanText = rawText.replace(codeBlockRegex, '').trim();
  } else {
    const matchB = rawText.match(wrappedCodeBlockRegex);
    if (matchB) {
      jsonStr = matchB[1].trim();
      cleanText = rawText.replace(wrappedCodeBlockRegex, '').trim();
    } else {
      const matchC = rawText.match(plainArrayRegex);
      if (matchC) {
        jsonStr = matchC[1].trim();
        cleanText = rawText.replace(plainArrayRegex, '').trim();
      } else {
        const matchD = rawText.match(generalActionsRegex);
        if (matchD) {
          const candidate = matchD[1].replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
          const arrayMatch = candidate.match(/\[\s*\{[\s\S]*\}\s*\]/);
          if (arrayMatch) {
            jsonStr = arrayMatch[0];
            cleanText = rawText.replace(generalActionsRegex, '').trim();
          }
        }
      }
    }
  }

  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        for (let i = 0; i < parsed.length; i++) {
          const item = parsed[i];
          if (item && item.action) {
            actions.push({
              id: `act_${Date.now()}_${i}`,
              type: item.action,
              params: item.params || {},
              requiresConfirmation:
                item.params?.requiresConfirmation ||
                item.action === 'delete_task' ||
                item.action === 'delete_section',
            });
          }
        }
      }
    } catch (e) {
      console.warn('[Copilot] Could not parse action JSON block:', e);
    }
  }

  // Remove any remaining trailing ACTIONS: label
  cleanText = cleanText.replace(/ACTIONS:\s*$/i, '').trim();

  return { cleanText, actions };
}

/**
 * Deterministic natural-language parser for fallback / offline mode
 * Handles queries and mutations even if no API keys are configured!
 */
export function handleFallbackNaturalLanguage(
  prompt: string,
  context: any
): { content: string; actions: AIChatAction[] } {
  const rawPrompt = prompt.trim();
  const p = rawPrompt.toLowerCase();
  const todayTasks = (context?.todayTasks || []) as any[];
  const sections = (context?.sections || []) as any[];
  const activeTimer = context?.activeTimer;
  const currentDate = context?.currentDate || new Date().toISOString().split('T')[0];
  const budgetHours = context?.focusBudgetHours || context?.dayRecord?.freeHours || 8;
  const timeLogs = (context?.timeLogsToday || []) as any[];

  // 1. "What is my current task?"
  if (p.includes('current task') || p.includes('working on now') || p.includes('what am i doing')) {
    if (activeTimer && activeTimer.isRunning) {
      const elapsedMins = Math.floor((activeTimer.accumulatedMs || 0) / 60000);
      return {
        content: `Your current active task is **"${activeTimer.taskTitle}"** (Timer running for ${elapsedMins}m).`,
        actions: [],
      };
    }
    const currentIncomplete = todayTasks.find(t => !t.isCompleted);
    if (currentIncomplete) {
      return {
        content: `Your next scheduled task today is **"${currentIncomplete.title}"** (${currentIncomplete.startTime ? `${currentIncomplete.startTime} - ${currentIncomplete.endTime}` : `${currentIncomplete.scheduledMinutes || currentIncomplete.estimatedMinutes || 60}m`}, Priority: ${currentIncomplete.priority}).`,
        actions: [],
      };
    }
    return {
      content: `You don't have an active timer running and all tasks for today are complete!`,
      actions: [],
    };
  }

  // 2. "How many tasks are left?" / "Tasks left" / "Unfinished tasks"
  if (p.includes('tasks are left') || p.includes('tasks left') || p.includes('how many tasks') || p.includes('unfinished tasks') || p.includes('remaining tasks')) {
    const incomplete = todayTasks.filter(t => !t.isCompleted);
    if (incomplete.length === 0) {
      return {
        content: `🎉 You have **0 tasks left** today! All ${todayTasks.length} tasks scheduled for today have been completed.`,
        actions: [],
      };
    }
    const taskList = incomplete.map(t => `- **${t.title}** (${t.scheduledMinutes || t.estimatedMinutes || 60}m, ${t.priority})`).join('\n');
    return {
      content: `You have **${incomplete.length} task${incomplete.length > 1 ? 's' : ''} left** today:\n\n${taskList}`,
      actions: [],
    };
  }

  // 3. "What did I complete today?" / "Completed tasks"
  if (p.includes('complete today') || p.includes('completed today') || p.includes('what did i do today') || p.includes('finished today')) {
    const completed = todayTasks.filter(t => t.isCompleted);
    if (completed.length === 0) {
      return {
        content: `You haven't completed any tasks yet today. ${todayTasks.length} task${todayTasks.length === 1 ? ' is' : 's are'} scheduled and waiting for you!`,
        actions: [],
      };
    }
    const taskList = completed.map(t => `- ✅ **${t.title}** (${t.scheduledMinutes || t.estimatedMinutes || 60}m)`).join('\n');
    return {
      content: `Today you have completed **${completed.length} task${completed.length > 1 ? 's' : ''}**:\n\n${taskList}`,
      actions: [],
    };
  }

  // 4. "How is my progress?" / "Progress today"
  if (p.includes('how is my progress') || p.includes('progress today') || p.includes('my progress')) {
    const total = todayTasks.length;
    const completed = todayTasks.filter(t => t.isCompleted).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const loggedMins = timeLogs.reduce((acc: number, l: any) => acc + (l.minutes || 0), 0);
    const budgetMins = budgetHours * 60;

    return {
      content: `### 📊 Your Progress for Today (${currentDate})\n` +
        `- **Task Completion:** **${completed} / ${total} tasks (${percent}%)** completed\n` +
        `- **Focus Time Logged:** **${loggedMins} minutes** out of your **${budgetHours}h** (${budgetMins}m) daily budget\n` +
        `- **Status:** ${percent === 100 ? '🎉 All tasks done!' : percent >= 50 ? '🔥 Great momentum, more than half finished!' : '💪 Keep pushing, you can do this!'}`,
      actions: [],
    };
  }

  // 5. Natural Language Task Creation: "Add task Study Python under Learning..."
  const addMatch = rawPrompt.match(/(?:add|create|schedule)\s+(?:a\s+)?(?:new\s+)?task\s+(?:called\s+|named\s+)?["']?([^"']+)["']?\s*(?:under|in|category)\s+([a-zA-Z0-9\s]+)?/i) ||
                   rawPrompt.match(/(?:add|create|schedule)\s+([^.]+?)\s+under\s+([a-zA-Z0-9\s]+)/i);
  if (addMatch) {
    let title = addMatch[1].trim();
    // Clean trailing duration keywords from title if matched
    title = title.replace(/\s+for\s+\d+\s*(?:hours?|hrs?|minutes?|mins?).*$/i, '').trim();

    let secName = (addMatch[2] || '').trim();
    // Match against known section names first
    const containedSec = sections.find(s => secName.toLowerCase().includes(s.name.toLowerCase()));
    if (containedSec) {
      secName = containedSec.name;
    } else {
      // Clean trailing duration or date keywords from secName if matched
      secName = secName.replace(/\s+(?:for\s+(?:\d+|one|two|three|four|five|half)|tomorrow|today).*$/i, '').trim();
      const matchedSec = sections.find(s => s.name.toLowerCase() === secName.toLowerCase());
      if (matchedSec) secName = matchedSec.name;
    }

    // Check duration mentions like "for two hours" or "for 1 hour"
    let durationMins = 60;
    if (p.includes('two hours') || p.includes('2 hours') || p.includes('2 hrs') || p.includes('2h')) durationMins = 120;
    else if (p.includes('three hours') || p.includes('3 hours') || p.includes('3 hrs') || p.includes('3h')) durationMins = 180;
    else if (p.includes('30 min') || p.includes('half hour')) durationMins = 30;
    else if (p.includes('45 min')) durationMins = 45;
    else if (p.includes('90 min')) durationMins = 90;

    let targetDate = currentDate;
    if (p.includes('tomorrow')) {
      const [y, m, d] = currentDate.split('-').map(Number);
      const tom = new Date(Date.UTC(y, m - 1, d + 1));
      targetDate = tom.toISOString().split('T')[0];
    }

    const priority = p.includes('high priority') || p.includes('urgent') ? 'High' : p.includes('low priority') ? 'Low' : 'Medium';
    const mustDo = p.includes('must do') || p.includes('must-do') || p.includes('top priority');

    return {
      content: `I've prepared to add the task **"${title}"**${secName ? ` under **${secName}**` : ''} scheduled for ${targetDate} (${durationMins} minutes, ${priority} priority).`,
      actions: [
        {
          id: `act_${Date.now()}`,
          type: 'create_task',
          params: {
            title,
            section: secName || (sections[0]?.name || 'Deep Work'),
            date: targetDate,
            scheduledMinutes: durationMins,
            priority,
            mustDo,
            deadline: targetDate,
          },
        },
      ],
    };
  }

  // 6. Natural Language Task Completion: "Mark my Python task as completed"
  const completeMatch = rawPrompt.match(/(?:mark|set)\s+(?:task\s+)?["']?([^"']+)["']?\s+as\s+(?:completed|done)/i) ||
                        rawPrompt.match(/(?:mark\s+completed|complete)\s+(?:task\s+)?["']?([^"']+)/i);
  if (completeMatch) {
    let targetQuery = completeMatch[1].trim();
    if (targetQuery.toLowerCase().includes('current task') && activeTimer) {
      targetQuery = activeTimer.taskTitle;
    } else if (targetQuery.toLowerCase().includes('current task')) {
      const firstIncomp = todayTasks.find(t => !t.isCompleted);
      if (firstIncomp) targetQuery = firstIncomp.title;
    }

    const matchedTask = todayTasks.find(t => t.title.toLowerCase() === targetQuery.toLowerCase());
    if (matchedTask) targetQuery = matchedTask.title;

    return {
      content: `I will mark **"${targetQuery}"** as completed.`,
      actions: [
        {
          id: `act_${Date.now()}`,
          type: 'update_task',
          params: {
            taskIdentifier: targetQuery,
            updates: {
              isCompleted: true,
              status: 'completed',
            },
          },
        },
      ],
    };
  }

  // 7. Natural Language Task Move / Reschedule: "Move my Python task to tomorrow"
  const moveMatch = p.match(/(?:move|reschedule)\s+(?:task\s+)?["']?([^"']+)["']?\s+to\s+(tomorrow|today|\d{4}-\d{2}-\d{2})/i);
  if (moveMatch) {
    const targetQuery = moveMatch[1].trim();
    const dest = moveMatch[2].trim();
    let destDate = currentDate;
    if (dest === 'tomorrow') {
      const [y, m, d] = currentDate.split('-').map(Number);
      const tom = new Date(Date.UTC(y, m - 1, d + 1));
      destDate = tom.toISOString().split('T')[0];
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dest)) {
      destDate = dest;
    }

    return {
      content: `I will move **"${targetQuery}"** to ${destDate}.`,
      actions: [
        {
          id: `act_${Date.now()}`,
          type: 'update_task',
          params: {
            taskIdentifier: targetQuery,
            updates: {
              date: destDate,
            },
          },
        },
      ],
    };
  }

  // 8. Natural Language Task Deletion: "Delete the task about video editing"
  const deleteMatch = p.match(/(?:delete|remove)\s+(?:the\s+)?(?:task\s+)?(?:called\s+|named\s+|about\s+)?["']?([^"']+)["']?/i);
  if (deleteMatch) {
    const targetQuery = deleteMatch[1].trim().replace(/\.$/, '');
    return {
      content: `I found the request to delete task matching **"${targetQuery}"**. Because deleting a task is permanent, please confirm below to execute this action.`,
      actions: [
        {
          id: `act_${Date.now()}`,
          type: 'delete_task',
          requiresConfirmation: true,
          params: {
            taskIdentifier: targetQuery,
            taskTitle: targetQuery,
          },
        },
      ],
    };
  }

  // 9. Change focus budget: "Change my deep work duration to three hours"
  const budgetMatch = p.match(/(?:change|set)\s+(?:my\s+)?(?:deep\s+work|focus\s+budget)\s+(?:duration\s+)?to\s+(\d+)\s*hours?/i);
  if (budgetMatch) {
    const hours = parseInt(budgetMatch[1], 10);
    return {
      content: `I will update your daily focus budget for today to **${hours} hours**.`,
      actions: [
        {
          id: `act_${Date.now()}`,
          type: 'manage_plan',
          params: {
            planType: 'day',
            date: currentDate,
            updates: { freeHours: hours },
          },
        },
      ],
    };
  }

  // Default conversational answer
  return {
    content: `I'm your NightPlanner Copilot! I have full access to your tasks, categories, and plans. You can ask me:\n` +
      `- *"What is my current task?"*\n` +
      `- *"How many tasks are left?"*\n` +
      `- *"What did I complete today?"*\n` +
      `- *"How is my progress?"*\n` +
      `- *"Add a task called Study Python under Learning for tomorrow"* (or mark complete / delete / reschedule).`,
    actions: [],
  };
}
