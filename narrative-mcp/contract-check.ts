/** Check de contrato en COMPILE-TIME: los unions reexportados por protocol.ts
 *  deben ser idénticos a los del contrato de microservicios
 *  (@nefan/core/contracts/narrative-mcp-ws). Hoy protocol.ts es un reexport y
 *  esto es trivialmente verde; su razón de ser es detener a quien re-forkee
 *  protocol.ts con tipos propios en el futuro. Vive aquí (y no en
 *  nefan-core/test/) porque los tests de nefan-core corren con tsx sin
 *  typecheck — este fichero lo compila SIEMPRE el `tsc -b` de narrative-mcp. */
import type { ClientMsg, PeerMsg, RequestMsg, ServerMsg } from './protocol.js';
import type {
  AiToMcpMsg,
  McpPeerMsg,
  McpRequestMsg,
  McpToAiMsg,
} from '@nefan/core/contracts/narrative-mcp-ws';

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

export type _CheckClientMsg = Expect<Equal<ClientMsg, AiToMcpMsg>>;
export type _CheckRequestMsg = Expect<Equal<RequestMsg, McpRequestMsg>>;
export type _CheckServerMsg = Expect<Equal<ServerMsg, McpToAiMsg>>;
export type _CheckPeerMsg = Expect<Equal<PeerMsg, McpPeerMsg>>;
