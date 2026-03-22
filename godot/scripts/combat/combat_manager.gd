## Combat orchestrator — delegates to nefan-core via LogicBridge.
## Keeps combatant registry and signals for HUD/animation compatibility.
class_name CombatManager
extends Node

signal combat_result(attacker: Node, defender: Node, damage: float)
signal combatant_died(combatant: Node)

var _combatants: Array = []


func register_combatant(c: Node) -> void:
	if c in _combatants:
		return
	_combatants.append(c)


func unregister_combatant(c: Node) -> void:
	_combatants.erase(c)


func clear_pending() -> void:
	pass  # Pending impacts live in nefan-core now
