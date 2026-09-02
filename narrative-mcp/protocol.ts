// WebSocket protocol between narrative-mcp and Python AI server.
//
// F0: la FUENTE vive en los contratos de microservicios
// (@nefan/core/contracts/narrative-mcp-ws) — este módulo es un reexport de
// compatibilidad con los nombres históricos de este paquete. Ojo: `ServerMsg`
// se ENSANCHA deliberadamente respecto al union histórico — incluye
// `NarrativeProgressMsg`, que el wire real siempre emitió (sendProgress) pero
// el union original omitía.
export type {
  RoomRequestMsg,
  VisionImage,
  VisionRequestMsg,
  NarrativeEventMsg,
  HelloMsg,
  RoomResponseMsg,
  VisionResponseMsg,
  NarrativeEventResponseMsg,
  NarrativeProgressMsg,
  TakeoverMsg,
  AiToMcpMsg as ClientMsg,
  McpRequestMsg as RequestMsg,
  McpToAiMsg as ServerMsg,
  McpPeerMsg as PeerMsg,
} from '@nefan/core/contracts/narrative-mcp-ws';
