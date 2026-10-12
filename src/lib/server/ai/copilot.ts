export interface AIChatAction {
  id: string;
  type:
    | 'create_task'
    | 'update_task'
    | 'delete_task'
    | 'delete_all_tasks'
    | 'create_section'
    | 'update_section'
    | 'delete_section'
    | 'manage_plan'
    | 'start_timer'
    | 'pause_timer'
    | 'stop_timer'
    | 'navigate';
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
                item.action === 'delete_all_tasks' ||
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

  // 6. Bulk Delete: "Delete all my tasks for today" or "Delete all tasks"
  if (p.includes('delete all') && (p.includes('tasks') || p.includes('today'))) {
    return {
      content: `⚠️ **Warning: High-Impact Action**\nYou have requested to delete all tasks scheduled for ${currentDate} (${todayTasks.length} task${todayTasks.length === 1 ? '' : 's'}). Because this is permanent, please review and confirm below.`,
      actions: [
        {
          id: `act_${Date.now()}`,
          type: 'delete_all_tasks',
          requiresConfirmation: true,
          params: {
            date: currentDate,
            taskCount: todayTasks.length,
          },
        },
      ],
    };
  }

  // 7. Natural Language Task Completion: "Mark my Python task as completed" or "Mark all completed tasks as done"
  if (p.includes('mark all') && (p.includes('done') || p.includes('completed'))) {
    return {
      content: `I've prepared to mark all ${todayTasks.filter(t => !t.isCompleted).length} remaining tasks for today as completed.`,
      actions: todayTasks.filter(t => !t.isCompleted).map((t, idx) => ({
        id: `act_${Date.now()}_${idx}`,
        type: 'update_task',
        params: {
          taskIdentifier: t.id,
          updates: { isCompleted: true, status: 'completed' },
        },
      })),
    };
  }

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

  // 8. Change focus budget: "Change my deep work duration to 4 hours" or "Change my deep work daily budget to 6 hours"
  const budgetMatch = p.match(/(?:change|set|update)\s+(?:my\s+)?(?:deep\s+work|focus\s+budget|daily\s+budget)\s+(?:duration\s+|daily\s+budget\s+)?to\s+(\d+)\s*hours?/i);
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

  // 9. Update time range: "Update my task from 2 PM to 4 PM" or "Update task X from 14:00 to 16:00"
  const timeUpdateMatch = rawPrompt.match(/(?:update|move|reschedule|change)\s+(?:my\s+)?(?:task\s+)?(?:named\s+|called\s+)?["']?([^"']*?)["']?\s*(?:from\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|-)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (timeUpdateMatch) {
    const taskQuery = timeUpdateMatch[1].trim() || (todayTasks[0]?.title || 'current task');
    const parseTime = (tStr: string): string => {
      let raw = tStr.trim().toLowerCase();
      const isPm = raw.includes('pm');
      const isAm = raw.includes('am');
      raw = raw.replace(/[apm\s]/g, '');
      let [h, m] = raw.includes(':') ? raw.split(':').map(Number) : [Number(raw), 0];
      if (isPm && h < 12) h += 12;
      if (isAm && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
    };

    const startTime = parseTime(timeUpdateMatch[2]);
    const endTime = parseTime(timeUpdateMatch[3]);
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const scheduledMinutes = Math.max(15, (eh * 60 + em) - (sh * 60 + sm));

    return {
      content: `I will update **"${taskQuery}"** to run from **${startTime}** to **${endTime}** (${scheduledMinutes} minutes).`,
      actions: [
        {
          id: `act_${Date.now()}`,
          type: 'update_task',
          params: {
            taskIdentifier: taskQuery,
            updates: { startTime, endTime, scheduledMinutes },
          },
        },
      ],
    };
  }

  // 9. Move / Reschedule Task: "Move my Python task to tomorrow"
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

  // 10. Delete Task: "Delete the task named Video Editing"
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

  // 11. Timer Controls: "Start the timer for 45 minutes", "Open the timer", "Pause the timer", "Close the timer"
  if (p.includes('timer')) {
    if (p.includes('pause')) {
      return {
        content: `I have paused the active focus timer.`,
        actions: [{ id: `act_${Date.now()}`, type: 'pause_timer', params: {} }],
      };
    }
    if (p.includes('close') || p.includes('stop')) {
      return {
        content: `I have stopped and saved progress for the current timer.`,
        actions: [{ id: `act_${Date.now()}`, type: 'stop_timer', params: {} }],
      };
    }
    if (p.includes('start') || p.includes('open')) {
      let durationMins = 25;
      const durMatch = p.match(/(\d+)\s*(?:minutes?|mins?|m)/);
      if (durMatch) durationMins = parseInt(durMatch[1], 10);
      const targetTask = todayTasks.find(t => !t.isCompleted) || todayTasks[0];
      return {
        content: `Opening the timer and starting a **${durationMins}-minute focus session** for "${targetTask?.title || 'Focus Task'}".`,
        actions: [
          {
            id: `act_${Date.now()}`,
            type: 'start_timer',
            params: {
              taskId: targetTask?.id || 'timer-default',
              taskTitle: targetTask?.title || 'Focus Task',
              minutes: durationMins,
            },
          },
        ],
      };
    }
  }

  // 12. Create Category: "Create a new category called Content Creation"
  const catMatch = rawPrompt.match(/(?:create|add)\s+(?:a\s+)?(?:new\s+)?(?:category|section)\s+(?:called\s+|named\s+)?["']?([^"']+)["']?/i);
  if (catMatch) {
    const catName = catMatch[1].trim();
    return {
      content: `I will create a new category called **"${catName}"**.`,
      actions: [
        {
          id: `act_${Date.now()}`,
          type: 'create_section',
          params: {
            name: catName,
            color: '#8b5cf6',
            icon: '🎨',
          },
        },
      ],
    };
  }

  // 13. Navigation: "Navigate to my weekly progress", "Open my academic category"
  if (p.includes('navigate') || p.includes('go to') || p.includes('open my') || p.includes('show my')) {
    if (p.includes('week') || p.includes('weekly')) {
      return {
        content: `Navigating to your **Weekly Plan & Progress**.`,
        actions: [{ id: `act_${Date.now()}`, type: 'navigate', params: { tab: 'week' } }],
      };
    }
    if (p.includes('month') || p.includes('monthly')) {
      return {
        content: `Navigating to your **Monthly Plan**.`,
        actions: [{ id: `act_${Date.now()}`, type: 'navigate', params: { tab: 'month' } }],
      };
    }
    if (p.includes('analytics') || p.includes('stats')) {
      return {
        content: `Navigating to your **Analytics & Metrics**.`,
        actions: [{ id: `act_${Date.now()}`, type: 'navigate', params: { tab: 'analytics' } }],
      };
    }
    if (p.includes('category') || p.includes('categories') || p.includes('academic')) {
      return {
        content: `Opening the **Categories view**.`,
        actions: [{ id: `act_${Date.now()}`, type: 'navigate', params: { tab: 'category' } }],
      };
    }
  }

  // 14. Explain offline sync: "Explain how offline synchronization works"
  if (p.includes('offline') && (p.includes('sync') || p.includes('how') || p.includes('work'))) {
    return {
      content: `### 🔄 How Offline Synchronization Works in NightPlanner\n\n1. **Local-First Speed (Dexie IndexedDB):** Every change you make (creating, completing, editing, or deleting tasks) is committed instantly to your browser's IndexedDB. You can plan, start timers, and edit without internet connection.\n2. **State Tracking (\`synced: 0\`):** Unsynced changes are flagged with an update epoch timestamp and queued.\n3. **Deterministic Cloud Sync (Neon PostgreSQL):** When internet connectivity is detected, NightPlanner batches your unsynced changes to the server. The server uses a monotonic sequence counter and 'latest timestamp wins' conflict resolution to ensure multi-device consistency without data loss.\n4. **Zero Lock-In:** Even if the server is offline or restarting, you can continue working smoothly.`,
      actions: [],
    };
  }

  // 15. Schedule Reorganization: "Help me reorganize today's schedule without exceeding my available hours"
  if (p.includes('reorganize') || p.includes('conflict') || p.includes('budget') || p.includes('available hours')) {
    const totalMins = todayTasks.reduce((acc: number, t: any) => acc + (t.scheduledMinutes || t.estimatedMinutes || 60), 0);
    const budgetMins = budgetHours * 60;
    const diff = totalMins - budgetMins;

    return {
      content: `### 🗓️ Schedule & Focus Budget Analysis (${currentDate})\n\n` +
        `- **Total Scheduled:** **${Math.round(totalMins / 60 * 10) / 10} hours** (${totalMins} mins across ${todayTasks.length} tasks)\n` +
        `- **Daily Available Budget:** **${budgetHours} hours** (${budgetMins} mins)\n` +
        `- **Budget Status:** ${diff > 0 ? `⚠️ **Overallocated by ${Math.round(diff / 60 * 10) / 10} hours**. Consider moving non-essential tasks to tomorrow.` : `✅ **Within Budget**: You have ${Math.round(-diff / 60 * 10) / 10} hours of breathing room remaining.`}\n\n` +
        `**Recommendation:** Focus on your Top 3 Must-Do priorities first, schedule high-leverage deep work blocks before lunch, and defer low-priority items.`,
      actions: [],
    };
  }

  // Default conversational answer
  return {
    content: `Hello! I'm **Sam’s AI**, your NightPlanner assistant. I have full authorized access to your schedule, tasks, categories, and timers.\n\nYou can ask me live questions like:\n` +
      `- *"What tasks do I still have today?"*\n` +
      `- *"How much time do I have left?"*\n` +
      `- *"Summarize my progress this week"* or *"What did I complete today?"*\n` +
      `- *"Explain how offline synchronization works"*\n\n` +
      `Or command me directly:\n` +
      `- *"Add a task called Study Python under Learning for two hours"*\n` +
      `- *"Update my task from 2 PM to 4 PM"*\n` +
      `- *"Start the timer for 45 minutes"*\n` +
      `- *"Create a new category called Content Creation"*\n` +
      `- *"Delete the task named Video Editing"* or *"Delete all my tasks for today"*.`,
    actions: [],
  };
}
