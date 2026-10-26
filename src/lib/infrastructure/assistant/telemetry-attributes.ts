/**
 * Span attribute names used by the assistant telemetry mapper.
 *
 * GenAI names are still incubating in @opentelemetry/semantic-conventions (1.43.0 ships them
 * only from the `incubating` entry, which may break in minor releases), so they are copied
 * here as the OpenTelemetry JS docs recommend. Stable names (service.name, error.type,
 * db.query.text, db.system.name) are imported from the package where they are used.
 *
 * Langfuse names follow https://langfuse.com/integrations/native/opentelemetry (checked 2026-10-25).
 */

// GenAI semantic conventions
export const ATTR_GEN_AI_OPERATION_NAME = 'gen_ai.operation.name';
export const ATTR_GEN_AI_PROVIDER_NAME = 'gen_ai.provider.name';
export const ATTR_GEN_AI_AGENT_NAME = 'gen_ai.agent.name';
export const ATTR_GEN_AI_CONVERSATION_ID = 'gen_ai.conversation.id';
export const ATTR_GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
export const ATTR_GEN_AI_RESPONSE_FINISH_REASONS = 'gen_ai.response.finish_reasons';
export const ATTR_GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
export const ATTR_GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
export const ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS = 'gen_ai.usage.cache_read.input_tokens';
export const ATTR_GEN_AI_TOOL_NAME = 'gen_ai.tool.name';
export const ATTR_GEN_AI_TOOL_CALL_ID = 'gen_ai.tool.call.id';
export const ATTR_GEN_AI_TOOL_TYPE = 'gen_ai.tool.type';
export const ATTR_GEN_AI_TOOL_CALL_ARGUMENTS = 'gen_ai.tool.call.arguments';
export const ATTR_GEN_AI_TOOL_CALL_RESULT = 'gen_ai.tool.call.result';

export const GEN_AI_OPERATION_INVOKE_AGENT = 'invoke_agent';
export const GEN_AI_OPERATION_CHAT = 'chat';
export const GEN_AI_OPERATION_EXECUTE_TOOL = 'execute_tool';

// General (incubating) conventions
export const ATTR_USER_ID = 'user.id';
export const ATTR_SESSION_ID = 'session.id';

// Langfuse
export const ATTR_LANGFUSE_SESSION_ID = 'langfuse.session.id';
export const ATTR_LANGFUSE_USER_ID = 'langfuse.user.id';
export const ATTR_LANGFUSE_TRACE_NAME = 'langfuse.trace.name';
export const ATTR_LANGFUSE_TRACE_TAGS = 'langfuse.trace.tags';
export const ATTR_LANGFUSE_TRACE_INPUT = 'langfuse.trace.input';
export const ATTR_LANGFUSE_TRACE_OUTPUT = 'langfuse.trace.output';
export const ATTR_LANGFUSE_OBSERVATION_TYPE = 'langfuse.observation.type';
export const ATTR_LANGFUSE_OBSERVATION_INPUT = 'langfuse.observation.input';
export const ATTR_LANGFUSE_OBSERVATION_OUTPUT = 'langfuse.observation.output';
export const ATTR_LANGFUSE_OBSERVATION_LEVEL = 'langfuse.observation.level';
export const ATTR_LANGFUSE_OBSERVATION_STATUS_MESSAGE = 'langfuse.observation.status_message';
export const ATTR_LANGFUSE_OBSERVATION_COST_DETAILS = 'langfuse.observation.cost_details';

// Rucio WebUI specific
export const ATTR_RUCIO_TURN_ID = 'rucio.assistant.turn.id';
export const ATTR_RUCIO_TURN_STATUS = 'rucio.assistant.turn.status';
export const ATTR_RUCIO_MODEL = 'rucio.assistant.model';
export const ATTR_RUCIO_INPUT_TOKENS = 'rucio.assistant.usage.input_tokens';
export const ATTR_RUCIO_OUTPUT_TOKENS = 'rucio.assistant.usage.output_tokens';
export const ATTR_RUCIO_CACHED_INPUT_TOKENS = 'rucio.assistant.usage.cached_input_tokens';
export const ATTR_RUCIO_COST_USD = 'rucio.assistant.cost_usd';
export const ATTR_RUCIO_DURATION_MS = 'rucio.assistant.duration_ms';
export const ATTR_RUCIO_TOOL_POLICY = 'rucio.assistant.tool.policy';
export const ATTR_RUCIO_APPROVAL_DECISION = 'rucio.assistant.approval.decision';
export const ATTR_RUCIO_APPROVAL_SCOPE = 'rucio.assistant.approval.scope';
export const ATTR_RUCIO_APPROVAL_APPROVER = 'rucio.assistant.approval.approver';
export const ATTR_RUCIO_SQL_TOTAL_ROWS = 'rucio.assistant.sql.total_rows';
export const ATTR_RUCIO_SKILL_NAME = 'rucio.assistant.skill.name';
export const ATTR_RUCIO_SKILL_SOURCE = 'rucio.assistant.skill.source';
export const ATTR_RUCIO_COMPACTION_UP_TO = 'rucio.assistant.compaction.up_to_message_id';
export const ATTR_RUCIO_CONTENT_LEVEL = 'rucio.assistant.telemetry.content_level';
