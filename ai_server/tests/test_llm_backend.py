"""El backend del LLMClient se ELIGE con `NEFAN_LLM_MCP_URL`, no se descubre (#235).

Hasta esta variable, `LLMClient.__init__` abría SIEMPRE el WebSocket contra el
puerto del motor narrativo si `websocket-client` estaba instalado: en una máquina
con varios agentes, un ai_server de banco se enganchaba al terminal de Claude
Code de OTRO y le mandaba la petición. El guion
`qa/el-npc-cruza-ai-server-con-role-y-description.mjs` arranca el ai_server
real con `off`, y esto es lo que garantiza que ese `off` apaga el canal.

Ejecutar con: NEFAN_SPEND_DIR=$(mktemp -d) python3 -m unittest discover -s ai_server/tests -v
"""

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import llm_client  # noqa: E402
from llm_client import (  # noqa: E402
    ENV_MCP_URL,
    HAS_ANTHROPIC,
    MCP_WS_URL_POR_DEFECTO,
    LLMClient,
    mcp_ws_url_desde_entorno,
)


class ResolverDeLaVariable(unittest.TestCase):
    def test_sin_variable_o_en_blanco_es_el_canal_de_siempre(self):
        self.assertEqual(mcp_ws_url_desde_entorno({}), MCP_WS_URL_POR_DEFECTO)
        self.assertEqual(mcp_ws_url_desde_entorno({ENV_MCP_URL: ""}), MCP_WS_URL_POR_DEFECTO)
        self.assertEqual(mcp_ws_url_desde_entorno({ENV_MCP_URL: "   "}), MCP_WS_URL_POR_DEFECTO)

    def test_off_apaga_el_canal_sin_distinguir_mayusculas(self):
        for valor in ("off", "OFF", " Off "):
            self.assertIsNone(mcp_ws_url_desde_entorno({ENV_MCP_URL: valor}), valor)

    def test_una_url_ws_se_respeta_tal_cual(self):
        self.assertEqual(mcp_ws_url_desde_entorno({ENV_MCP_URL: "ws://10.0.0.7:4000"}), "ws://10.0.0.7:4000")
        self.assertEqual(mcp_ws_url_desde_entorno({ENV_MCP_URL: "wss://motor.local/ws"}), "wss://motor.local/ws")

    def test_cualquier_otra_cosa_lanza_en_vez_de_degradar_al_canal_de_siempre(self):
        for valor in ("http://127.0.0.1:1", "on", "3737", "false"):
            with self.assertRaises(ValueError, msg=valor) as ctx:
                mcp_ws_url_desde_entorno({ENV_MCP_URL: valor})
            self.assertIn(ENV_MCP_URL, str(ctx.exception))


class ClienteConElCanalApagado(unittest.TestCase):
    """Con `mcp_ws_url=None` no se construye ningún `WebSocketApp`: ni hilo de
    `run_forever`, ni reintentos cada 5 s, ni conexión a nadie."""

    def test_no_abre_websocket_aunque_la_libreria_este_instalada(self):
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": ""}):
            with mock.patch.object(llm_client, "HAS_WEBSOCKET", True):
                with mock.patch.object(LLMClient, "_try_connect_mcp") as conectar:
                    cliente = LLMClient(mcp_ws_url=None)
        conectar.assert_not_called()
        self.assertIsNone(cliente._ws)
        self.assertFalse(cliente._ws_connected)
        self.assertIsNone(cliente.api_client)

    def test_con_la_url_de_siempre_si_intenta_el_canal(self):
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": ""}):
            with mock.patch.object(llm_client, "HAS_WEBSOCKET", True):
                with mock.patch.object(LLMClient, "_try_connect_mcp") as conectar:
                    LLMClient()
        conectar.assert_called_once()

    def test_la_api_directa_hereda_la_base_url_del_entorno(self):
        """Es la palanca del banco: con `ANTHROPIC_BASE_URL` el SDK habla con
        quien diga la variable y con nadie más. Sin el SDK instalado (el job
        `ai-server` de CI no lo trae) el cliente queda en `None`, y eso también
        se afirma: la aserción no se salta, cambia de forma."""
        entorno = {
            "ANTHROPIC_API_KEY": "banco-sin-creditos",
            "ANTHROPIC_BASE_URL": "http://127.0.0.1:1",
        }
        with mock.patch.dict(os.environ, entorno):
            cliente = LLMClient(mcp_ws_url=None)
        self.assertEqual(cliente.api_client is not None, HAS_ANTHROPIC)
        if HAS_ANTHROPIC:
            self.assertEqual(str(cliente.api_client.base_url).rstrip("/"), "http://127.0.0.1:1")
            self.assertEqual(cliente.api_client.api_key, "banco-sin-creditos")


if __name__ == "__main__":
    unittest.main()
