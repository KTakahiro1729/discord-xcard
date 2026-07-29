export interface Env {
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  MAX_VC_MEMBERS?: string;
  X_CARD_AUTO_UNMUTE_SECONDS?: string;
}

export interface DiscordUser {
  id: string;
}

export interface DiscordMember {
  user: DiscordUser;
  permissions?: string;
  roles?: string[];
}

export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: DiscordMember;
  data?: {
    name?: string;
    custom_id?: string;
    component_type?: number;
    values?: string[];
  };
}

export interface VoiceState {
  user_id: string;
  channel_id: string | null;
  mute?: boolean;
}

export interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

export interface GuildCreateData {
  id: string;
  voice_states?: VoiceState[];
}

export interface VoiceSnapshot {
  channelId: string;
  memberIds: string[];
  memberIdsToMute: string[];
}

export interface SendMessageResult {
  ok: boolean;
  status: number;
  code?: number;
  errorPath?: string;
}

export interface MuteResult {
  attempted: number;
  succeeded: number;
  failed: number;
  succeededMemberIds: string[];
}

export interface AutoUnmutePayload {
  guildId: string;
  memberIds: string[];
  issuedAt: number;
}

export interface GuildRole {
  id: string;
  name: string;
  permissions: string;
  position: number;
  managed: boolean;
}

export type BotReadinessProblem =
  | "missing_mute_permission"
  | "role_too_low"
  | "bot_user_fetch_failed"
  | "roles_fetch_failed"
  | "bot_member_fetch_failed"
  | "invalid_discord_response"
  | "discord_api_unreachable";

export interface BotReadiness {
  ready: boolean;
  problems: BotReadinessProblem[];
}
