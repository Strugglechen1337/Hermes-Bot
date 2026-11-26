/**
 * Shared TypeScript contracts aligned with Hermes Agent v0.23.4 REST + WebSocket JSON-RPC API.
 */

export interface HermesStatusResponse {
  version: string;
  release_date?: string;
  gateway_running: boolean;
  gateway_state?: string;
  auth_required: boolean;
  auth_providers: string[];
  auth_flows?: string[];
  overall?: string;
  components?: Record<string, { status: string; state?: string; [k: string]: unknown }>;
}

export interface HermesAuthUser {
  user_id: string;
  email: string;
  display_name: string;
  org_id: string;
  provider: string;
  expires_at: number;
}

export interface HermesProfile {
  name: string;
  path?: string;
  is_default: boolean;
  model: string | null;
  provider: string | null;
  has_env: boolean;
  skill_count: number;
  gateway_running: boolean;
  description: string;
  description_auto?: boolean;
  display_name: string;
  bot_title: string;
  ui_meta?: Record<string, unknown>;
  has_alias?: boolean;
}

export interface HermesSessionSummary {
  id: string;
  session_id?: string;
  title?: string | null;
  profile?: string | null;
  model?: string | null;
  source?: string | null;
  message_count?: number;
  started_at?: number | string | null;
  last_active?: number | string | null;
  ended_at?: number | string | null;
  preview?: string | null;
}

export interface HermesChatAttachmentPreview {
  name: string;
  isImage: boolean;
  previewUrl?: string;
}

export interface HermesChatMessage {
  id?: string | number;
  row_id?: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  reasoning?: string | null;
  tool_name?: string | null;
  timestamp?: number | string | null;
  display_kind?: string | null;
  streaming?: boolean;
  error?: string | null;
  attachments?: HermesChatAttachmentPreview[];
}

export interface HermesRoomMember {
  member_id?: string | null;
  profile?: string | null;
  handle?: string | null;
  display_name?: string | null;
  target?: Record<string, unknown> | null;
}

export interface HermesRoomActor {
  kind: string;
  id: string;
  profile?: string | null;
  display_name?: string | null;
  connection_id?: string | null;
}

export interface HermesRoomEvent {
  room_id: string;
  seq: number;
  event_id: string;
  kind: string;
  actor: HermesRoomActor;
  authority_epoch?: number | null;
  payload: Record<string, unknown>;
  created_at: number;
  idempotent?: boolean;
}

export interface HermesRoom {
  room_id: string;
  name: string;
  members: HermesRoomMember[];
  authority_gateway_id: string;
  authority_epoch: number;
  revision: number;
  created_at: number;
  updated_at: number;
  disbanded_at?: number | null;
  latest_seq?: number | null;
}

export interface HermesRoomMemberActivity {
  member_id: string;
  profile?: string | null;
  status: "queued" | "running" | "stopping" | string;
  thread_id?: string | null;
  round_index?: number | null;
  started_at?: number | null;
  tool?: string | null;
  progress_at?: number | null;
}

export interface HermesRoomContext {
  purpose?: string;
  notes?: string;
  routing?: "everyone" | "lead" | "auto";
  lead_member_id?: string | null;
}

export interface HermesRoomState {
  room: HermesRoom;
  latest_seq?: number;
  activities?: HermesRoomMemberActivity[];
  active_members?: HermesRoomMemberActivity[];
  context?: HermesRoomContext | null;
  driver_running?: boolean;
  [k: string]: unknown;
}

export interface HermesGroupsCapabilities {
  protocol_version: number;
  driver: boolean;
  persistent_process: boolean;
  authority_gateway_id: string;
  features: string[];
  methods: string[];
  max_log_limit: number;
  seatable_profiles?: string[] | null;
}

export interface HermesCronJob {
  id: string;
  profile?: string | null;
  profile_name?: string | null;
  is_default_profile?: boolean;
  name?: string | null;
  prompt?: string | null;
  script?: string | null;
  skills?: string[] | null;
  schedule?: { kind?: string; expr?: string; run_at?: string; display?: string };
  schedule_display?: string | null;
  repeat?: { times: number | null; completed?: number } | null;
  enabled: boolean;
  state?: string | null;
  deliver?: string | null;
  model?: string | null;
  provider?: string | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  timezone?: string | null;
}

