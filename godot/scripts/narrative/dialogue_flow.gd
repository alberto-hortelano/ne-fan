## Máquina de diálogo narrativo: cachea el último diálogo mostrado, gestiona la
## pausa/reanudación del guion cuando el jugador escribe texto libre (Claude
## reacciona en paralelo) y aplica las consequences del motor narrativo.
##
## Extraído de main.gd — main conserva lo que toca la escena 3D (spawn de
## entidades) vía la señal spawn_entity_requested.
extends Node

signal spawn_entity_requested(consequence: Dictionary, event_id: String)

var _dialogue_ui: Node = null  # DialogueUI
var _hud: CanvasLayer = null  # GameHUD

# Cache of the last dialogue shown so we can record it on choice
var _last_dialogue_speaker := ""
var _last_dialogue_text := ""
var _last_dialogue_choices: Array = []
# Free-text reply in flight: the scripted scenario is paused waiting for
# Claude's reaction. When the reaction arrives (or the player advances past
# Claude's injected dialogue), we resume the script with the remembered
# fallback choice so the beat machine never stays stuck.
var _pending_free_text_event_id := ""
var _pending_free_text_orig_choices: Array = []
var _pending_free_text_pending: bool = false
var _claude_injected_dialogue: bool = false


func setup(dialogue_ui: Node, hud: CanvasLayer) -> void:
	_dialogue_ui = dialogue_ui
	_hud = hud
	dialogue_ui.dialogue_advanced.connect(_on_dialogue_advanced)
	dialogue_ui.dialogue_choice_made.connect(_on_dialogue_choice_made)


func show_dialogue(speaker: String, text: String, choices: Array) -> void:
	_last_dialogue_speaker = speaker
	_last_dialogue_text = text
	_last_dialogue_choices = choices
	_dialogue_ui.show_dialogue(speaker, text, choices)


func _on_dialogue_advanced() -> void:
	# If the player is advancing past a Claude-injected dialogue, use this
	# moment to resume the scripted scenario that we paused when the player
	# wrote free text. Otherwise we'd remain stuck waiting for a beat that
	# never triggers.
	if _claude_injected_dialogue and _pending_free_text_pending:
		_resume_script_after_free_text()
		return
	LogicBridge.send_scenario_event("dialogue_advanced")


func _on_dialogue_choice_made(choice_index: int, free_text: String = "") -> void:
	var speaker: String = _last_dialogue_speaker
	var text: String = _last_dialogue_text
	var choices: Array = _last_dialogue_choices

	# If the player was replying to a Claude-injected dialogue, treat the
	# choice as "advance past it" and resume the scripted script (Claude's
	# injected choices are freeform — they don't map onto scripted beats).
	if _claude_injected_dialogue and _pending_free_text_pending:
		# Record the Claude sub-dialogue into the session for replay/history,
		# but don't re-trigger another Claude call (it would loop).
		NarrativeState.record_dialogue_event(speaker, text, choices, choice_index, free_text)
		_resume_script_after_free_text()
		return

	var event_id: String = NarrativeState.record_dialogue_event(
		speaker, text, choices, choice_index, free_text
	)

	if choice_index < 0:
		# Free text: PAUSE the scripted scenario and wait for Claude's
		# reaction. We do NOT fall through to choice 0 — that would make
		# the scripted response fire immediately, which is exactly what
		# the player is trying to override.
		_pending_free_text_event_id = event_id
		_pending_free_text_orig_choices = choices.duplicate()
		_pending_free_text_pending = true
		_claude_injected_dialogue = false
		_hud.show_text_panel("🤔 Claude piensa en cómo responde el mundo...")
		AIClient.report_player_choice(event_id, speaker, "", free_text,
			NarrativeState.serialize_for_llm("compact"))
	else:
		# Numbered choice: advance the scripted scenario immediately and
		# (in parallel) let Claude react, but without pausing the game.
		LogicBridge.send_scenario_event("dialogue_choice", {
			"choiceIndex": choice_index,
			"freeText": free_text,
		})
		var chosen_text: String = ""
		if choice_index < choices.size():
			var c = choices[choice_index]
			chosen_text = String(c.get("text", "")) if c is Dictionary else String(c)
		AIClient.report_player_choice(event_id, speaker, chosen_text, free_text,
			NarrativeState.serialize_for_llm("compact"))


func _resume_script_after_free_text() -> void:
	"""Release the free-text pause and advance the scripted scenario with the
	fallback action we remembered when the player first typed."""
	var orig_choices: Array = _pending_free_text_orig_choices
	_pending_free_text_event_id = ""
	_pending_free_text_orig_choices = []
	_pending_free_text_pending = false
	_claude_injected_dialogue = false
	_hud.hide_text_panel()
	if orig_choices.size() > 0:
		LogicBridge.send_scenario_event("dialogue_choice", {"choiceIndex": 0})
	else:
		LogicBridge.send_scenario_event("dialogue_advanced")


func handle_consequences(event_id: String, consequences: Array) -> void:
	"""Apply consequences emitted by the narrative engine after a player choice."""
	var is_free_text_pending: bool = (
		_pending_free_text_pending and event_id == _pending_free_text_event_id
	)
	var injected_dialogue_this_round := false

	# Clear the persistent "Claude piensa..." placeholder now that we have
	# a response. Individual consequence handlers below may show their own
	# brief messages on top.
	if is_free_text_pending:
		_hud.hide_text_panel()

	if consequences.is_empty():
		if is_free_text_pending:
			# Claude had nothing to add — resume the scripted scenario so
			# the player isn't stuck with a hidden dialogue state.
			_hud.show_brief_message("💭 El silencio responde al viento...")
			_resume_script_after_free_text()
		else:
			_hud.show_brief_message("💭 El mundo sigue su curso...")
		return

	for c in consequences:
		if not c is Dictionary:
			continue
		var ctype: String = c.get("type", "")
		match ctype:
			"dialogue":
				var spk: String = String(c.get("speaker", "?"))
				var txt: String = String(c.get("text", ""))
				var chx_raw = c.get("choices", [])
				var chx: Array = chx_raw if chx_raw is Array else []
				if txt == "":
					continue
				show_dialogue(spk, txt, chx)
				injected_dialogue_this_round = true
				if is_free_text_pending:
					_claude_injected_dialogue = true
			"story_update":
				var delta: String = c.get("delta", "")
				if delta != "":
					if NarrativeState.story_so_far == "":
						NarrativeState.story_so_far = delta
					else:
						NarrativeState.story_so_far += "\n\n" + delta
					if not injected_dialogue_this_round:
						_hud.show_brief_message("📖 " + delta.substr(0, 60))
			"spawn_entity":
				spawn_entity_requested.emit(c, event_id)
			"schedule_event":
				print("Narrative: scheduled event '%s' (trigger=%s)" % [
					c.get("description", ""), c.get("trigger", "")])
			"plugin_event":
				# Los efectos los aplica el dispatcher de plugins en el bridge;
				# aquí sólo se deja traza (el estado llega vía state updates).
				print("Narrative: plugin_event '%s' -> %s" % [
					c.get("event_type", ""), String(c.get("plugin_id", "")).substr(0, 12)])
		# Record the consequence so the history browser (Phase 4) can show it
		NarrativeState.record_narrative_consequence(event_id, c)

	# If Claude didn't inject any dialogue in response to free text we need
	# to release the paused scenario so the game can continue; otherwise the
	# player sees nothing on screen and the beat machine hangs.
	if is_free_text_pending and not injected_dialogue_this_round:
		_resume_script_after_free_text()
