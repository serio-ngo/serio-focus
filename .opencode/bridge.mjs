import { append, entry } from '../plugins/serio-focus/scripts/audit.mjs';
import { Blocked, judge } from '../plugins/serio-focus/scripts/guard.mjs';
import { rootOf } from '../plugins/serio-focus/scripts/lib/runtime.mjs';

export function verdictFor(tool, args, sessionID, cwd = process.cwd()) {
  const payload = {
    hook_event_name: 'PreToolUse', session_id: String(sessionID || 'unknown'), cwd,
    tool_name: String(tool || '').toLowerCase() === 'bash' ? 'Bash' : String(tool || ''),
    tool_input: args && typeof args === 'object' ? args : {},
  };
  try {
    judge(payload);
    return null;
  } catch (error) {
    if (!(error instanceof Blocked)) throw error;
    append(rootOf(payload), entry(payload, error.message));
    return error.message;
  }
}