export interface HermesCronRun {
  id?: string;
  run_id?: string;
  job_id?: string;
  started_at?: string | number | null;
  finished_at?: string | number | null;
  completed_at?: string | number | null;
  status?: string | null;
  outcome?: string | null;
  error?: string | null;
  summary?: string | null;
  output?: string | null;
  duration_ms?: number | null;
}

export interface HermesMessagingEnvVar {
  key: string;
  required: boolean;
  is_set: boolean;
  redacted_value: string | null;
  description: string;
  prompt: string;
  help: string;
  url: string | null;
  is_password: boolean;
  is_list?: boolean;
  value?: string | null;
  advanced: boolean;
}

export interface HermesMessagingPlatform {
  id: string;
  name: string;
  description: string;
  docs_url?: string;
  enabled: boolean;
  configured: boolean;
  gateway_running: boolean;
  state: string;
  error_code: string | null;
  error_message: string | null;
  updated_at: string | null;
  home_channel: { platform: string; chat_id: string; name: string; thread_id?: string } | null;
  env_vars: HermesMessagingEnvVar[];
}

export interface HermesPendingApproval {
  id?: string;
  approval_id?: string;
  prompt_id?: string;
  request_id?: string;
  tool_name?: string;
  command?: string;
  description?: string;
  reason?: string;
  choices?: string[];
  execution_generation?: number;
  [k: string]: unknown;
}

export interface HermesConnectorRow {
  connector: string;
  enabled: boolean;
  connected: boolean;
  connection_status: "pending" | "active" | "failed" | "expired" | "revoked" | "inactive" | null;
  status_reason: string | null;
  gateway_disabled_tools?: string[];
}

export interface HermesConnectorCatalogRow {
  slug: string;
  name: string;
  description: string;
  category: string;
  logo_url?: string | null;
}

export interface HermesConnectorAccount {
  connection_id: string;
  connector: string;
  status: string;
  status_reason?: string | null;
  label: string;
  alias?: string | null;
  active: boolean;
  disabled?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface HermesConnectionTargetEnvField {
  name: string;
  required: boolean;
  secret: boolean;
  default?: string;
  prompt?: string | null;
}

export interface HermesConnectionTarget {
  name: string;
  kind?: string;
  action?: string;
  state: string;
  resolved?: boolean | null;
  detail?: string | null;
  instructions?: string | null;
  discovery_error?: string | null;
  connect_url?: string | null;
  connection_id?: string | null;
  alias?: string | null;
  display?: string | null;
  description?: string | null;
  required_env?: HermesConnectionTargetEnvField[] | null;
}

export interface HermesConnectionRequest {
  op_id: string;
  seq?: number;
  deadline_at?: number;
  targets: HermesConnectionTarget[];
  settled?: boolean;
}

export interface HermesServerRequest {
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}

export interface HermesMcpServer {
  name: string;
  enabled?: boolean;
  transport?: string;
  url?: string | null;
  command?: string | null;
  connected?: boolean;
  status?: string | null;
  tool_count?: number | null;
  error?: string | null;
  auth_type?: string | null;
  oauth_supported?: boolean;
  source?: string | null;
  [k: string]: unknown;
}

export interface HermesMcpCatalogEntry {
  name: string;
  display_name?: string;
  title?: string;
  description?: string;
  category?: string;
  installed?: boolean;
  enabled?: boolean;
  auth_type?: string;
  [k: string]: unknown;
}

export interface HermesModelOptionProvider {
  slug: string;
  name: string;
  models: string[];
  featured_models?: string[] | null;
  total_models?: number | null;
  is_current?: boolean | null;
  authenticated?: boolean | null;
  warning?: string | null;
  unavailable_models?: string[] | null;
}

export interface HermesModelOptionsResponse {
  providers: HermesModelOptionProvider[];
  model: string;
  provider: string;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcEventFrame {
  jsonrpc: "2.0";
  method: "event";
  params: {
    type: string;
    payload?: Record<string, unknown>;
    session_id?: string;
    seq?: number;
  };
}
