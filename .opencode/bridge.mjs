import { append, entry } from '../plugins/serio-focus/scripts/audit.mjs';
import { Blocked, judge, reasonOf } from '../plugins/serio-focus/scripts/guard.mjs';
import { rootOf } from '../plugins/serio-focus/scripts/lib/runtime.mjs';

const NAMES = { bash: 'Bash', powershell: 'PowerShell', agent: 'Agent', task: 'Task', spawn_agent: 'spawn_agent' };

export function verdictFor(tool, args, sessionID, cwd = process.cwd()) {
  const key = String(tool || '').toLowerCase();
  const payload = {
    hook_event_name: 'PreToolUse', session_id: String(sessionID || 'unknown'), cwd,
    tool_name: NAMES[key] || String(tool || ''),
    tool_input: args && typeof args === 'object' ? args : {},
  };
  try {
    judge(payload);
    return null;
  } catch (error) {
    if (!(error instanceof Blocked)) throw error;
    const reason = reasonOf(error, 'deny');
    append(rootOf(payload), entry(payload, reason, 'deny'));
    return reason;
  }
}
