/** Catalog of study log event types (SPEC §14.2). */
export type LogEventType =
  | 'session_start' | 'resume' | 'code_rebound' | 'task_start' | 'task_pass' | 'task_timeout' | 'task_skip' | 'session_end'
  | 'program_snapshot' | 'block_event' | 'code_edit' | 'editor_preview_toggle'
  | 'jog' | 'handguide_start' | 'handguide_end' | 'target_teach' | 'target_rename' | 'target_delete' | 'target_goto' | 'gripper_manual'
  | 'run_start' | 'run_pause' | 'run_resume' | 'run_step' | 'run_stop' | 'run_fault' | 'run_end' | 'scene_reset'
  | 'agent_user_msg' | 'agent_model_msg' | 'agent_tool_call' | 'agent_proposal' | 'agent_proposal_decision' | 'agent_error'
  | 'agent_visual' | 'agent_plan' | 'plan_step_done' | 'preview_play' | 'tour_start' | 'tour_step' | 'tour_end'
  | 'focus' | 'blur' | 'panel_toggle' | 'camera_move' | 'idle_start' | 'idle_end' | 'help_open' | 'speed_change' | 'arm_change';

export interface LogEvent {
  seq: number;
  t: number;
  sessionId: string;
  taskId?: string;
  taskIndex?: number;
  simTime?: number;
  type: LogEventType;
  data?: Record<string, unknown>;
}
