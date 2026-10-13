// SPDX-License-Identifier: AGPL-3.0-or-later
export {
  answerOf,
  createHandoffRequest,
  HANDOFF,
  HandoffError,
  type HandoffErrorCode,
  type HandoffPayload,
  type HandoffRequest,
  isReturnLink,
} from './receiver';
export {
  type ParsedRequest,
  parseHandoffRequest,
  sealHandoffResponse,
} from './sender';
